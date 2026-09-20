import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import {
  INQUIRY_CHANNEL_LABELS,
  INQUIRY_STATUS_LABELS,
  type InquiryChannel,
  type InquiryStatus,
} from "@/lib/constants";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/format";
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

export default async function InquiriesPage() {
  const { session, profile } = await requireTenant();

  const [customers, inquiries] = await Promise.all([
    prisma.customer.findMany({
      where: { organizationId: session.organizationId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, company: true },
    }),
    prisma.inquiry.findMany({
      where: { organizationId: session.organizationId },
      orderBy: { receivedAt: "desc" },
      take: 100,
      include: {
        customer: { select: { name: true } },
        _count: { select: { quotations: true } },
      },
    }),
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

      <Card>
        <CardHeader title={`${inquiries.length} inquir${inquiries.length === 1 ? "y" : "ies"}`} />
        {inquiries.length === 0 ? (
          <EmptyState
            title="Nothing logged yet"
            description="Log the first request and turn it into a quotation in a couple of clicks."
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
                      {formatDate(inquiry.receivedAt, profile.locale)}
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
      </Card>
    </>
  );
}
