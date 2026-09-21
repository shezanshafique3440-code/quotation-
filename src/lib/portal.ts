import type { Prisma } from "@prisma/client";
import { ACTIVITY_KINDS, recordActivity } from "./activity";
import { brandPalette, type BrandPalette } from "./branding";
import { fingerprint, randomToken } from "./crypto";
import { prisma } from "./db";
import { getEnv } from "./env";
import { NotFoundError } from "./errors";

export const PORTAL_TOKEN_TTL_DAYS = 180;

function portalFingerprint(token: string): string {
  return fingerprint(token, "portal");
}

export function portalUrl(token: string): string {
  return `${getEnv().APP_URL.replace(/\/$/, "")}/portal/${token}`;
}

export interface IssuedPortalLink {
  token: string;
  url: string;
  expiresAt: Date;
}

/**
 * Mint a portal link for a customer.
 *
 * Only the HMAC is stored, so the raw link exists exactly once — in the
 * response the owner copies. Issuing a new link revokes the previous one, so
 * there is never more than one live credential per customer.
 */
export async function issuePortalLink(
  organizationId: string,
  customerId: string,
  actor: { userId: string; label: string },
  now: Date = new Date(),
): Promise<IssuedPortalLink> {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, organizationId },
    select: { id: true, name: true },
  });
  if (!customer) throw new NotFoundError("Customer not found.");

  const token = randomToken(32);
  const expiresAt = new Date(now.getTime() + PORTAL_TOKEN_TTL_DAYS * 86_400_000);

  await prisma.$transaction([
    prisma.customerPortalToken.updateMany({
      where: { customerId, organizationId, revokedAt: null },
      data: { revokedAt: now },
    }),
    prisma.customerPortalToken.create({
      data: { id: portalFingerprint(token), organizationId, customerId, expiresAt },
    }),
  ]);

  await recordActivity({
    organizationId,
    category: "customer",
    kind: ACTIVITY_KINDS.portalLinkIssued,
    summary: `Portal link issued for ${customer.name}`,
    actorType: "user",
    actorId: actor.userId,
    actorLabel: actor.label,
    customerId,
    metadata: { expiresAt: expiresAt.toISOString() },
  });

  return { token, url: portalUrl(token), expiresAt };
}

export async function revokePortalLinks(
  organizationId: string,
  customerId: string,
  actor: { userId: string; label: string },
  now: Date = new Date(),
): Promise<number> {
  const { count } = await prisma.customerPortalToken.updateMany({
    where: { customerId, organizationId, revokedAt: null },
    data: { revokedAt: now },
  });

  if (count > 0) {
    await recordActivity({
      organizationId,
      category: "customer",
      kind: ACTIVITY_KINDS.portalLinkRevoked,
      summary: `Portal access revoked`,
      actorType: "user",
      actorId: actor.userId,
      actorLabel: actor.label,
      customerId,
    });
  }

  return count;
}

export async function hasActivePortalLink(
  organizationId: string,
  customerId: string,
  now: Date = new Date(),
): Promise<{ active: boolean; expiresAt: Date | null }> {
  const token = await prisma.customerPortalToken.findFirst({
    where: { organizationId, customerId, revokedAt: null, expiresAt: { gt: now } },
    orderBy: { createdAt: "desc" },
    select: { expiresAt: true },
  });
  return { active: Boolean(token), expiresAt: token?.expiresAt ?? null };
}

const PORTAL_QUOTATION_SELECT = {
  id: true,
  number: true,
  title: true,
  status: true,
  currency: true,
  totalCents: true,
  createdAt: true,
  sentAt: true,
  validUntil: true,
  respondedAt: true,
  publicToken: true,
  publicEnabled: true,
} satisfies Prisma.QuotationSelect;

export interface PortalSession {
  organizationId: string;
  customerId: string;
  customer: { name: string; company: string | null; email: string | null };
  business: {
    name: string;
    legalName: string;
    email: string | null;
    phone: string | null;
    website: string | null;
    logoUrl: string | null;
    locale: string;
    timezone: string;
    headline: string | null;
    message: string | null;
  };
  palette: BrandPalette;
  quotations: Prisma.QuotationGetPayload<{ select: typeof PORTAL_QUOTATION_SELECT }>[];
}

/**
 * Resolve a portal link to everything that customer may see.
 *
 * Quotations still in draft are excluded: a customer must not see a number
 * the business has not chosen to send.
 */
export async function loadPortal(
  token: string,
  now: Date = new Date(),
): Promise<PortalSession | null> {
  if (!getEnv().PUBLIC_PAGES_ENABLED) return null;
  if (!token || token.length < 16 || token.length > 128) return null;

  const record = await prisma.customerPortalToken.findUnique({
    where: { id: portalFingerprint(token) },
    include: {
      customer: true,
      organization: { select: { id: true, name: true, profile: true } },
    },
  });

  if (!record) return null;
  if (record.revokedAt) return null;
  if (record.expiresAt.getTime() <= now.getTime()) return null;

  const quotations = await prisma.quotation.findMany({
    where: {
      organizationId: record.organizationId,
      customerId: record.customerId,
      status: { not: "draft" },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: PORTAL_QUOTATION_SELECT,
  });

  const profile = record.organization.profile;

  return {
    organizationId: record.organizationId,
    customerId: record.customerId,
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
      locale: profile?.locale ?? "en-US",
      timezone: profile?.timezone ?? "UTC",
      headline: profile?.portalHeadline ?? null,
      message: profile?.portalMessage ?? null,
    },
    palette: brandPalette(profile?.brandColor),
    quotations,
  };
}

/** Touch `lastUsedAt` and add one timeline row per visit burst. */
export async function recordPortalVisit(
  token: string,
  session: PortalSession,
  context: { ipHash: string | null; userAgent: string | null; automated: boolean },
  now: Date = new Date(),
): Promise<void> {
  if (context.automated) return;

  const id = portalFingerprint(token);
  const existing = await prisma.customerPortalToken.findUnique({
    where: { id },
    select: { lastUsedAt: true },
  });

  await prisma.customerPortalToken.update({ where: { id }, data: { lastUsedAt: now } });

  const VISIT_DEDUPE_MS = 30 * 60_000;
  const last = existing?.lastUsedAt?.getTime() ?? 0;
  if (now.getTime() - last < VISIT_DEDUPE_MS) return;

  await recordActivity({
    organizationId: session.organizationId,
    category: "customer",
    kind: ACTIVITY_KINDS.portalOpened,
    summary: `${session.customer.name} opened their portal`,
    actorType: "customer",
    actorLabel: session.customer.name,
    customerId: session.customerId,
    ipHash: context.ipHash,
    userAgent: context.userAgent,
  });
}
