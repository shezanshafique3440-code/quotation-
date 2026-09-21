import { createFormatter, type Formatter } from "./format";
import { prisma } from "./db";
import { requireSession, type SessionContext } from "./session";

export interface TenantProfile {
  legalName: string;
  currency: string;
  locale: string;
  timezone: string;
  email: string | null;
  phone: string | null;
  whatsappNumber: string | null;
  website: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  postalCode: string | null;
  country: string | null;
  taxId: string | null;
  taxRateBp: number;
  logoUrl: string | null;
  brandColor: string;
  portalHeadline: string | null;
  portalMessage: string | null;
  quoteNumberPrefix: string;
  defaultValidityDays: number;
  defaultTerms: string | null;
  defaultNotes: string | null;
  publicPagesEnabled: boolean;
  requireSignature: boolean;
  autoFollowUpEnabled: boolean;
  autoFollowUpDays: number;
}

export interface TenantContext {
  session: SessionContext;
  profile: TenantProfile;
  /** Locale, timezone and currency pre-bound, so pages cannot forget one. */
  fmt: Formatter;
}

const FALLBACK: Omit<TenantProfile, "legalName"> = {
  currency: "USD",
  locale: "en-US",
  timezone: "UTC",
  email: null,
  phone: null,
  whatsappNumber: null,
  website: null,
  addressLine1: null,
  addressLine2: null,
  city: null,
  postalCode: null,
  country: null,
  taxId: null,
  taxRateBp: 0,
  logoUrl: null,
  brandColor: "#4B3DDB",
  portalHeadline: null,
  portalMessage: null,
  quoteNumberPrefix: "QT",
  defaultValidityDays: 14,
  defaultTerms: null,
  defaultNotes: null,
  publicPagesEnabled: true,
  requireSignature: false,
  autoFollowUpEnabled: true,
  autoFollowUpDays: 3,
};

export async function loadTenantProfile(
  organizationId: string,
  organizationName: string,
): Promise<TenantProfile> {
  const profile = await prisma.businessProfile.findUnique({ where: { organizationId } });
  if (!profile) return { legalName: organizationName, ...FALLBACK };

  return {
    legalName: profile.legalName,
    currency: profile.currency,
    locale: profile.locale,
    timezone: profile.timezone,
    email: profile.email,
    phone: profile.phone,
    whatsappNumber: profile.whatsappNumber,
    website: profile.website,
    addressLine1: profile.addressLine1,
    addressLine2: profile.addressLine2,
    city: profile.city,
    postalCode: profile.postalCode,
    country: profile.country,
    taxId: profile.taxId,
    taxRateBp: profile.taxRateBp,
    logoUrl: profile.logoUrl,
    brandColor: profile.brandColor,
    portalHeadline: profile.portalHeadline,
    portalMessage: profile.portalMessage,
    quoteNumberPrefix: profile.quoteNumberPrefix,
    defaultValidityDays: profile.defaultValidityDays,
    defaultTerms: profile.defaultTerms,
    defaultNotes: profile.defaultNotes,
    publicPagesEnabled: profile.publicPagesEnabled,
    requireSignature: profile.requireSignature,
    autoFollowUpEnabled: profile.autoFollowUpEnabled,
    autoFollowUpDays: profile.autoFollowUpDays,
  };
}

/**
 * Session plus business profile, with a sane profile for workspaces created
 * before a field existed. Every page-level query is scoped by
 * `session.organizationId`, which is the tenant boundary.
 */
export async function requireTenant(): Promise<TenantContext> {
  const session = await requireSession();
  const profile = await loadTenantProfile(session.organizationId, session.organization.name);

  return {
    session,
    profile,
    fmt: createFormatter({
      locale: profile.locale,
      timezone: profile.timezone,
      currency: profile.currency,
    }),
  };
}
