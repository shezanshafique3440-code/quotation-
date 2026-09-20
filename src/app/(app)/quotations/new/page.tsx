import type { Metadata } from "next";
import { Alert, Card, CardHeader, PageHeader } from "@/components/ui";
import { prisma } from "@/lib/db";
import { toDateInput } from "@/lib/format";
import { requireTenant } from "@/lib/tenant";
import { getUsage } from "@/lib/usage";
import { createQuotationAction } from "@/server/quotation-actions";
import { QuotationEditor } from "../quotation-editor";

export const metadata: Metadata = { title: "New quotation" };

export default async function NewQuotationPage({
  searchParams,
}: {
  searchParams: Promise<{ inquiryId?: string; customerId?: string }>;
}) {
  const { inquiryId, customerId } = await searchParams;
  const { session, profile } = await requireTenant();

  const [customers, products, inquiry, usage] = await Promise.all([
    prisma.customer.findMany({
      where: { organizationId: session.organizationId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, company: true },
    }),
    prisma.product.findMany({
      where: { organizationId: session.organizationId, active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, description: true, unit: true, unitPriceCents: true, taxRateBp: true },
    }),
    inquiryId
      ? prisma.inquiry.findFirst({
          where: { id: inquiryId, organizationId: session.organizationId },
          select: { id: true, subject: true, customerId: true },
        })
      : Promise.resolve(null),
    getUsage(session.organizationId),
  ]);

  const atLimit =
    usage.limits.quotationsPerMonth !== null &&
    usage.quotationsUsed >= usage.limits.quotationsPerMonth;

  const validUntil = new Date(Date.now() + profile.defaultValidityDays * 86_400_000);

  return (
    <>
      <PageHeader
        title="New quotation"
        description={inquiry ? `From inquiry: ${inquiry.subject}` : "Build a quotation from scratch."}
      />

      {atLimit ? (
        <Alert tone="warning" title="Monthly quotation limit reached">
          Your {usage.plan} plan allows {usage.limits.quotationsPerMonth} quotations per month. Saving
          will be rejected until the next billing period, or until you upgrade.
        </Alert>
      ) : null}

      <Card>
        <CardHeader title="Details" />
        <QuotationEditor
          action={createQuotationAction}
          customers={customers}
          products={products}
          defaultCurrency={profile.currency}
          defaultTaxRateBp={profile.taxRateBp}
          locale={profile.locale}
          submitLabel="Create quotation"
          cancelHref={inquiry ? `/inquiries/${inquiry.id}` : "/quotations"}
          values={{
            customerId: inquiry?.customerId ?? customerId ?? "",
            inquiryId: inquiry?.id ?? "",
            title: inquiry?.subject ?? "",
            currency: profile.currency,
            notes: profile.defaultNotes ?? "",
            terms: profile.defaultTerms ?? "",
            validUntil: toDateInput(validUntil),
          }}
        />
      </Card>
    </>
  );
}
