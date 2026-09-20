import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, CardHeader, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { QUOTATION_STATUSES, QUOTATION_STATUS_LABELS, type QuotationStatus } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { requireTenant } from "@/lib/tenant";

export const metadata: Metadata = { title: "Quotations" };

const STATUS_TONE: Record<QuotationStatus, "neutral" | "brand" | "positive" | "warning" | "danger"> = {
  draft: "neutral",
  sent: "brand",
  accepted: "positive",
  rejected: "danger",
  expired: "warning",
};

function isStatus(value: string | undefined): value is QuotationStatus {
  return value !== undefined && (QUOTATION_STATUSES as readonly string[]).includes(value);
}

export default async function QuotationsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const { session, profile } = await requireTenant();
  const filter = isStatus(status) ? status : undefined;

  const [quotations, groups] = await Promise.all([
    prisma.quotation.findMany({
      where: { organizationId: session.organizationId, ...(filter ? { status: filter } : {}) },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { customer: { select: { name: true } } },
    }),
    prisma.quotation.groupBy({
      by: ["status"],
      where: { organizationId: session.organizationId },
      _count: { _all: true },
    }),
  ]);

  const counts = new Map(groups.map((g) => [g.status, g._count._all]));
  const total = groups.reduce((sum, g) => sum + g._count._all, 0);

  return (
    <>
      <PageHeader
        title="Quotations"
        description="Everything you have drafted, sent and decided."
        action={<LinkButton href="/quotations/new" variant="primary">New quotation</LinkButton>}
      />

      <nav className="flex flex-wrap gap-2" aria-label="Filter by status">
        <Link
          href="/quotations"
          className={`btn ${filter === undefined ? "btn-primary" : "btn-secondary"}`}
        >
          All ({total})
        </Link>
        {QUOTATION_STATUSES.map((value) => (
          <Link
            key={value}
            href={`/quotations?status=${value}`}
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
          description={`${quotations.length} shown`}
        />
        {quotations.length === 0 ? (
          <EmptyState
            title="Nothing here"
            description={
              filter
                ? "No quotations have this status yet."
                : "Create your first quotation, or generate one from an inquiry."
            }
            action={<LinkButton href="/quotations/new" variant="primary">New quotation</LinkButton>}
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
                      {q.number} · {q.customer.name} · {formatDate(q.createdAt, profile.locale)}
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
      </Card>
    </>
  );
}
