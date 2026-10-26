import type { Metadata } from "next";
import Link from "next/link";
import { ListSearch, Pagination } from "@/components/list-controls";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { parseListQuery, type ListSearchParams } from "@/lib/pagination";
import { listCustomers } from "@/lib/records";
import { requireTenant } from "@/lib/tenant";
import { createCustomerAction } from "@/server/customer-actions";
import { CustomerForm } from "./customer-form";

export const metadata: Metadata = { title: "Customers" };

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<ListSearchParams>;
}) {
  const { session } = await requireTenant();
  const options = parseListQuery(await searchParams);
  const { rows: customers, pagination, query } = await listCustomers(session.organizationId, options);

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
        <CardHeader title={`${pagination.total} customer${pagination.total === 1 ? "" : "s"}`} />
        <div className="border-b border-[var(--color-line)] px-5 py-4">
          <ListSearch
            pathname="/customers"
            query={query}
            label="Search customers"
            placeholder="Name, company, email or phone"
          />
        </div>
        {customers.length === 0 ? (
          <EmptyState
            title={query ? "No matching customers" : "No customers yet"}
            description={query ? "Try another name, company or contact detail, or clear the search." : "Add your first customer above, then log the inquiry they sent you."}
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
        <Pagination pathname="/customers" pagination={pagination} query={query} />
      </Card>
    </>
  );
}
