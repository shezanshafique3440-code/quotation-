import type { Metadata } from "next";
import { brandCssVariables } from "@/lib/branding";
import { createFormatter } from "@/lib/format";
import { formatBp } from "@/lib/money";
import { loadPublicQuotation, toPublicView } from "@/lib/sharing";
import { RespondForm } from "./respond-form";
import { ViewTracker } from "./view-tracker";

export const dynamic = "force-dynamic";

/**
 * A quotation link is private-by-URL. It must never be indexed, and it must
 * not leak the customer or business name into a search result.
 */
export const metadata: Metadata = {
  title: "Quotation",
  robots: { index: false, follow: false, nocache: true },
};

function Unavailable() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-5 py-16">
      <div className="card max-w-md p-8 text-center">
        <h1 className="text-lg font-semibold">This quotation is not available</h1>
        <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
          The link may have been replaced, switched off, or the quotation may have been withdrawn.
          Please contact the person who sent it to you for an up-to-date link.
        </p>
      </div>
    </main>
  );
}

export default async function PublicQuotationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const record = await loadPublicQuotation(token);
  if (!record) return <Unavailable />;

  const view = toPublicView(record);
  const fmt = createFormatter({
    locale: view.business.locale,
    timezone: view.business.timezone,
    currency: view.currency,
  });

  const canRespond = view.status === "sent" && !view.expired && !view.decided;

  const statusBanner = view.decided
    ? {
        tone: view.status === "accepted" ? "positive" : "neutral",
        title: view.status === "accepted" ? "Accepted" : "Declined",
        body:
          view.status === "accepted"
            ? `Accepted${view.respondedAt ? ` on ${fmt.dateTime(view.respondedAt)}` : ""}${
                view.signatureName ? ` and signed by ${view.signatureName}` : ""
              }.`
            : `Declined${view.respondedAt ? ` on ${fmt.dateTime(view.respondedAt)}` : ""}.`,
      }
    : view.expired
      ? {
          tone: "warning" as const,
          title: "This quotation has expired",
          body: view.validUntil
            ? `It was valid until ${fmt.date(view.validUntil)}. Ask the sender for an updated version.`
            : "Ask the sender for an updated version.",
        }
      : null;

  return (
    <div style={brandCssVariables(record.organization.profile?.brandColor)}>
      <ViewTracker token={token} />

      <div className="min-h-dvh bg-[var(--color-canvas)] pb-16">
        <header
          className="px-5 py-8 sm:px-8"
          style={{ background: "var(--brand-soft)", borderBottom: "1px solid var(--brand-border)" }}
        >
          <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              {view.business.logoUrl ? (
                // Tenant-supplied URL, so Next's optimiser is bypassed deliberately.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={view.business.logoUrl}
                  alt=""
                  className="h-10 w-auto max-w-40 object-contain"
                />
              ) : null}
              <div>
                <p className="text-sm font-semibold" style={{ color: "var(--brand-strong)" }}>
                  {view.business.legalName}
                </p>
                {view.business.website ? (
                  <a
                    href={view.business.website}
                    rel="noopener noreferrer nofollow"
                    target="_blank"
                    className="text-xs text-[var(--color-ink-muted)] hover:underline"
                  >
                    {view.business.website.replace(/^https?:\/\//, "")}
                  </a>
                ) : null}
              </div>
            </div>
            <div className="text-right text-xs text-[var(--color-ink-muted)]">
              <p className="font-mono text-sm text-[var(--color-ink)]">{view.number}</p>
              <p>Issued {fmt.date(view.createdAt)}</p>
              {view.validUntil ? <p>Valid until {fmt.date(view.validUntil)}</p> : null}
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-3xl space-y-5 px-5 py-8 sm:px-8">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{view.title}</h1>
            <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
              Prepared for {view.customer.name}
              {view.customer.company ? ` · ${view.customer.company}` : ""}
            </p>
          </div>

          {statusBanner ? (
            <div
              className={`rounded-xl border px-4 py-3 text-sm ${
                statusBanner.tone === "positive"
                  ? "border-[var(--color-positive)]/30 bg-[var(--color-positive-soft)] text-[var(--color-positive)]"
                  : statusBanner.tone === "warning"
                    ? "border-[var(--color-warning)]/30 bg-[var(--color-warning-soft)] text-[var(--color-warning)]"
                    : "border-[var(--color-line)] bg-[var(--color-surface-2)] text-[var(--color-ink-muted)]"
              }`}
              role="status"
            >
              <p className="font-semibold">{statusBanner.title}</p>
              <p className="mt-0.5">{statusBanner.body}</p>
            </div>
          ) : null}

          <section className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-lg text-sm">
                <caption className="sr-only">Quotation line items</caption>
                <thead>
                  <tr className="border-b border-[var(--color-line)] text-left text-xs uppercase tracking-wide text-[var(--color-ink-subtle)]">
                    <th scope="col" className="px-5 py-3 font-medium">Description</th>
                    <th scope="col" className="px-3 py-3 text-right font-medium">Qty</th>
                    <th scope="col" className="px-3 py-3 text-right font-medium">Unit price</th>
                    <th scope="col" className="px-3 py-3 text-right font-medium">Tax</th>
                    <th scope="col" className="px-5 py-3 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-line)]">
                  {view.items.map((item) => (
                    <tr key={item.id}>
                      <td className="px-5 py-3">{item.description}</td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {Number.isInteger(item.quantity) ? item.quantity : item.quantity.toFixed(2)}{" "}
                        <span className="text-[var(--color-ink-subtle)]">{item.unit}</span>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {fmt.money(item.unitPriceCents)}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-[var(--color-ink-muted)]">
                        {formatBp(item.taxRateBp)}
                      </td>
                      <td className="px-5 py-3 text-right font-medium tabular-nums">
                        {fmt.money(item.lineTotalCents)}
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
                  <dd className="tabular-nums">{fmt.money(view.subtotalCents)}</dd>
                </div>
                {view.discountCents > 0 ? (
                  <div className="flex justify-between">
                    <dt className="text-[var(--color-ink-muted)]">Discount</dt>
                    <dd className="tabular-nums">-{fmt.money(view.discountCents)}</dd>
                  </div>
                ) : null}
                {view.taxCents > 0 ? (
                  <div className="flex justify-between">
                    <dt className="text-[var(--color-ink-muted)]">Tax</dt>
                    <dd className="tabular-nums">{fmt.money(view.taxCents)}</dd>
                  </div>
                ) : null}
                <div
                  className="flex justify-between border-t border-[var(--color-line)] pt-1.5 text-base font-semibold"
                  style={{ color: "var(--brand-strong)" }}
                >
                  <dt>Total ({view.currency})</dt>
                  <dd className="tabular-nums">{fmt.money(view.totalCents)}</dd>
                </div>
              </dl>
            </div>
          </section>

          {view.notes?.trim() || view.terms?.trim() ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {view.notes?.trim() ? (
                <section className="card p-5">
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-subtle)]">
                    Notes
                  </h2>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{view.notes}</p>
                </section>
              ) : null}
              {view.terms?.trim() ? (
                <section className="card p-5">
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-subtle)]">
                    Terms
                  </h2>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{view.terms}</p>
                </section>
              ) : null}
            </div>
          ) : null}

          <section className="card p-5">
            {canRespond ? (
              <>
                <h2 className="text-sm font-semibold">Your response</h2>
                <p className="mb-4 mt-1 text-sm text-[var(--color-ink-muted)]">
                  Accepting records your decision against this quotation and notifies the sender in
                  their dashboard. Nothing is charged here.
                </p>
                <RespondForm
                  token={token}
                  requireSignature={view.requireSignature}
                  defaultName={view.customer.name}
                  defaultEmail={view.customer.email}
                />
              </>
            ) : (
              <p className="text-sm text-[var(--color-ink-muted)]">
                {view.decided
                  ? "This quotation has already been answered. Contact the sender if something needs to change."
                  : "This quotation is not open for a response right now. Contact the sender for an updated version."}
              </p>
            )}
          </section>

          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <a
              href={`/api/q/${encodeURIComponent(token)}/pdf`}
              className="btn btn-secondary"
              target="_blank"
              rel="noopener noreferrer"
            >
              Download PDF
            </a>
            <p className="text-xs text-[var(--color-ink-subtle)]">
              Questions? Reply to {view.business.email ?? view.business.legalName}
              {view.business.phone ? ` or call ${view.business.phone}` : ""}.
            </p>
          </div>

          <footer className="border-t border-[var(--color-line)] pt-5 text-xs text-[var(--color-ink-subtle)]">
            {view.business.addressLines.length > 0 ? (
              <p>{view.business.addressLines.join(" · ")}</p>
            ) : null}
            {view.business.taxId ? <p>Tax ID {view.business.taxId}</p> : null}
            <p className="mt-2">
              All times shown in {fmt.zoneLabel()} ({view.business.timezone}).
            </p>
          </footer>
        </main>
      </div>
    </div>
  );
}
