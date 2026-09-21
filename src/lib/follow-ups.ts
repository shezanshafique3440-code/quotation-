import type { Prisma } from "@prisma/client";
import { ACTIVITY_KINDS, recordActivityTx } from "./activity";
import { prisma } from "./db";
import { addDaysInZone, endOfDayInZone, fromZonedParts, zonedParts } from "./timezone";

/**
 * A follow-up is scheduled for late morning local time rather than the exact
 * instant the quote was sent — an owner acting on a reminder at 03:00 their
 * own time is not a useful prompt.
 */
const FOLLOW_UP_HOUR = 10;

export function nextFollowUpAt(
  from: Date,
  days: number,
  timezone: string,
  validUntil?: Date | null,
): Date {
  const target = addDaysInZone(from, days, timezone);
  const parts = zonedParts(target, timezone);
  let at = fromZonedParts({ ...parts, hour: FOLLOW_UP_HOUR, minute: 0, second: 0 }, timezone);

  // Never schedule a chase for after the quote has lapsed; land it on the
  // last full day instead, where it can still change the outcome.
  if (validUntil && at.getTime() >= validUntil.getTime()) {
    const dayBefore = addDaysInZone(validUntil, -1, timezone);
    const beforeParts = zonedParts(dayBefore, timezone);
    const earlier = fromZonedParts(
      { ...beforeParts, hour: FOLLOW_UP_HOUR, minute: 0, second: 0 },
      timezone,
    );
    at = earlier.getTime() > from.getTime() ? earlier : new Date(from.getTime() + 60 * 60_000);
  }

  // Always in the future, even if the caller passed a stale `from`.
  return at.getTime() <= from.getTime() ? new Date(from.getTime() + 60 * 60_000) : at;
}

export interface AutoFollowUpSettings {
  enabled: boolean;
  days: number;
  timezone: string;
}

export interface ScheduleResult {
  scheduled: boolean;
  dueAt: Date | null;
  reason?: string;
}

/**
 * Schedule the automatic chase for a quotation that has just been sent.
 *
 * Idempotent: a quotation that already has a pending follow-up is left alone,
 * so re-sending does not stack duplicates.
 */
export async function scheduleAutoFollowUp(
  tx: Prisma.TransactionClient,
  quotation: {
    id: string;
    organizationId: string;
    customerId: string;
    number: string;
    validUntil: Date | null;
  },
  settings: AutoFollowUpSettings,
  now: Date = new Date(),
): Promise<ScheduleResult> {
  if (!settings.enabled) {
    return { scheduled: false, dueAt: null, reason: "Automatic follow-ups are turned off." };
  }

  const existing = await tx.reminder.count({
    where: { quotationId: quotation.id, status: "pending" },
  });
  if (existing > 0) {
    return { scheduled: false, dueAt: null, reason: "A follow-up is already pending." };
  }

  const dueAt = nextFollowUpAt(now, settings.days, settings.timezone, quotation.validUntil);

  await tx.reminder.create({
    data: {
      organizationId: quotation.organizationId,
      quotationId: quotation.id,
      channel: "whatsapp",
      dueAt,
      autoCreated: true,
      note: `Check in on ${quotation.number} — no response yet.`,
    },
  });

  await recordActivityTx(tx, {
    organizationId: quotation.organizationId,
    category: "quotation",
    kind: ACTIVITY_KINDS.followUpScheduled,
    summary: `Follow-up scheduled for ${quotation.number}`,
    actorType: "system",
    actorLabel: "QuoteFlow",
    quotationId: quotation.id,
    customerId: quotation.customerId,
    metadata: { dueAt: dueAt.toISOString(), automatic: true, days: settings.days },
  });

  return { scheduled: true, dueAt };
}

/**
 * Move quotations past their validity date to `expired`.
 *
 * `validUntil` is already stored as the last instant of the customer's local
 * day, so this is a plain comparison — no zone maths at read time.
 */
export async function expireLapsedQuotations(now: Date = new Date()): Promise<{
  expired: number;
  quotationIds: string[];
}> {
  const due = await prisma.quotation.findMany({
    where: { status: "sent", validUntil: { not: null, lt: now } },
    select: { id: true, organizationId: true, customerId: true, number: true },
    take: 500,
  });

  if (due.length === 0) return { expired: 0, quotationIds: [] };

  const ids = due.map((q) => q.id);

  await prisma.$transaction(async (tx) => {
    await tx.quotation.updateMany({
      where: { id: { in: ids }, status: "sent" },
      data: { status: "expired" },
    });
    await tx.reminder.updateMany({
      where: { quotationId: { in: ids }, status: "pending" },
      data: { status: "cancelled" },
    });
    for (const quotation of due) {
      await recordActivityTx(tx, {
        organizationId: quotation.organizationId,
        category: "quotation",
        kind: ACTIVITY_KINDS.quotationExpired,
        summary: `${quotation.number} passed its validity date`,
        actorType: "system",
        actorLabel: "QuoteFlow",
        quotationId: quotation.id,
        customerId: quotation.customerId,
      });
    }
  });

  return { expired: due.length, quotationIds: ids };
}

/** Default validity instant for a new quotation, in the business's own day. */
export function defaultValidUntil(now: Date, days: number, timezone: string): Date {
  return endOfDayInZone(addDaysInZone(now, days, timezone), timezone);
}
