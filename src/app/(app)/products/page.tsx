import type { Metadata } from "next";
import { ConfirmForm } from "@/components/confirm-form";
import { Alert, Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { prisma } from "@/lib/db";
import { bpToInput, centsToInput } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { requireTenant } from "@/lib/tenant";
import { getUsage } from "@/lib/usage";
import {
  createProductAction,
  deleteProductAction,
  updateProductAction,
} from "@/server/product-actions";
import { ProductForm } from "./product-form";

export const metadata: Metadata = { title: "Catalog" };

export default async function ProductsPage() {
  const { session, profile } = await requireTenant();

  const [products, usage] = await Promise.all([
    prisma.product.findMany({
      where: { organizationId: session.organizationId },
      orderBy: [{ active: "desc" }, { name: "asc" }],
    }),
    getUsage(session.organizationId),
  ]);

  const atLimit =
    usage.limits.products !== null && usage.productsUsed >= usage.limits.products;

  return (
    <>
      <PageHeader
        title="Product catalog"
        description="Priced items the AI drafter and the quotation builder pull from."
      />

      {atLimit ? (
        <Alert tone="warning" title="Catalog limit reached">
          Your {usage.plan} plan allows {usage.limits.products} active products. Deactivate one or
          upgrade to add more.
        </Alert>
      ) : null}

      <Card>
        <CardHeader
          title="Add a product"
          description={
            usage.limits.products === null
              ? `${usage.productsUsed} active`
              : `${usage.productsUsed} of ${usage.limits.products} active slots used`
          }
        />
        <ProductForm
          action={createProductAction}
          submitLabel="Add product"
          currency={profile.currency}
          resetOnSuccess
        />
      </Card>

      <Card>
        <CardHeader title={`${products.length} product${products.length === 1 ? "" : "s"}`} />
        {products.length === 0 ? (
          <EmptyState
            title="Your catalog is empty"
            description="Add the things you sell. The AI drafter prefers catalog items and always uses your stored price, never one it made up."
          />
        ) : (
          <ul className="divide-y divide-[var(--color-line)]">
            {products.map((product) => (
              <li key={product.id}>
                <details className="group">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 hover:bg-[var(--color-surface-2)]">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 truncate text-sm font-medium">
                        {product.name}
                        {!product.active ? <Badge>Inactive</Badge> : null}
                      </p>
                      <p className="truncate text-xs text-[var(--color-ink-muted)]">
                        {[product.sku, `per ${product.unit}`].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-medium tabular-nums">
                      {formatMoney(product.unitPriceCents, profile.currency, profile.locale)}
                    </span>
                  </summary>

                  <div className="border-t border-[var(--color-line)] bg-[var(--color-surface-2)]">
                    <ProductForm
                      action={updateProductAction}
                      submitLabel="Save product"
                      currency={profile.currency}
                      values={{
                        id: product.id,
                        name: product.name,
                        sku: product.sku,
                        description: product.description,
                        unitPrice: centsToInput(product.unitPriceCents),
                        unit: product.unit,
                        taxRate: bpToInput(product.taxRateBp),
                        active: product.active,
                      }}
                    />
                    <div className="px-5 pb-4">
                      <ConfirmForm
                        action={deleteProductAction}
                        fields={{ id: product.id }}
                        label="Delete product"
                        pendingLabel="Deleting…"
                        variant="danger"
                        confirm={`Delete ${product.name}? Quotations that already use it keep their prices.`}
                      />
                    </div>
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
