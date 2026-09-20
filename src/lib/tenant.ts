import { prisma } from "./db";
import { requireSession, type SessionContext } from "./session";

export interface TenantContext {
  session: SessionContext;
  profile: {
    legalName: string;
    currency: string;
    locale: string;
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
    quoteNumberPrefix: string;
    defaultValidityDays: number;
    defaultTerms: string | null;
    defaultNotes: string | null;
  };
}

/**
 * Session plus business profile, with a sane profile for workspaces created
 * before a field existed. Every page-level query is scoped by
 * `session.organizationId`, which is the tenant boundary.
 */
export async function requireTenant(): Promise<TenantContext> {
  const session = await requireSession();
  const profile = await prisma.businessProfile.findUnique({
    where: { organizationId: session.organizationId },
  });

  return {
    session,
    profile: profile ?? {
      legalName: session.organization.name,
      currency: "USD",
      locale: "en-US",
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
      quoteNumberPrefix: "QT",
      defaultValidityDays: 14,
      defaultTerms: null,
      defaultNotes: null,
    },
  };
}
