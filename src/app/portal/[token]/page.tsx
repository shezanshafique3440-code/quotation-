import type { Metadata } from "next";
import Link from "next/link";
import { brandCssVariables } from "@/lib/branding";
import { QUOTATION_STATUS_LABELS, type QuotationStatus } from "@/lib/constants";
import { createFormatter } from "@/lib/format";
import { loadPortal } from "@/lib/portal";
import { VisitTracker } from "./visit-tracker";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your quotations",
  robots: { index: false, follow: false, nocache: true },
};

const STATUS_STYLE: Record<QuotationStatus, string> = {
  draft: "bg-[var(--color-surface-2)] text-[var(--color-ink-muted)]",
  sent: "bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]",
  accepted: "bg-[var(--color-positive-soft)] text-[var(--color-positive)]",
  rejected: "bg-[var(--color-danger-soft)] text-[var(--color-danger)]",
  expired: "bg-[var(--color-warning-soft)] text-[var(--color-warning)]",
};

function Unavailable() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-5 py-16">
      <div className="card max-w-md p-8 text-center">
        <h1 className="text-lg font-semibold">This portal link is not available</h1>
        <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
          The link may have expired or been replaced. Contact the business that sent it to you for
          a new one.
        </p>
      </div>
    </main>
  );
}

export default async function CustomerPortalPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const session = await loadPortal(token);
  if (!session) return <Unavailable />;

  const fmt = createFormatter({
    locale: session.business.locale,
    timezone: session.business.timezone,
    currency: "USD",
  });

  const open = session.quotations.filter((q) => q.status === "sent");
  const closed = session.quotations.filter((q) => q.status !== "sent");

  const groups = [
    { key: "open", title: "Awaiting your response", items: open },
    { key: "closed", title: "History", items: closed },
  ].filter((group) => group.items.length > 0);

  return (
    <div style={brandCssVariables(session.palette.base)} className="min-h-dvh bg-[var(--color-canvas)]">
      <VisitTracker token={token} />

      <header
        className="px-5 py-8 sm:px-8"
        style={{ background: "var(--brand-soft)", borderBottom: "1px solid var(--brand-border)" }}
      >
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          {session.business.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={session.business.logoUrl}
              alt=""
              className="h-10 w-auto max-w-40 object-contain"
            />
          ) : null}
          <div>
            <p className="text-sm font-semibold" style={{ color: "var(--brand-strong)" }}>
              {session.business.legalName}
            </p>
            <p className="text-xs text-[var(--color-ink-muted)]">
              Quotations for {session.customer.name}
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-6 px-5 py-8 sm:px-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {session.business.headline ?? "Your quotations"}
          </h1>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
            {session.business.message ??
              "Everything we have quoted you, in one place. Open a quotation to accept or decline it."}
          </p>
        </div>

        {session.quotations.length === 0 ? (
          <div className="card px-6 py-12 text-center">
            <p className="text-sm font-semibold">Nothing here yet</p>
            <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
              When {session.business.legalName} sends you a quotation, it will appear here.
            </p>
          </div>
        ) : null}

        {groups.map((group) => (
          <section key={group.key} className="card overflow-hidden">
            <h2 className="border-b border-[var(--color-line)] px-5 py-3 text-sm font-semibold">
              {group.title}
            </h2>
            <ul className="divide-y divide-[var(--color-line)]">
              {group.items.map((quotation) => {
                const status = quotation.status as QuotationStatus;
                const openable = quotation.publicEnabled && quotation.publicToken;

                return (
                  <li key={quotation.id} className="px-5 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{quotation.title}</p>
                        <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
                          {quotation.number} · {fmt.date(quotation.sentAt ?? quotation.createdAt)}
                          {quotation.validUntil && status === "sent"
                            ? ` · valid until ${fmt.date(quotation.validUntil)}`
                            : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <span className="text-sm font-semibold tabular-nums">
                          {fmt.money(quotation.totalCents, quotation.currency)}
                        </span>
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[status] ?? ""}`}
                        >
                          {QUOTATION_STATUS_LABELS[status] ?? status}
                        </span>
                      </div>
                    </div>

                    <div className="mt-3">
                      {openable ? (
                        <Link
                          href={`/q/${quotation.publicToken}`}
                          className="btn"
                          style={{ background: "var(--brand)", color: "var(--brand-on)" }}
                        >
                          {status === "sent" ? "Review and respond" : "View quotation"}
                        </Link>
                      ) : (
                        <p className="text-xs text-[var(--color-ink-subtle)]">
                          This quotation is not shared online. Contact{" "}
                          {session.business.email ?? session.business.legalName} for a copy.
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}

        <footer className="border-t border-[var(--color-line)] pt-5 text-xs text-[var(--color-ink-subtle)]">
          <p>
            {session.business.legalName}
            {session.business.email ? ` · ${session.business.email}` : ""}
            {session.business.phone ? ` · ${session.business.phone}` : ""}
          </p>
          <p className="mt-1">
            This page is private to you. Times shown in {fmt.zoneLabel()}.
          </p>
        </footer>
      </main>
    </div>
  );
}
