import type { Metadata } from "next";
import Link from "next/link";
import { Alert, Card, CardHeader, PageHeader } from "@/components/ui";
import { prisma } from "@/lib/db";
import { centsToInput } from "@/lib/format";
import { defaultValidUntil } from "@/lib/follow-ups";
import { applyTemplate, templateInclude } from "@/lib/templates";
import { requireTenant } from "@/lib/tenant";
import { getUsage } from "@/lib/usage";
import { createQuotationAction } from "@/server/quotation-actions";
import { QuotationEditor, type EditorValues } from "../quotation-editor";

export const metadata: Metadata = { title: "New quotation" };

export default async function NewQuotationPage({
  searchParams,
}: {
  searchParams: Promise<{ inquiryId?: string; customerId?: string; templateId?: string }>;
}) {
  const { inquiryId, customerId, templateId } = await searchParams;
  const { session, profile, fmt } = await requireTenant();
  const now = new Date();

  const [customers, products, inquiry, usage, templates, template] = await Promise.all([
    prisma.customer.findMany({
      where: { organizationId: session.organizationId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, company: true },
    }),
    prisma.product.findMany({
      where: { organizationId: session.organizationId, active: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        description: true,
        unit: true,
        unitPriceCents: true,
        taxRateBp: true,
      },
    }),
    inquiryId
      ? prisma.inquiry.findFirst({
          where: { id: inquiryId, organizationId: session.organizationId },
          select: { id: true, subject: true, customerId: true },
        })
      : Promise.resolve(null),
    getUsage(session.organizationId),
    prisma.quotationTemplate.findMany({
      where: { organizationId: session.organizationId },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
      select: { id: true, name: true, isDefault: true },
    }),
    templateId
      ? prisma.quotationTemplate.findFirst({
          where: { id: templateId, organizationId: session.organizationId },
          include: templateInclude,
        })
      : Promise.resolve(null),
  ]);

  const atLimit =
    usage.limits.quotationsPerMonth !== null &&
    usage.quotationsUsed >= usage.limits.quotationsPerMonth;

  const resolvedCustomerId = inquiry?.customerId ?? customerId ?? "";
  const customerName =
    customers.find((c) => c.id === resolvedCustomerId)?.name ?? "the customer";

  // A template only pre-fills the editor; nothing is saved until the form is
  // submitted, so switching templates is free.
  const applied = template
    ? applyTemplate(template, {
        customerId: resolvedCustomerId,
        customerName,
        inquiryId: inquiry?.id,
        inquirySubject: inquiry?.subject,
        fallbackCurrency: profile.currency,
        timezone: profile.timezone,
        now,
      })
    : null;

  const currency = applied?.currency ?? profile.currency;

  const values: EditorValues = applied
    ? {
        customerId: resolvedCustomerId,
        inquiryId: inquiry?.id ?? "",
        templateId: template!.id,
        title: applied.title,
        currency,
        notes: applied.notes ?? "",
        terms: applied.terms ?? "",
        validUntil: fmt.dateInput(applied.validUntil ?? null),
        requireSignature: template!.requireSignature,
        lines: applied.items.map((item) => ({
          productId: item.productId ?? "",
          description: item.description,
          quantity: String(item.quantity),
          unit: item.unit,
          unitPrice: centsToInput(item.unitPriceCents, currency),
          taxRate: String(item.taxRateBp / 100),
        })),
      }
    : {
        customerId: resolvedCustomerId,
        inquiryId: inquiry?.id ?? "",
        title: inquiry?.subject ?? "",
        currency,
        notes: profile.defaultNotes ?? "",
        terms: profile.defaultTerms ?? "",
        validUntil: fmt.dateInput(
          defaultValidUntil(now, profile.defaultValidityDays, profile.timezone),
        ),
        requireSignature: profile.requireSignature,
      };

  const baseHref = new URLSearchParams();
  if (inquiry?.id) baseHref.set("inquiryId", inquiry.id);
  if (customerId) baseHref.set("customerId", customerId);
  const linkFor = (id?: string) => {
    const params = new URLSearchParams(baseHref);
    if (id) params.set("templateId", id);
    const query = params.toString();
    return query ? `/quotations/new?${query}` : "/quotations/new";
  };

  return (
    <>
      <PageHeader
        title="New quotation"
        description={inquiry ? `From inquiry: ${inquiry.subject}` : "Build a quotation from scratch."}
      />

      {atLimit ? (
        <Alert tone="warning" title="Monthly quotation limit reached">
          Your {usage.plan} plan allows {usage.limits.quotationsPerMonth} quotations per month.
          Saving will be rejected until the next billing period, or until you upgrade.
        </Alert>
      ) : null}

      {templates.length > 0 ? (
        <Card>
          <CardHeader
            title="Start from a template"
            description="Pre-fills the lines, terms and validity below. Nothing is saved until you submit."
          />
          <nav className="flex flex-wrap gap-2 px-5 py-4" aria-label="Quotation templates">
            <Link
              href={linkFor()}
              className={`btn ${template ? "btn-secondary" : "btn-primary"}`}
            >
              Blank
            </Link>
            {templates.map((entry) => (
              <Link
                key={entry.id}
                href={linkFor(entry.id)}
                className={`btn ${template?.id === entry.id ? "btn-primary" : "btn-secondary"}`}
              >
                {entry.name}
                {entry.isDefault ? " ★" : ""}
              </Link>
            ))}
          </nav>
        </Card>
      ) : null}

      <Card>
        <CardHeader title="Details" />
        {/* Choosing a template is a soft navigation, which leaves this client
            component mounted — and an uncontrolled input ignores a changed
            defaultValue. Keying on the template forces a remount so the new
            values actually appear. */}
        <QuotationEditor
          key={template?.id ?? "blank"}
          action={createQuotationAction}
          customers={customers}
          products={products}
          defaultCurrency={profile.currency}
          defaultTaxRateBp={profile.taxRateBp}
          baseCurrency={profile.currency}
          locale={profile.locale}
          submitLabel="Create quotation"
          cancelHref={inquiry ? `/inquiries/${inquiry.id}` : "/quotations"}
          values={values}
        />
      </Card>
    </>
  );
}
