import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ConfirmForm } from "@/components/confirm-form";
import { Timeline } from "@/components/timeline";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui";
import { customerTimeline } from "@/lib/activity";
import { isEmailConfigured } from "@/lib/env";
import { hasActivePortalLink } from "@/lib/portal";
import { QUOTATION_STATUS_LABELS, type QuotationStatus } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { requireTenant } from "@/lib/tenant";
import { deleteCustomerAction, updateCustomerAction } from "@/server/customer-actions";
import { CustomerForm } from "../customer-form";
import { PortalPanel } from "./portal-panel";

export const metadata: Metadata = { title: "Customer" };

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { session, fmt } = await requireTenant();

  const customer = await prisma.customer.findFirst({
    where: { id, organizationId: session.organizationId },
    include: {
      quotations: { orderBy: { createdAt: "desc" }, take: 20 },
      inquiries: { orderBy: { receivedAt: "desc" }, take: 20 },
    },
  });
  if (!customer) notFound();

  const [timeline, portal] = await Promise.all([
    customerTimeline(session.organizationId, customer.id),
    hasActivePortalLink(session.organizationId, customer.id),
  ]);

  return (
    <>
      <PageHeader
        title={customer.name}
        description={customer.company ?? "Customer record"}
        action={
          <Link href="/customers" className="btn btn-secondary">
            All customers
          </Link>
        }
      />

      <Card>
        <CardHeader title="Details" />
        <CustomerForm action={updateCustomerAction} values={customer} submitLabel="Save changes" />
      </Card>

      <Card>
        <CardHeader
          title="Customer portal"
          description="One page where this customer can see every quotation you have sent them."
        />
        <PortalPanel
          customerId={customer.id}
          hasActiveLink={portal.active}
          expiresLabel={portal.expiresAt ? fmt.date(portal.expiresAt) : null}
          emailEnabled={isEmailConfigured()}
          customerEmail={customer.email}
        />
      </Card>

      <Card>
        <CardHeader title={`Quotations (${customer.quotations.length})`} />
        {customer.quotations.length === 0 ? (
          <p className="px-5 py-6 text-sm text-[var(--color-ink-muted)]">
            No quotations for this customer yet.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--color-line)]">
            {customer.quotations.map((q) => (
              <li key={q.id}>
                <Link
                  href={`/quotations/${q.id}`}
                  className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-[var(--color-surface-2)]"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{q.title}</p>
                    <p className="text-xs text-[var(--color-ink-muted)]">
                      {q.number} · {fmt.date(q.createdAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="text-sm tabular-nums">
                      {fmt.money(q.totalCents, q.currency)}
                    </span>
                    <Badge>{QUOTATION_STATUS_LABELS[q.status as QuotationStatus] ?? q.status}</Badge>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title={`Inquiries (${customer.inquiries.length})`} />
        {customer.inquiries.length === 0 ? (
          <p className="px-5 py-6 text-sm text-[var(--color-ink-muted)]">No inquiries logged.</p>
        ) : (
          <ul className="divide-y divide-[var(--color-line)]">
            {customer.inquiries.map((inquiry) => (
              <li key={inquiry.id}>
                <Link
                  href={`/inquiries/${inquiry.id}`}
                  className="block px-5 py-3 hover:bg-[var(--color-surface-2)]"
                >
                  <p className="truncate text-sm font-medium">{inquiry.subject}</p>
                  <p className="text-xs text-[var(--color-ink-muted)]">
                    {inquiry.channel} · {fmt.date(inquiry.receivedAt)}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Activity"
          description="Everything recorded for this customer, newest first."
        />
        <Timeline
          entries={timeline}
          fmt={fmt}
          emptyMessage="No activity recorded yet for this customer."
        />
      </Card>

      <Card>
        <CardHeader
          title="Danger zone"
          description="A customer with quotations cannot be deleted — that history stays intact."
        />
        <div className="px-5 py-4">
          <ConfirmForm
            action={deleteCustomerAction}
            fields={{ id: customer.id }}
            label="Delete customer"
            pendingLabel="Deleting…"
            variant="danger"
            confirm={`Delete ${customer.name}? This cannot be undone.`}
          />
        </div>
      </Card>
    </>
  );
}
