import type { Prisma } from "@prisma/client";
import { prisma } from "./db";

/**
 * One append-only table backs three views: the quotation timeline, the
 * customer timeline, and the security audit log. `category` separates them.
 * Application code only ever inserts — nothing updates or deletes a row.
 */
export const ACTIVITY_CATEGORIES = [
  "quotation",
  "customer",
  "security",
  "billing",
  "settings",
] as const;
export type ActivityCategory = (typeof ACTIVITY_CATEGORIES)[number];

export const ACTIVITY_KINDS = {
  quotationCreated: "quotation.created",
  quotationUpdated: "quotation.updated",
  quotationSent: "quotation.sent",
  quotationViewed: "quotation.viewed",
  quotationAccepted: "quotation.accepted",
  quotationRejected: "quotation.rejected",
  quotationExpired: "quotation.expired",
  quotationSigned: "quotation.signed",
  quotationReopened: "quotation.reopened",
  quotationDeleted: "quotation.deleted",
  shareEnabled: "quotation.share_enabled",
  shareDisabled: "quotation.share_disabled",
  shareRotated: "quotation.share_rotated",
  pdfDownloaded: "quotation.pdf_downloaded",
  aiDrafted: "quotation.ai_drafted",
  aiFollowUpDrafted: "quotation.ai_follow_up_drafted",
  followUpScheduled: "quotation.follow_up_scheduled",
  emailSent: "quotation.email_sent",
  emailFailed: "quotation.email_failed",
  followUpCompleted: "quotation.follow_up_completed",
  followUpCancelled: "quotation.follow_up_cancelled",

  customerCreated: "customer.created",
  customerUpdated: "customer.updated",
  portalLinkIssued: "customer.portal_link_issued",
  portalLinkRevoked: "customer.portal_link_revoked",
  portalOpened: "customer.portal_opened",
  portalEmailSent: "customer.portal_email_sent",

  signedIn: "security.signed_in",
  signInFailed: "security.sign_in_failed",
  signedOut: "security.signed_out",
  signedUp: "security.signed_up",
  rateLimited: "security.rate_limited",

  planChanged: "billing.plan_changed",
  checkoutStarted: "billing.checkout_started",

  profileUpdated: "settings.profile_updated",
  templateCreated: "settings.template_created",
  templateUpdated: "settings.template_updated",
  templateDeleted: "settings.template_deleted",
} as const;

export type ActivityKind = (typeof ACTIVITY_KINDS)[keyof typeof ACTIVITY_KINDS];

export interface RecordActivityInput {
  organizationId: string;
  category: ActivityCategory;
  kind: ActivityKind;
  summary: string;
  actorType: "user" | "customer" | "system" | "anonymous";
  actorLabel: string;
  actorId?: string | null;
  quotationId?: string | null;
  customerId?: string | null;
  metadata?: Record<string, unknown> | null;
  ipHash?: string | null;
  userAgent?: string | null;
}

/**
 * Write one timeline/audit row.
 *
 * Deliberately never throws: an audit write failing must not roll back the
 * business action the user just completed, and must not hide it either — the
 * failure is logged to the server console.
 */
export async function recordActivity(input: RecordActivityInput): Promise<void> {
  try {
    await prisma.activityEvent.create({
      data: {
        organizationId: input.organizationId,
        category: input.category,
        kind: input.kind,
        summary: input.summary.slice(0, 500),
        actorType: input.actorType,
        actorLabel: input.actorLabel.slice(0, 200),
        actorId: input.actorId ?? null,
        quotationId: input.quotationId ?? null,
        customerId: input.customerId ?? null,
        metadata: input.metadata ? JSON.stringify(input.metadata).slice(0, 4000) : null,
        ipHash: input.ipHash ?? null,
        userAgent: input.userAgent ?? null,
      },
    });
  } catch (error) {
    console.error("[activity] failed to record event", input.kind, error);
  }
}

/** Write the same row inside a caller's transaction, where atomicity matters. */
export async function recordActivityTx(
  tx: Prisma.TransactionClient,
  input: RecordActivityInput,
): Promise<void> {
  await tx.activityEvent.create({
    data: {
      organizationId: input.organizationId,
      category: input.category,
      kind: input.kind,
      summary: input.summary.slice(0, 500),
      actorType: input.actorType,
      actorLabel: input.actorLabel.slice(0, 200),
      actorId: input.actorId ?? null,
      quotationId: input.quotationId ?? null,
      customerId: input.customerId ?? null,
      metadata: input.metadata ? JSON.stringify(input.metadata).slice(0, 4000) : null,
      ipHash: input.ipHash ?? null,
      userAgent: input.userAgent ?? null,
    },
  });
}

export interface TimelineEntry {
  id: string;
  kind: string;
  category: string;
  summary: string;
  actorType: string;
  actorLabel: string;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

function toEntry(row: {
  id: string;
  kind: string;
  category: string;
  summary: string;
  actorType: string;
  actorLabel: string;
  metadata: string | null;
  createdAt: Date;
}): TimelineEntry {
  let metadata: Record<string, unknown> | null = null;
  if (row.metadata) {
    try {
      metadata = JSON.parse(row.metadata) as Record<string, unknown>;
    } catch {
      metadata = null;
    }
  }
  return {
    id: row.id,
    kind: row.kind,
    category: row.category,
    summary: row.summary,
    actorType: row.actorType,
    actorLabel: row.actorLabel,
    metadata,
    createdAt: row.createdAt,
  };
}

const TIMELINE_SELECT = {
  id: true,
  kind: true,
  category: true,
  summary: true,
  actorType: true,
  actorLabel: true,
  metadata: true,
  createdAt: true,
} satisfies Prisma.ActivityEventSelect;

export async function quotationTimeline(
  organizationId: string,
  quotationId: string,
  take = 50,
): Promise<TimelineEntry[]> {
  const rows = await prisma.activityEvent.findMany({
    where: { organizationId, quotationId },
    orderBy: { createdAt: "desc" },
    take,
    select: TIMELINE_SELECT,
  });
  return rows.map(toEntry);
}

export async function customerTimeline(
  organizationId: string,
  customerId: string,
  take = 80,
): Promise<TimelineEntry[]> {
  const rows = await prisma.activityEvent.findMany({
    where: { organizationId, customerId },
    orderBy: { createdAt: "desc" },
    take,
    select: TIMELINE_SELECT,
  });
  return rows.map(toEntry);
}

export async function auditLog(
  organizationId: string,
  options: { category?: ActivityCategory; take?: number; cursor?: string } = {},
): Promise<TimelineEntry[]> {
  const rows = await prisma.activityEvent.findMany({
    where: {
      organizationId,
      ...(options.category ? { category: options.category } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: options.take ?? 100,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    select: TIMELINE_SELECT,
  });
  return rows.map(toEntry);
}
