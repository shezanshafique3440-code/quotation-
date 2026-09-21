import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ConfirmForm } from "@/components/confirm-form";
import { Timeline } from "@/components/timeline";
import { Alert, Badge, Card, CardHeader, PageHeader } from "@/components/ui";
import { quotationTimeline } from "@/lib/activity";
import { prisma } from "@/lib/db";
import { isAiConfigured, isEmailConfigured } from "@/lib/env";
import { shareUrl } from "@/lib/sharing";
import {
  QUOTATION_STATUS_LABELS,
  QUOTATION_TRANSITIONS,
  REMINDER_CHANNEL_LABELS,
  type QuotationStatus,
  type ReminderChannel,
} from "@/lib/constants";
import { NotFoundError } from "@/lib/errors";
import { formatBp } from "@/lib/money";
import { getQuotation } from "@/lib/quotations";
import { requireTenant } from "@/lib/tenant";
import { buildQuotationMessage, normalizeWhatsAppNumber } from "@/lib/whatsapp";
import {
  deleteQuotationAction,
  updateQuotationStatusAction,
} from "@/server/quotation-actions";
import {
  cancelReminderAction,
  completeReminderAction,
  snoozeReminderAction,
} from "@/server/reminder-actions";
import { EmailPanel } from "./email-panel";
import { FollowUpDrafter } from "./follow-up-drafter";
import { ReminderForm } from "./reminder-form";
import { SharePanel } from "./share-panel";
import { WhatsAppPanel } from "./whatsapp-panel";

export const metadata: Metadata = { title: "Quotation" };

const STATUS_TONE: Record<QuotationStatus, "neutral" | "brand" | "positive" | "warning" | "danger"> = {
  draft: "neutral",
  sent: "brand",
  accepted: "positive",
  rejected: "danger",
  expired: "warning",
};

export default async function QuotationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { session, profile, fmt } = await requireTenant();

  let quotation;
  try {
    quotation = await getQuotation(session.organizationId, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const status = quotation.status as QuotationStatus;
  const money = (cents: number) => fmt.money(cents, quotation.currency);
  const now = new Date();
  const timeline = await quotationTimeline(session.organizationId, quotation.id);
  const lastEmail = await prisma.emailDelivery.findFirst({
    where: {
      organizationId: session.organizationId,
      quotationId: quotation.id,
      kind: "quotation",
      status: "sent",
    },
    orderBy: { sentAt: "desc" },
    select: { toEmail: true, sentAt: true },
  });

  const whatsappMessage = buildQuotationMessage(quotation, {
    legalName: profile.legalName,
    locale: profile.locale,
    phone: profile.phone,
    website: profile.website,
  });

  const pendingReminders = quotation.reminders.filter((r) => r.status === "pending");
  const expired =
    status === "sent" && quotation.validUntil !== null && quotation.validUntil < now;

  return (
    <>
      <PageHeader
        title={quotation.number}
        description={`${quotation.title} · ${quotation.customer.name}`}
        action={
          <div className="flex flex-wrap gap-2">
            <a
              href={`/api/quotations/${quotation.id}/pdf`}
              className="btn btn-secondary"
              target="_blank"
              rel="noopener noreferrer"
            >
              Download PDF
            </a>
            {status === "draft" ? (
              <Link href={`/quotations/${quotation.id}/edit`} className="btn btn-primary">
                Edit
              </Link>
            ) : null}
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={STATUS_TONE[status] ?? "neutral"}>
          {QUOTATION_STATUS_LABELS[status] ?? status}
        </Badge>
        {quotation.aiGenerated ? <Badge tone="brand">AI draft</Badge> : null}
        <Link
          href={`/customers/${quotation.customerId}`}
          className="text-sm text-[var(--color-brand)] hover:underline"
        >
          {quotation.customer.name}
        </Link>
        {quotation.inquiry ? (
          <Link
            href={`/inquiries/${quotation.inquiry.id}`}
            className="text-sm text-[var(--color-ink-muted)] hover:underline"
          >
            From inquiry: {quotation.inquiry.subject}
          </Link>
        ) : null}
      </div>

      {expired ? (
        <Alert tone="warning" title="Past its validity date">
          This quotation was valid until {fmt.date(quotation.validUntil)}. Mark it
          expired, or edit it back to draft and reissue.
        </Alert>
      ) : null}

      <Card>
        <CardHeader
          title="Line items"
          description={
            quotation.validUntil
              ? `Valid until ${fmt.date(quotation.validUntil)}`
              : "No validity date set"
          }
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-xl text-sm">
            <thead>
              <tr className="border-b border-[var(--color-line)] text-left text-xs uppercase tracking-wide text-[var(--color-ink-subtle)]">
                <th className="px-5 py-2 font-medium">Description</th>
                <th className="px-3 py-2 text-right font-medium">Qty</th>
                <th className="px-3 py-2 text-right font-medium">Unit price</th>
                <th className="px-3 py-2 text-right font-medium">Tax</th>
                <th className="px-5 py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-line)]">
              {quotation.items.map((item) => (
                <tr key={item.id}>
                  <td className="px-5 py-3">{item.description}</td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {Number.isInteger(item.quantity) ? item.quantity : item.quantity.toFixed(2)}{" "}
                    <span className="text-[var(--color-ink-subtle)]">{item.unit}</span>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">{money(item.unitPriceCents)}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-[var(--color-ink-muted)]">
                    {formatBp(item.taxRateBp)}
                  </td>
                  <td className="px-5 py-3 text-right font-medium tabular-nums">
                    {money(item.lineTotalCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="border-t border-[var(--color-line)] px-5 py-4">
          <dl className="ml-auto max-w-xs space-y-1.5 text-sm">
            <div className="flex justify-between">
              <dt className="text-[var(--color-ink-muted)]">Subtotal</dt>
              <dd className="tabular-nums">{money(quotation.subtotalCents)}</dd>
            </div>
            {quotation.discountCents > 0 ? (
              <div className="flex justify-between">
                <dt className="text-[var(--color-ink-muted)]">Discount</dt>
                <dd className="tabular-nums">-{money(quotation.discountCents)}</dd>
              </div>
            ) : null}
            {quotation.taxCents > 0 ? (
              <div className="flex justify-between">
                <dt className="text-[var(--color-ink-muted)]">Tax</dt>
                <dd className="tabular-nums">{money(quotation.taxCents)}</dd>
              </div>
            ) : null}
            <div className="flex justify-between border-t border-[var(--color-line)] pt-1.5 text-base font-semibold">
              <dt>Total</dt>
              <dd className="tabular-nums">{money(quotation.totalCents)}</dd>
            </div>
          </dl>
        </div>
      </Card>

      {quotation.notes?.trim() || quotation.terms?.trim() ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {quotation.notes?.trim() ? (
            <Card>
              <CardHeader title="Notes" />
              <p className="whitespace-pre-wrap px-5 py-4 text-sm leading-relaxed">
                {quotation.notes}
              </p>
            </Card>
          ) : null}
          {quotation.terms?.trim() ? (
            <Card>
              <CardHeader title="Terms" />
              <p className="whitespace-pre-wrap px-5 py-4 text-sm leading-relaxed">
                {quotation.terms}
              </p>
            </Card>
          ) : null}
        </div>
      ) : null}

      <Card>
        <CardHeader
          title="Share with the customer"
          description="A link they can open to read the quotation and accept or decline it."
        />
        <SharePanel
          quotationId={quotation.id}
          enabled={quotation.publicEnabled && Boolean(quotation.publicToken)}
          shareUrl={quotation.publicToken ? shareUrl(quotation.publicToken) : null}
          isDraft={status === "draft"}
          publicPagesEnabled={profile.publicPagesEnabled}
          viewCount={quotation.viewCount}
          firstViewedLabel={quotation.firstViewedAt ? fmt.dateTime(quotation.firstViewedAt) : null}
          lastViewedLabel={quotation.lastViewedAt ? fmt.dateTime(quotation.lastViewedAt) : null}
        />
      </Card>

      <Card>
        <CardHeader
          title="Send by email"
          description="QuoteFlow sends it and records the result — it never reports a send that did not happen."
        />
        <EmailPanel
          quotationId={quotation.id}
          enabled={isEmailConfigured()}
          defaultTo={quotation.customer.email}
          isDraft={status === "draft"}
          lastSent={
            lastEmail?.sentAt
              ? { toEmail: lastEmail.toEmail, sentAtLabel: fmt.dateTime(lastEmail.sentAt) }
              : null
          }
        />
      </Card>

      {quotation.respondedAt ? (
        <Card>
          <CardHeader
            title="Customer response"
            description={
              quotation.decisionSource === "public_page"
                ? "Recorded from the online quotation page."
                : "Recorded by your team."
            }
          />
          <dl className="grid gap-3 px-5 py-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-[var(--color-ink-subtle)]">Decision</dt>
              <dd className="font-medium">
                {QUOTATION_STATUS_LABELS[status] ?? status}
                {quotation.respondedByName ? ` by ${quotation.respondedByName}` : ""}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--color-ink-subtle)]">When</dt>
              <dd>{fmt.dateTime(quotation.respondedAt)}</dd>
            </div>
            {quotation.signedAt ? (
              <div className="sm:col-span-2">
                <dt className="text-xs text-[var(--color-ink-subtle)]">Electronic signature</dt>
                <dd className="font-serif text-lg">{quotation.signatureName}</dd>
                <dd className="text-xs text-[var(--color-ink-muted)]">
                  Typed on {fmt.dateTime(quotation.signedAt)}
                  {quotation.signatureEmail ? ` · ${quotation.signatureEmail}` : ""}
                  {quotation.signatureIpHash ? " · IP recorded as a one-way hash" : ""}
                </dd>
              </div>
            ) : null}
            {quotation.rejectionReason ? (
              <div className="sm:col-span-2">
                <dt className="text-xs text-[var(--color-ink-subtle)]">Reason given</dt>
                <dd className="whitespace-pre-wrap">{quotation.rejectionReason}</dd>
              </div>
            ) : null}
          </dl>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title="WhatsApp message"
          description="Edit the text, then open WhatsApp to send it yourself."
        />
        <WhatsAppPanel
          initialMessage={whatsappMessage}
          number={normalizeWhatsAppNumber(quotation.customer.whatsapp ?? quotation.customer.phone)}
        />
      </Card>

      <Card>
        <CardHeader
          title="Status"
          description={[
            quotation.sentAt ? `Sent ${fmt.dateTime(quotation.sentAt)}` : null,
            quotation.decidedAt
              ? `Decided ${fmt.dateTime(quotation.decidedAt)}`
              : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        />
        <div className="flex flex-wrap gap-2 px-5 py-4">
          {QUOTATION_TRANSITIONS[status].length === 0 ? (
            <p className="text-sm text-[var(--color-ink-muted)]">
              {QUOTATION_STATUS_LABELS[status]} is final — the record stays as it is so your reporting
              is accurate.
            </p>
          ) : (
            QUOTATION_TRANSITIONS[status].map((next) => (
              <ConfirmForm
                key={next}
                action={updateQuotationStatusAction}
                fields={{ id: quotation.id, status: next }}
                label={`Mark ${QUOTATION_STATUS_LABELS[next].toLowerCase()}`}
                pendingLabel="Updating…"
                variant={next === "accepted" ? "primary" : "secondary"}
                showResult={false}
                confirm={
                  next === "accepted" || next === "rejected"
                    ? `Mark ${quotation.number} as ${QUOTATION_STATUS_LABELS[next].toLowerCase()}? This is final.`
                    : undefined
                }
              />
            ))
          )}
        </div>
        {status === "draft" ? (
          <div className="border-t border-[var(--color-line)] px-5 py-4">
            <ConfirmForm
              action={deleteQuotationAction}
              fields={{ id: quotation.id }}
              label="Delete draft"
              pendingLabel="Deleting…"
              variant="danger"
              confirm={`Delete draft ${quotation.number}? This cannot be undone.`}
            />
          </div>
        ) : null}
      </Card>

      <Card>
        <CardHeader
          title="Follow-ups"
          description={`${pendingReminders.length} pending`}
        />
        {quotation.reminders.length > 0 ? (
          <ul className="divide-y divide-[var(--color-line)]">
            {quotation.reminders.map((reminder) => (
              <li key={reminder.id} className="px-5 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm">
                      {reminder.note?.trim() ||
                        `Follow up by ${REMINDER_CHANNEL_LABELS[reminder.channel as ReminderChannel] ?? reminder.channel}`}
                    </p>
                    <p className="text-xs text-[var(--color-ink-muted)]">
                      {fmt.dateTime(reminder.dueAt)}
                      {reminder.status === "pending"
                        ? ` · ${fmt.relative(reminder.dueAt, now)}`
                        : ` · ${reminder.status}`}
                    </p>
                  </div>
                  {reminder.status === "pending" ? (
                    <div className="flex flex-wrap gap-2">
                      <ConfirmForm
                        action={completeReminderAction}
                        fields={{ id: reminder.id }}
                        label="Done"
                        pendingLabel="…"
                        showResult={false}
                      />
                      <ConfirmForm
                        action={snoozeReminderAction}
                        fields={{ id: reminder.id, days: "3" }}
                        label="Snooze 3 days"
                        pendingLabel="…"
                        variant="ghost"
                        showResult={false}
                      />
                      <ConfirmForm
                        action={cancelReminderAction}
                        fields={{ id: reminder.id }}
                        label="Cancel"
                        pendingLabel="…"
                        variant="ghost"
                        showResult={false}
                      />
                    </div>
                  ) : (
                    <Badge tone={reminder.status === "done" ? "positive" : "neutral"}>
                      {reminder.status}
                    </Badge>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="border-t border-[var(--color-line)]">
          <ReminderForm
            quotationId={quotation.id}
            defaultDueAt={fmt.dateTimeInput(new Date(now.getTime() + 3 * 86_400_000))}
          />
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Draft a follow-up"
          description="QuoteFlow writes the message; you send it."
        />
        <FollowUpDrafter quotationId={quotation.id} enabled={isAiConfigured()} />
      </Card>

      <Card>
        <CardHeader title="Timeline" description="Every recorded event on this quotation." />
        <Timeline
          entries={timeline}
          fmt={fmt}
          emptyMessage="Nothing recorded yet. Events appear as the quotation is sent, opened and answered."
        />
      </Card>
    </>
  );
}
