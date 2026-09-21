import type { Metadata } from "next";
import { ConfirmForm } from "@/components/confirm-form";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { prisma } from "@/lib/db";
import { bpToInput, centsToInput } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { computeTotals } from "@/lib/money";
import { requireTenant } from "@/lib/tenant";
import {
  createTemplateAction,
  deleteTemplateAction,
  updateTemplateAction,
} from "@/server/template-actions";
import { TemplateForm } from "./template-form";

export const metadata: Metadata = {
  title: "Templates",
  description: "Reusable quotation templates with pre-priced lines, terms and validity.",
};

export default async function TemplatesPage() {
  const { session, profile } = await requireTenant();

  const [templates, products] = await Promise.all([
    prisma.quotationTemplate.findMany({
      where: { organizationId: session.organizationId },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
      include: { items: { orderBy: { position: "asc" } } },
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
  ]);

  return (
    <>
      <PageHeader
        title="Quotation templates"
        description="Start a quotation from a saved set of lines, terms and validity instead of an empty page."
      />

      <Card>
        <CardHeader
          title="New template"
          description="Lines can come from your catalog or be written by hand."
        />
        <TemplateForm
          action={createTemplateAction}
          products={products}
          defaultTaxRateBp={profile.taxRateBp}
          defaultValidityDays={profile.defaultValidityDays}
          submitLabel="Save template"
          resetOnSuccess
        />
      </Card>

      <Card>
        <CardHeader title={`${templates.length} template${templates.length === 1 ? "" : "s"}`} />
        {templates.length === 0 ? (
          <EmptyState
            title="No templates yet"
            description="Save the quotation you send most often as a template, and the next one starts half-written."
          />
        ) : (
          <ul className="divide-y divide-[var(--color-line)]">
            {templates.map((template) => {
              const currency = template.currency ?? profile.currency;
              const totals = computeTotals(
                template.items.map((item) => ({
                  quantity: item.quantity,
                  unitPriceCents: item.unitPriceCents,
                  taxRateBp: item.taxRateBp,
                })),
              );

              return (
                <li key={template.id}>
                  <details className="group">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 hover:bg-[var(--color-surface-2)]">
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 truncate text-sm font-medium">
                          {template.name}
                          {template.isDefault ? <Badge tone="brand">Default</Badge> : null}
                          {template.requireSignature ? <Badge>Signature</Badge> : null}
                        </p>
                        <p className="truncate text-xs text-[var(--color-ink-muted)]">
                          {template.items.length} line{template.items.length === 1 ? "" : "s"} ·
                          valid {template.validityDays} days
                          {template.description ? ` · ${template.description}` : ""}
                        </p>
                      </div>
                      <span className="shrink-0 text-sm font-medium tabular-nums">
                        {formatMoney(totals.totalCents, currency, profile.locale)}
                      </span>
                    </summary>

                    <div className="border-t border-[var(--color-line)] bg-[var(--color-surface-2)]">
                      <TemplateForm
                        action={updateTemplateAction}
                        products={products}
                        defaultTaxRateBp={profile.taxRateBp}
                        defaultValidityDays={profile.defaultValidityDays}
                        submitLabel="Save changes"
                        values={{
                          id: template.id,
                          name: template.name,
                          description: template.description,
                          titlePattern: template.titlePattern,
                          notes: template.notes,
                          terms: template.terms,
                          currency: template.currency,
                          validityDays: String(template.validityDays),
                          requireSignature: template.requireSignature,
                          isDefault: template.isDefault,
                          lines: template.items.map((item) => ({
                            productId: item.productId ?? "",
                            description: item.description,
                            quantity: String(item.quantity),
                            unit: item.unit,
                            unitPrice: centsToInput(item.unitPriceCents, currency),
                            taxRate: bpToInput(item.taxRateBp),
                          })),
                        }}
                      />
                      <div className="px-5 pb-4">
                        <ConfirmForm
                          action={deleteTemplateAction}
                          fields={{ id: template.id }}
                          label="Delete template"
                          pendingLabel="Deleting…"
                          variant="danger"
                          confirm={`Delete "${template.name}"? Quotations already created from it are unchanged.`}
                        />
                      </div>
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
