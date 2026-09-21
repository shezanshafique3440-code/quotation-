import type { Prisma } from "@prisma/client";
import { ACTIVITY_KINDS, recordActivity, recordActivityTx } from "./activity";
import { brandPalette, type BrandPalette } from "./branding";
import { randomShareToken } from "./crypto";
import { prisma } from "./db";
import { getEnv } from "./env";
import { AppError, NotFoundError } from "./errors";

export interface ShareActor {
  userId: string;
  label: string;
}

/** Turn on the share link, minting a token the first time. */
export async function enableSharing(
  organizationId: string,
  quotationId: string,
  actor: ShareActor,
): Promise<string> {
  const quotation = await prisma.quotation.findFirst({
    where: { id: quotationId, organizationId },
    select: { id: true, publicToken: true, customerId: true, number: true },
  });
  if (!quotation) throw new NotFoundError("Quotation not found.");

  const token = quotation.publicToken ?? randomShareToken();
  await prisma.quotation.update({
    where: { id: quotationId },
    data: { publicToken: token, publicEnabled: true },
  });

  await recordActivity({
    organizationId,
    category: "quotation",
    kind: ACTIVITY_KINDS.shareEnabled,
    summary: `Share link enabled for ${quotation.number}`,
    actorType: "user",
    actorId: actor.userId,
    actorLabel: actor.label,
    quotationId,
    customerId: quotation.customerId,
  });

  return token;
}

export async function disableSharing(
  organizationId: string,
  quotationId: string,
  actor: ShareActor,
): Promise<void> {
  const result = await prisma.quotation.updateMany({
    where: { id: quotationId, organizationId },
    data: { publicEnabled: false },
  });
  if (result.count === 0) throw new NotFoundError("Quotation not found.");

  const quotation = await prisma.quotation.findUniqueOrThrow({
    where: { id: quotationId },
    select: { customerId: true, number: true },
  });

  await recordActivity({
    organizationId,
    category: "quotation",
    kind: ACTIVITY_KINDS.shareDisabled,
    summary: `Share link disabled for ${quotation.number}`,
    actorType: "user",
    actorId: actor.userId,
    actorLabel: actor.label,
    quotationId,
    customerId: quotation.customerId,
  });
}

/** Issue a fresh token; any link already sent out stops working immediately. */
export async function rotateShareToken(
  organizationId: string,
  quotationId: string,
  actor: ShareActor,
): Promise<string> {
  const quotation = await prisma.quotation.findFirst({
    where: { id: quotationId, organizationId },
    select: { id: true, customerId: true, number: true },
  });
  if (!quotation) throw new NotFoundError("Quotation not found.");

  const token = randomShareToken();
  await prisma.quotation.update({
    where: { id: quotationId },
    data: { publicToken: token, publicEnabled: true },
  });

  await recordActivity({
    organizationId,
    category: "quotation",
    kind: ACTIVITY_KINDS.shareRotated,
    summary: `Share link replaced for ${quotation.number}. The previous link no longer works.`,
    actorType: "user",
    actorId: actor.userId,
    actorLabel: actor.label,
    quotationId,
    customerId: quotation.customerId,
  });

  return token;
}

export function shareUrl(token: string): string {
  return `${getEnv().APP_URL.replace(/\/$/, "")}/q/${token}`;
}

const PUBLIC_INCLUDE = {
  items: { orderBy: { position: "asc" } },
  customer: { select: { id: true, name: true, company: true, email: true } },
  organization: { select: { id: true, name: true, plan: true, profile: true } },
} satisfies Prisma.QuotationInclude;

export type PublicQuotationRecord = Prisma.QuotationGetPayload<{
  include: typeof PUBLIC_INCLUDE;
}>;

export interface PublicQuotationView {
  id: string;
  organizationId: string;
  customerId: string;
  number: string;
  title: string;
  status: string;
  currency: string;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  notes: string | null;
  terms: string | null;
  validUntil: Date | null;
  createdAt: Date;
  sentAt: Date | null;
  respondedAt: Date | null;
  rejectionReason: string | null;
  requireSignature: boolean;
  signatureName: string | null;
  signedAt: Date | null;
  items: {
    id: string;
    description: string;
    quantity: number;
    unit: string;
    unitPriceCents: number;
    taxRateBp: number;
    lineTotalCents: number;
  }[];
  customer: { name: string; company: string | null; email: string | null };
  business: {
    name: string;
    legalName: string;
    email: string | null;
    phone: string | null;
    website: string | null;
    logoUrl: string | null;
    addressLines: string[];
    taxId: string | null;
    locale: string;
    timezone: string;
  };
  palette: BrandPalette;
  /** True once the customer can no longer act on it. */
  expired: boolean;
  decided: boolean;
}

export function isExpired(
  quotation: { validUntil: Date | null; status: string },
  now: Date = new Date(),
): boolean {
  if (quotation.status === "expired") return true;
  if (!quotation.validUntil) return false;
  return quotation.validUntil.getTime() < now.getTime();
}

/**
 * Project the record down to what a customer may see.
 *
 * Built as an explicit allow-list rather than by deleting internal fields, so
 * a column added later is private until someone deliberately exposes it.
 */
export function toPublicView(
  record: PublicQuotationRecord,
  now: Date = new Date(),
): PublicQuotationView {
  const profile = record.organization.profile;
  const addressLines = [
    [profile?.addressLine1, profile?.addressLine2].filter(Boolean).join(", "),
    [profile?.postalCode, profile?.city].filter(Boolean).join(" "),
    profile?.country ?? "",
  ].filter((line) => line.trim() !== "");

  return {
    id: record.id,
    organizationId: record.organizationId,
    customerId: record.customerId,
    number: record.number,
    title: record.title,
    status: record.status,
    currency: record.currency,
    subtotalCents: record.subtotalCents,
    discountCents: record.discountCents,
    taxCents: record.taxCents,
    totalCents: record.totalCents,
    notes: record.notes,
    terms: record.terms,
    validUntil: record.validUntil,
    createdAt: record.createdAt,
    sentAt: record.sentAt,
    respondedAt: record.respondedAt,
    rejectionReason: record.rejectionReason,
    requireSignature: record.requireSignature,
    signatureName: record.signatureName,
    signedAt: record.signedAt,
    items: record.items.map((item) => ({
      id: item.id,
      description: item.description,
      quantity: item.quantity,
      unit: item.unit,
      unitPriceCents: item.unitPriceCents,
      taxRateBp: item.taxRateBp,
      lineTotalCents: item.lineTotalCents,
    })),
    customer: {
      name: record.customer.name,
      company: record.customer.company,
      email: record.customer.email,
    },
    business: {
      name: record.organization.name,
      legalName: profile?.legalName ?? record.organization.name,
      email: profile?.email ?? null,
      phone: profile?.phone ?? null,
      website: profile?.website ?? null,
      logoUrl: profile?.logoUrl ?? null,
      addressLines,
      taxId: profile?.taxId ?? null,
      locale: profile?.locale ?? "en-US",
      timezone: profile?.timezone ?? "UTC",
    },
    palette: brandPalette(profile?.brandColor),
    expired: isExpired(record, now),
    decided: record.status === "accepted" || record.status === "rejected",
  };
}

/**
 * Resolve a share token.
 *
 * Returns null for an unknown token, a disabled link, a still-draft quotation
 * and a fleet-wide kill switch alike — the caller renders one "not available"
 * page for all of them, so a token cannot be probed for existence.
 */
export async function loadPublicQuotation(
  token: string,
): Promise<PublicQuotationRecord | null> {
  if (!getEnv().PUBLIC_PAGES_ENABLED) return null;
  if (!token || token.length < 16 || token.length > 128) return null;

  const record = await prisma.quotation.findUnique({
    where: { publicToken: token },
    include: PUBLIC_INCLUDE,
  });
  if (!record) return null;
  if (!record.publicEnabled) return null;
  if (record.status === "draft") return null;
  if (record.organization.profile && !record.organization.profile.publicPagesEnabled) return null;

  return record;
}

export interface ViewContext {
  ipHash: string | null;
  userAgent: string | null;
  automated: boolean;
}

/**
 * Count a genuine page view.
 *
 * Automated agents (link unfurlers, monitors) are excluded: telling an owner
 * "your customer opened this" because WhatsApp fetched a preview would be a
 * fabricated signal. Repeat views inside a short window are also collapsed so
 * a refresh does not inflate the count.
 */
export interface ViewOutcome {
  /** False when the visit was skipped as automated or as a repeat. */
  counted: boolean;
  firstView: boolean;
}

export async function recordPublicView(
  record: PublicQuotationRecord,
  context: ViewContext,
  now: Date = new Date(),
): Promise<ViewOutcome> {
  if (context.automated) return { counted: false, firstView: false };

  const VIEW_DEDUPE_MS = 5 * 60_000;
  const lastViewed = record.lastViewedAt?.getTime() ?? 0;
  const isRepeat = now.getTime() - lastViewed < VIEW_DEDUPE_MS;

  await prisma.quotation.update({
    where: { id: record.id },
    data: {
      lastViewedAt: now,
      ...(record.firstViewedAt ? {} : { firstViewedAt: now }),
      ...(isRepeat ? {} : { viewCount: { increment: 1 } }),
    },
  });

  if (isRepeat) return { counted: false, firstView: false };

  await recordActivity({
    organizationId: record.organizationId,
    category: "quotation",
    kind: ACTIVITY_KINDS.quotationViewed,
    summary: record.firstViewedAt
      ? `${record.customer.name} opened ${record.number} again`
      : `${record.customer.name} opened ${record.number} for the first time`,
    actorType: "customer",
    actorLabel: record.customer.name,
    quotationId: record.id,
    customerId: record.customerId,
    metadata: { viewCount: record.viewCount + 1 },
    ipHash: context.ipHash,
    userAgent: context.userAgent,
  });

  return { counted: true, firstView: record.firstViewedAt === null };
}

export interface RespondInput {
  decision: "accept" | "reject";
  respondedByName: string;
  signatureName?: string | undefined;
  signatureEmail?: string | undefined;
  rejectionReason?: string | undefined;
  ipHash: string | null;
  userAgent: string | null;
}

export interface RespondResult {
  status: "accepted" | "rejected";
  alreadyDecided: boolean;
}

/**
 * Record the customer's decision from the share page.
 *
 * Everything that must agree — status, signature, timeline row, cancelled
 * follow-ups — is written in one transaction, and the update is guarded on the
 * row still being undecided so two clicks cannot produce two outcomes.
 */
export async function respondToQuotation(
  record: PublicQuotationRecord,
  input: RespondInput,
  now: Date = new Date(),
): Promise<RespondResult> {
  if (record.status === "accepted" || record.status === "rejected") {
    return { status: record.status, alreadyDecided: true };
  }

  if (record.status !== "sent") {
    throw new AppError(
      "This quotation is not open for a response. Please contact the sender.",
      { status: 409, code: "not_respondable" },
    );
  }

  if (isExpired(record, now)) {
    throw new AppError(
      "This quotation has expired. Ask the sender for an updated version.",
      { status: 410, code: "expired" },
    );
  }

  if (input.decision === "accept" && record.requireSignature) {
    if (!input.signatureName || input.signatureName.trim().length < 2) {
      throw new AppError("Type your full name to sign this quotation.", {
        status: 422,
        code: "signature_required",
      });
    }
  }

  const status = input.decision === "accept" ? "accepted" : "rejected";
  const signed = input.decision === "accept" && Boolean(input.signatureName?.trim());

  await prisma.$transaction(async (tx) => {
    // Guarded by `status: "sent"`: a concurrent response finds zero rows.
    const updated = await tx.quotation.updateMany({
      where: { id: record.id, status: "sent" },
      data: {
        status,
        decidedAt: now,
        respondedAt: now,
        decisionSource: "public_page",
        respondedByName: input.respondedByName.trim().slice(0, 160),
        rejectionReason:
          input.decision === "reject" ? (input.rejectionReason?.trim().slice(0, 1000) ?? null) : null,
        ...(signed
          ? {
              signatureName: input.signatureName!.trim().slice(0, 160),
              signatureEmail: input.signatureEmail?.trim().slice(0, 200) ?? null,
              signedAt: now,
              signatureIpHash: input.ipHash,
            }
          : {}),
      },
    });

    if (updated.count === 0) {
      throw new AppError("This quotation was already answered.", {
        status: 409,
        code: "already_decided",
      });
    }

    // A decided quote no longer needs chasing.
    await tx.reminder.updateMany({
      where: { quotationId: record.id, status: "pending" },
      data: { status: "cancelled" },
    });

    if (record.inquiryId && input.decision === "accept") {
      await tx.inquiry.updateMany({
        where: { id: record.inquiryId, organizationId: record.organizationId },
        data: { status: "won" },
      });
    }

    await recordActivityTx(tx, {
      organizationId: record.organizationId,
      category: "quotation",
      kind:
        input.decision === "accept"
          ? ACTIVITY_KINDS.quotationAccepted
          : ACTIVITY_KINDS.quotationRejected,
      summary:
        input.decision === "accept"
          ? `${input.respondedByName} accepted ${record.number}`
          : `${input.respondedByName} declined ${record.number}`,
      actorType: "customer",
      actorLabel: input.respondedByName,
      quotationId: record.id,
      customerId: record.customerId,
      metadata: {
        source: "public_page",
        totalCents: record.totalCents,
        currency: record.currency,
        ...(input.rejectionReason ? { reason: input.rejectionReason } : {}),
      },
      ipHash: input.ipHash,
      userAgent: input.userAgent,
    });

    if (signed) {
      await recordActivityTx(tx, {
        organizationId: record.organizationId,
        category: "quotation",
        kind: ACTIVITY_KINDS.quotationSigned,
        summary: `${input.signatureName!.trim()} signed ${record.number}`,
        actorType: "customer",
        actorLabel: input.signatureName!.trim(),
        quotationId: record.id,
        customerId: record.customerId,
        metadata: {
          signatureType: "typed",
          ...(input.signatureEmail ? { email: input.signatureEmail } : {}),
        },
        ipHash: input.ipHash,
        userAgent: input.userAgent,
      });
    }
  });

  return { status, alreadyDecided: false };
}
