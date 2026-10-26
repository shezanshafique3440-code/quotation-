import type { Metadata } from "next";
import Link from "next/link";
import { ListSearch, Pagination } from "@/components/list-controls";
import { Badge, Card, CardHeader, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { QUOTATION_STATUSES, QUOTATION_STATUS_LABELS, type QuotationStatus } from "@/lib/constants";
import { formatMoney } from "@/lib/money";
import { listHref, parseListQuery, type ListSearchParams } from "@/lib/pagination";
import { listQuotations } from "@/lib/records";
import { requireTenant } from "@/lib/tenant";

export const metadata: Metadata = { title: "Quotations" };

const STATUS_TONE: Record<QuotationStatus, "neutral" | "brand" | "positive" | "warning" | "danger"> = {
  draft: "neutral",
  sent: "brand",
  accepted: "positive",
  rejected: "danger",
  expired: "warning",
};

export default async function QuotationsPage({
  searchParams,
}: {
  searchParams: Promise<ListSearchParams & { status?: string | string[] }>;
}) {
  const params = await searchParams;
  const { query, page } = parseListQuery(params);
  const { session, profile, fmt } = await requireTenant();
  const { rows: quotations, pagination, counts, total, status: filter } = await listQuotations(
    session.organizationId,
    { query, page, status: typeof params.status === "string" ? params.status : undefined },
  );

  return (
    <>
      <PageHeader
        title="Quotations"
        description="Everything you have drafted, sent and decided."
        action={<LinkButton href="/quotations/new" variant="primary">New quotation</LinkButton>}
      />

      <ListSearch
        pathname="/quotations"
        query={query}
        filters={{ status: filter }}
        label="Search quotations"
        placeholder="Quotation number, title or customer"
      />

      <nav className="flex flex-wrap gap-2" aria-label="Filter by status">
        <Link
          href={listHref("/quotations", { q: query })}
          aria-current={filter === undefined ? "page" : undefined}
          className={`btn ${filter === undefined ? "btn-primary" : "btn-secondary"}`}
        >
          All ({total})
        </Link>
        {QUOTATION_STATUSES.map((value) => (
          <Link
            key={value}
            href={listHref("/quotations", { q: query, status: value })}
            aria-current={filter === value ? "page" : undefined}
            className={`btn ${filter === value ? "btn-primary" : "btn-secondary"}`}
          >
            {QUOTATION_STATUS_LABELS[value]} ({counts.get(value) ?? 0})
          </Link>
        ))}
      </nav>

      <Card>
        <CardHeader
          title={
            filter ? `${QUOTATION_STATUS_LABELS[filter]} quotations` : "All quotations"
          }
          description={`${pagination.total} ${query ? "matching " : ""}quotation${pagination.total === 1 ? "" : "s"}`}
        />
        {quotations.length === 0 ? (
          <EmptyState
            title={query ? "No quotations match your search" : "Nothing here"}
            description={
              query
                ? "Try another quotation number, title or customer."
                : filter
                ? "No quotations have this status yet."
                : "Create your first quotation, or generate one from an inquiry."
            }
            action={query ? (
              <LinkButton href={listHref("/quotations", { status: filter })}>Clear search</LinkButton>
            ) : (
              <LinkButton href="/quotations/new" variant="primary">New quotation</LinkButton>
            )}
          />
        ) : (
          <ul className="divide-y divide-[var(--color-line)]">
            {quotations.map((q) => (
              <li key={q.id}>
                <Link
                  href={`/quotations/${q.id}`}
                  className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-[var(--color-surface-2)]"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{q.title}</p>
                    <p className="truncate text-xs text-[var(--color-ink-muted)]">
                      {q.number} · {q.customer.name} · {fmt.date(q.createdAt)}
                      {q.aiGenerated ? " · AI draft" : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="text-sm font-medium tabular-nums">
                      {formatMoney(q.totalCents, q.currency, profile.locale)}
                    </span>
                    <Badge tone={STATUS_TONE[q.status as QuotationStatus] ?? "neutral"}>
                      {QUOTATION_STATUS_LABELS[q.status as QuotationStatus] ?? q.status}
                    </Badge>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <Pagination
          pathname="/quotations"
          query={query}
          filters={{ status: filter }}
          pagination={pagination}
        />
      </Card>
    </>
  );
}
