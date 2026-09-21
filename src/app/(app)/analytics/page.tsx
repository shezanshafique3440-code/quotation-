import type { Metadata } from "next";
import Link from "next/link";
import { FunnelChart, MetricTile, MonthlyOutcomes } from "@/components/charts";
import { Alert, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { getAnalytics } from "@/lib/analytics";
import { formatMoney } from "@/lib/money";
import { requireTenant } from "@/lib/tenant";

export const metadata: Metadata = {
  title: "Analytics",
  description: "Sent, opened, accepted, declined and expired quotations over time.",
};

function percent(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

function duration(hours: number | null): string {
  if (hours === null) return "—";
  if (hours < 1) return "under an hour";
  if (hours < 48) return `${Math.round(hours)} hours`;
  return `${Math.round(hours / 24)} days`;
}

export default async function AnalyticsPage() {
  const { session, profile, fmt } = await requireTenant();
  const analytics = await getAnalytics(session.organizationId, { baseCurrency: profile.currency });

  const hasData = analytics.issued > 0;
  const { totalCents: acceptedInBase, converted, unconverted } = analytics.acceptedInBase;

  return (
    <div className="analytics-root space-y-6">
      <PageHeader
        title="Analytics"
        description={`Quotations created between ${fmt.date(analytics.periodStart)} and ${fmt.date(analytics.periodEnd)}.`}
      />

      {!hasData ? (
        <Card>
          <EmptyState
            title="Nothing to measure yet"
            description="Once you send your first quotation, this page shows how many are opened, accepted and declined, and how long customers take to decide."
          />
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricTile
              label="Sent"
              value={String(analytics.issued)}
              detail={`${analytics.statusCounts.draft} still in draft`}
            />
            <MetricTile
              label="Opened"
              value={percent(analytics.viewRate)}
              detail={`${analytics.viewed} of ${analytics.issued} opened the link`}
            />
            <MetricTile
              label="Win rate"
              value={percent(analytics.winRate)}
              detail={`${analytics.statusCounts.accepted} accepted · ${analytics.statusCounts.rejected} declined`}
            />
            <MetricTile
              label="Time to decide"
              value={duration(analytics.medianHoursToDecision)}
              detail={`Median. First open after ${duration(analytics.medianHoursToFirstView)}.`}
            />
          </div>

          <div className="grid items-start gap-4 lg:grid-cols-2">
            <Card className="min-w-0">
              <CardHeader
                title="Quote-to-close funnel"
                description="Only real opens of the share link are counted."
              />
              <div className="px-5 py-4">
                <FunnelChart stages={analytics.funnel} />
                {analytics.viewed === 0 && analytics.issued > 0 ? (
                  <p className="mt-4 text-xs text-[var(--color-ink-subtle)]">
                    No opens recorded yet. Opens are only tracked for quotations you share with a
                    link — quotations sent as a PDF attachment cannot be measured.
                  </p>
                ) : null}
              </div>
            </Card>

            <Card className="min-w-0">
              <CardHeader title="Outcomes by month" description="Based on when each quote was sent." />
              <div className="px-5 py-4">
                <MonthlyOutcomes data={analytics.monthly} />
              </div>
            </Card>
          </div>

          <div className="grid items-start gap-4 lg:grid-cols-2">
            <Card className="min-w-0">
              <CardHeader
                title="Value won"
                description="Exact per currency; conversion only where a rate was recorded."
              />
              <div className="space-y-4 px-5 py-4">
                {analytics.valueByCurrency.accepted.length === 0 ? (
                  <p className="text-sm text-[var(--color-ink-muted)]">
                    Nothing accepted in this period.
                  </p>
                ) : (
                  <ul className="space-y-1.5 text-sm">
                    {analytics.valueByCurrency.accepted.map((row) => (
                      <li key={row.currency} className="flex justify-between">
                        <span className="text-[var(--color-ink-muted)]">
                          {row.currency} · {row.count} quote{row.count === 1 ? "" : "s"}
                        </span>
                        <span className="tabular-nums">
                          {formatMoney(row.totalCents, row.currency, profile.locale)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                {converted > 0 || unconverted > 0 ? (
                  <div className="border-t border-[var(--color-line)] pt-3">
                    <div className="flex justify-between text-sm font-medium">
                      <span>Converted to {analytics.baseCurrency}</span>
                      <span className="tabular-nums">
                        {formatMoney(acceptedInBase, analytics.baseCurrency, profile.locale)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-[var(--color-ink-subtle)]">
                      {unconverted === 0
                        ? `All ${converted} accepted quotations carried an exchange rate.`
                        : `${unconverted} accepted quotation${unconverted === 1 ? " has" : "s have"} no exchange rate recorded and ${unconverted === 1 ? "is" : "are"} excluded from this total. Add a rate on the quotation to include ${unconverted === 1 ? "it" : "them"}.`}
                    </p>
                  </div>
                ) : null}

                {analytics.valueByCurrency.open.length > 0 ? (
                  <div className="border-t border-[var(--color-line)] pt-3">
                    <p className="text-xs uppercase tracking-wide text-[var(--color-ink-subtle)]">
                      Still open
                    </p>
                    <ul className="mt-1.5 space-y-1 text-sm">
                      {analytics.valueByCurrency.open.map((row) => (
                        <li key={row.currency} className="flex justify-between">
                          <span className="text-[var(--color-ink-muted)]">{row.currency}</span>
                          <span className="tabular-nums">
                            {formatMoney(row.totalCents, row.currency, profile.locale)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </Card>

            <Card className="min-w-0">
              <CardHeader title="Customers" description="Ranked by quotations accepted." />
              {analytics.topCustomers.length === 0 ? (
                <p className="px-5 py-8 text-center text-sm text-[var(--color-ink-muted)]">
                  No customers have been quoted in this period.
                </p>
              ) : (
                <ul className="divide-y divide-[var(--color-line)]">
                  {analytics.topCustomers.map((customer) => (
                    <li key={customer.customerId}>
                      <Link
                        href={`/customers/${customer.customerId}`}
                        className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-[var(--color-surface-2)]"
                      >
                        <span className="truncate text-sm">{customer.name}</span>
                        <span className="shrink-0 text-xs tabular-nums text-[var(--color-ink-muted)]">
                          {customer.acceptedCount} of {customer.quotedCount} accepted
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <Alert tone="brand" title="What is counted">
            Opens come from real page views of a share link, with link-preview bots and repeat
            refreshes excluded. Quotations you send another way still appear as sent, accepted or
            declined, but never as opened — so this funnel under-reports rather than guesses.
          </Alert>
        </>
      )}
    </div>
  );
}
