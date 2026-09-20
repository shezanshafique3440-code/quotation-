import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { prisma } from "@/lib/db";
import { requireTenant } from "@/lib/tenant";
import { createCustomerAction } from "@/server/customer-actions";
import { CustomerForm } from "./customer-form";

export const metadata: Metadata = { title: "Customers" };

export default async function CustomersPage() {
  const { session } = await requireTenant();

  const customers = await prisma.customer.findMany({
    where: { organizationId: session.organizationId },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { quotations: true, inquiries: true } } },
  });

  return (
    <>
      <PageHeader
        title="Customers"
        description="Everyone you quote. Inquiries and quotations hang off these records."
      />

      <Card>
        <CardHeader title="Add a customer" />
        <CustomerForm action={createCustomerAction} submitLabel="Add customer" resetOnSuccess />
      </Card>

      <Card>
        <CardHeader title={`${customers.length} customer${customers.length === 1 ? "" : "s"}`} />
        {customers.length === 0 ? (
          <EmptyState
            title="No customers yet"
            description="Add your first customer above, then log the inquiry they sent you."
          />
        ) : (
          <ul className="divide-y divide-[var(--color-line)]">
            {customers.map((customer) => (
              <li key={customer.id}>
                <Link
                  href={`/customers/${customer.id}`}
                  className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-[var(--color-surface-2)]"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{customer.name}</p>
                    <p className="truncate text-xs text-[var(--color-ink-muted)]">
                      {[customer.company, customer.email, customer.phone]
                        .filter(Boolean)
                        .join(" · ") || "No contact details"}
                    </p>
                  </div>
                  <p className="shrink-0 text-xs text-[var(--color-ink-muted)]">
                    {customer._count.quotations} quote{customer._count.quotations === 1 ? "" : "s"} ·{" "}
                    {customer._count.inquiries} inquir{customer._count.inquiries === 1 ? "y" : "ies"}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
