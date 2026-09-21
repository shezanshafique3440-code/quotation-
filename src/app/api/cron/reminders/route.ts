import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { AppError, NotConfiguredError } from "@/lib/errors";
import { expireLapsedQuotations } from "@/lib/follow-ups";
import { sendFollowUpDigests } from "@/lib/notifications";
import { pruneRateLimits } from "@/lib/rate-limit";
import { safeEquals } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Scheduled maintenance endpoint, meant to be called by an external scheduler
 * (cron, Vercel Cron, a queue worker) with the CRON_SECRET bearer token.
 *
 * It does three real things and claims nothing more:
 *   1. expires quotations whose validity date has passed;
 *   2. emails each workspace a digest of its due follow-ups, when an email
 *      provider is configured — `digestsSent` counts only the digests a
 *      provider actually accepted, and `digestsSkipped` says why the rest
 *      were not sent;
 *   3. returns the follow-ups that are now due, so the caller can act.
 *
 * The digest goes to the workspace owner, never to their customers: QuoteFlow
 * does not chase anyone on a business's behalf.
 */
async function handle(request: Request) {
  const env = getEnv();
  if (!env.CRON_SECRET) {
    throw new NotConfiguredError(
      "CRON_SECRET is not set, so the scheduled endpoint is disabled.",
    );
  }

  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token || !safeEquals(token, env.CRON_SECRET)) {
    throw new AppError("Unauthorized.", { status: 401, code: "unauthorized" });
  }

  const now = new Date();

  // Expiring also cancels the pending chase and writes a timeline row, so the
  // owner can see why a quotation moved without anyone touching it.
  const expired = await expireLapsedQuotations(now);
  const prunedRateLimits = await pruneRateLimits(now);

  // Expiry runs first, so a quotation that lapsed today is not also chased.
  const digests = await sendFollowUpDigests(now);

  const due = await prisma.reminder.findMany({
    where: { status: "pending", dueAt: { lte: now } },
    orderBy: { dueAt: "asc" },
    take: 500,
    include: {
      organization: { select: { id: true, name: true } },
      quotation: {
        select: {
          id: true,
          number: true,
          title: true,
          status: true,
          totalCents: true,
          currency: true,
          customer: { select: { name: true, email: true, whatsapp: true, phone: true } },
        },
      },
    },
  });

  return NextResponse.json({
    ranAt: now.toISOString(),
    quotationsExpired: expired.expired,
    rateLimitRowsPruned: prunedRateLimits,
    // Digests are only counted as sent when a provider accepted them.
    digestsSent: digests.filter((d) => d.sent).length,
    digestsSkipped: digests
      .filter((d) => !d.sent)
      .map((d) => ({
        organizationId: d.organizationId,
        itemCount: d.itemCount,
        reason: d.reason ?? d.error ?? "unknown",
      })),
    dueReminders: due.map((reminder) => ({
      id: reminder.id,
      organizationId: reminder.organizationId,
      organizationName: reminder.organization.name,
      channel: reminder.channel,
      dueAt: reminder.dueAt.toISOString(),
      note: reminder.note,
      quotation: {
        id: reminder.quotation.id,
        number: reminder.quotation.number,
        title: reminder.quotation.title,
        status: reminder.quotation.status,
        totalCents: reminder.quotation.totalCents,
        currency: reminder.quotation.currency,
        customer: reminder.quotation.customer,
      },
    })),
  });
}

export async function GET(request: Request) {
  try {
    return await handle(request);
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    return await handle(request);
  } catch (error) {
    return jsonError(error);
  }
}
