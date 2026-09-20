import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ConfirmForm } from "@/components/confirm-form";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui";
import {
  INQUIRY_CHANNEL_LABELS,
  INQUIRY_STATUS_LABELS,
  QUOTATION_STATUS_LABELS,
  type InquiryChannel,
  type InquiryStatus,
  type QuotationStatus,
} from "@/lib/constants";
import { prisma } from "@/lib/db";
import { isAiConfigured } from "@/lib/env";
import { formatDateTime } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { requireTenant } from "@/lib/tenant";
import { deleteInquiryAction, updateInquiryStatusAction } from "@/server/inquiry-actions";
import { AiDraftPanel } from "./ai-draft-panel";

export const metadata: Metadata = { title: "Inquiry" };

export default async function InquiryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { session, profile } = await requireTenant();

  const inquiry = await prisma.inquiry.findFirst({
    where: { id, organizationId: session.organizationId },
    include: {
      customer: true,
      quotations: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!inquiry) notFound();

  const aiEnabled = isAiConfigured();

  return (
    <>
      <PageHeader
        title={inquiry.subject}
        description={`${inquiry.customer.name} · ${INQUIRY_CHANNEL_LABELS[inquiry.channel as InquiryChannel] ?? inquiry.channel} · ${formatDateTime(inquiry.receivedAt, profile.locale)}`}
        action={
          <Link href="/inquiries" className="btn btn-secondary">
            All inquiries
          </Link>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="brand">
          {INQUIRY_STATUS_LABELS[inquiry.status as InquiryStatus] ?? inquiry.status}
        </Badge>
        <Link href={`/customers/${inquiry.customerId}`} className="text-sm text-[var(--color-brand)] hover:underline">
          {inquiry.customer.name}
        </Link>
      </div>

      <Card>
        <CardHeader title="What they asked for" />
        <p className="whitespace-pre-wrap px-5 py-4 text-sm leading-relaxed">{inquiry.message}</p>
      </Card>

      <Card>
        <CardHeader
          title="Draft a quotation"
          description="The draft uses your catalog prices and lands in Draft status so you can edit it."
        />
        <AiDraftPanel
          inquiryId={inquiry.id}
          enabled={aiEnabled}
          disabledReason={
            aiEnabled
              ? undefined
              : "Set AI_PROVIDER=anthropic and ANTHROPIC_API_KEY on the server to enable AI drafting. Until then, quotations are built manually."
          }
        />
      </Card>

      {inquiry.quotations.length > 0 ? (
        <Card>
          <CardHeader title={`Quotations from this inquiry (${inquiry.quotations.length})`} />
          <ul className="divide-y divide-[var(--color-line)]">
            {inquiry.quotations.map((q) => (
              <li key={q.id}>
                <Link
                  href={`/quotations/${q.id}`}
                  className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-[var(--color-surface-2)]"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{q.title}</p>
                    <p className="text-xs text-[var(--color-ink-muted)]">
                      {q.number}
                      {q.aiGenerated ? " · AI draft" : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="text-sm tabular-nums">
                      {formatMoney(q.totalCents, q.currency, profile.locale)}
                    </span>
                    <Badge>{QUOTATION_STATUS_LABELS[q.status as QuotationStatus] ?? q.status}</Badge>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        <CardHeader title="Status" />
        <div className="flex flex-wrap gap-2 px-5 py-4">
          {(["new", "quoted", "won", "archived"] as const)
            .filter((status) => status !== inquiry.status)
            .map((status) => (
              <ConfirmForm
                key={status}
                action={updateInquiryStatusAction}
                fields={{ id: inquiry.id, status }}
                label={`Mark ${INQUIRY_STATUS_LABELS[status].toLowerCase()}`}
                pendingLabel="Updating…"
                showResult={false}
              />
            ))}
        </div>
        <div className="border-t border-[var(--color-line)] px-5 py-4">
          <ConfirmForm
            action={deleteInquiryAction}
            fields={{ id: inquiry.id }}
            label="Delete inquiry"
            pendingLabel="Deleting…"
            variant="danger"
            confirm="Delete this inquiry? Quotations already created from it are kept."
          />
        </div>
      </Card>
    </>
  );
}
