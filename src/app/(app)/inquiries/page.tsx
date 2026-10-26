import type { Metadata } from "next";
import Link from "next/link";
import { ListSearch, Pagination } from "@/components/list-controls";
import { Badge, Card, CardHeader, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import {
  INQUIRY_CHANNEL_LABELS,
  INQUIRY_STATUS_LABELS,
  type InquiryChannel,
  type InquiryStatus,
} from "@/lib/constants";
import { prisma } from "@/lib/db";
import { parseListQuery, type ListSearchParams } from "@/lib/pagination";
import { listInquiries } from "@/lib/records";
import { requireTenant } from "@/lib/tenant";
import { createInquiryAction } from "@/server/inquiry-actions";
import { InquiryForm } from "./inquiry-form";

export const metadata: Metadata = { title: "Inquiries" };

const STATUS_TONE: Record<InquiryStatus, "neutral" | "brand" | "positive"> = {
  new: "brand",
  quoted: "neutral",
  won: "positive",
  archived: "neutral",
};

export default async function InquiriesPage({
  searchParams,
}: {
  searchParams: Promise<ListSearchParams>;
}) {
  const { query, page } = parseListQuery(await searchParams);
  const { session, fmt } = await requireTenant();

  const [customers, { rows: inquiries, pagination }] = await Promise.all([
    prisma.customer.findMany({
      where: { organizationId: session.organizationId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, company: true },
    }),
    listInquiries(session.organizationId, { query, page }),
  ]);

  return (
    <>
      <PageHeader
        title="Inquiries"
        description="Every request that came in, and whether it has been quoted."
      />

      <Card>
        <CardHeader title="Log an inquiry" />
        <InquiryForm action={createInquiryAction} customers={customers} />
      </Card>

      <ListSearch
        pathname="/inquiries"
        query={query}
        label="Search inquiries"
        placeholder="Subject, message or customer"
      />

      <Card>
        <CardHeader title={`${pagination.total} ${query ? "matching " : ""}inquir${pagination.total === 1 ? "y" : "ies"}`} />
        {inquiries.length === 0 ? (
          <EmptyState
            title={query ? "No inquiries match your search" : "Nothing logged yet"}
            description={query
              ? "Try another subject, message or customer."
              : "Log the first request and turn it into a quotation in a couple of clicks."}
            action={query ? <LinkButton href="/inquiries">Clear search</LinkButton> : undefined}
          />
        ) : (
          <ul className="divide-y divide-[var(--color-line)]">
            {inquiries.map((inquiry) => (
              <li key={inquiry.id}>
                <Link
                  href={`/inquiries/${inquiry.id}`}
                  className="flex items-start justify-between gap-3 px-5 py-3 hover:bg-[var(--color-surface-2)]"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{inquiry.subject}</p>
                    <p className="truncate text-xs text-[var(--color-ink-muted)]">
                      {inquiry.customer.name} ·{" "}
                      {INQUIRY_CHANNEL_LABELS[inquiry.channel as InquiryChannel] ?? inquiry.channel} ·{" "}
                      {fmt.date(inquiry.receivedAt)}
                      {inquiry._count.quotations > 0
                        ? ` · ${inquiry._count.quotations} quotation${inquiry._count.quotations === 1 ? "" : "s"}`
                        : ""}
                    </p>
                  </div>
                  <Badge tone={STATUS_TONE[inquiry.status as InquiryStatus] ?? "neutral"}>
                    {INQUIRY_STATUS_LABELS[inquiry.status as InquiryStatus] ?? inquiry.status}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <Pagination pathname="/inquiries" query={query} pagination={pagination} />
      </Card>
    </>
  );
}
