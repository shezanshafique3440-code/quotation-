import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, CardHeader, EmptyState, LinkButton, PageHeader, Stat } from "@/components/ui";
import {
  QUOTATION_STATUS_LABELS,
  REMINDER_CHANNEL_LABELS,
  type QuotationStatus,
  type ReminderChannel,
} from "@/lib/constants";
import { prisma } from "@/lib/db";
import { formatDate, formatRelative } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { requireTenant } from "@/lib/tenant";
import { getUsage } from "@/lib/usage";

export const metadata: Metadata = { title: "Dashboard" };

const STATUS_TONE: Record<QuotationStatus, "neutral" | "brand" | "positive" | "warning" | "danger"> = {
  draft: "neutral",
  sent: "brand",
  accepted: "positive",
  rejected: "danger",
  expired: "warning",
};

export default async function DashboardPage() {
  const { session, profile } = await requireTenant();
  const organizationId = session.organizationId;
  const now = new Date();

  const [usage, statusGroups, acceptedAgg, sentAgg, newInquiries, recentQuotations, dueReminders] =
    await Promise.all([
      getUsage(organizationId, now),
      prisma.quotation.groupBy({
        by: ["status"],
        where: { organizationId },
        _count: { _all: true },
      }),
      prisma.quotation.aggregate({
        where: { organizationId, status: "accepted" },
        _sum: { totalCents: true },
      }),
      prisma.quotation.aggregate({
        where: { organizationId, status: "sent" },
        _sum: { totalCents: true },
      }),
      prisma.inquiry.count({ where: { organizationId, status: "new" } }),
      prisma.quotation.findMany({
        where: { organizationId },
        orderBy: { createdAt: "desc" },
        take: 6,
        include: { customer: { select: { name: true } } },
      }),
      prisma.reminder.findMany({
        where: { organizationId, status: "pending", dueAt: { lte: new Date(now.getTime() + 7 * 86_400_000) } },
        orderBy: { dueAt: "asc" },
        take: 5,
        include: { quotation: { select: { id: true, number: true, customer: { select: { name: true } } } } },
      }),
    ]);

  const counts = new Map(statusGroups.map((g) => [g.status, g._count._all]));
  const totalQuotations = statusGroups.reduce((sum, g) => sum + g._count._all, 0);
  const decided = (counts.get("accepted") ?? 0) + (counts.get("rejected") ?? 0);
  const winRate = decided === 0 ? null : Math.round(((counts.get("accepted") ?? 0) / decided) * 100);

  const money = (cents: number) => formatMoney(cents, profile.currency, profile.locale);

  return (
    <>
      <PageHeader
        title={`Welcome back, ${session.user.name.split(" ")[0] ?? session.user.name}`}
        description={`${profile.legalName} · ${totalQuotations} quotation${totalQuotations === 1 ? "" : "s"} all time`}
        action={<LinkButton href="/quotations/new" variant="primary">New quotation</LinkButton>}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Open inquiries" value={String(newInquiries)} sub="Not yet quoted" />
        <Stat label="Out for decision" value={money(sentAgg._sum.totalCents ?? 0)} sub={`${counts.get("sent") ?? 0} sent`} />
        <Stat label="Won" value={money(acceptedAgg._sum.totalCents ?? 0)} sub={`${counts.get("accepted") ?? 0} accepted`} />
        <Stat
          label="Win rate"
          value={winRate === null ? "—" : `${winRate}%`}
          sub={decided === 0 ? "No decisions yet" : `${decided} decided`}
        />
      </div>

      {/* Grid items default to min-width:auto, which lets truncating text force
          the column open; min-w-0 lets them shrink and ellipsize instead. */}
      <div className="grid items-start gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card className="min-w-0">
          <CardHeader
            title="Recent quotations"
            action={<Link href="/quotations" className="text-sm text-[var(--color-brand)] hover:underline">View all</Link>}
          />
          {recentQuotations.length === 0 ? (
            <EmptyState
              title="No quotations yet"
              description="Log an inquiry and generate a draft, or build a quotation from scratch."
              action={<LinkButton href="/quotations/new" variant="primary">New quotation</LinkButton>}
            />
          ) : (
            <ul className="divide-y divide-[var(--color-line)]">
              {recentQuotations.map((q) => (
                <li key={q.id}>
                  <Link
                    href={`/quotations/${q.id}`}
                    className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-[var(--color-surface-2)]"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{q.title}</p>
                      <p className="truncate text-xs text-[var(--color-ink-muted)]">
                        {q.number} · {q.customer.name} · {formatDate(q.createdAt, profile.locale)}
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

        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader
              title="Follow-ups due"
              action={<Link href="/reminders" className="text-sm text-[var(--color-brand)] hover:underline">All</Link>}
            />
            {dueReminders.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-[var(--color-ink-muted)]">
                Nothing due in the next seven days.
              </p>
            ) : (
              <ul className="divide-y divide-[var(--color-line)]">
                {dueReminders.map((r) => (
                  <li key={r.id} className="px-5 py-3">
                    <Link href={`/quotations/${r.quotation.id}`} className="block hover:underline">
                      <p className="text-sm font-medium">{r.quotation.customer.name}</p>
                    </Link>
                    <p className="text-xs text-[var(--color-ink-muted)]">
                      {r.quotation.number} ·{" "}
                      {REMINDER_CHANNEL_LABELS[r.channel as ReminderChannel] ?? r.channel} ·{" "}
                      <span className={r.dueAt <= now ? "text-[var(--color-danger)]" : ""}>
                        {formatRelative(r.dueAt, profile.locale, now)}
                      </span>
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="This month" description={`${usage.plan === "pro" ? "Pro" : "Free"} plan`} />
            <dl className="space-y-3 px-5 py-4 text-sm">
              <UsageRow label="AI drafts" used={usage.aiDraftsUsed} limit={usage.limits.aiDraftsPerMonth} />
              <UsageRow label="Quotations" used={usage.quotationsUsed} limit={usage.limits.quotationsPerMonth} />
              <UsageRow label="Catalog products" used={usage.productsUsed} limit={usage.limits.products} />
            </dl>
            <div className="border-t border-[var(--color-line)] px-5 py-3">
              <Link href="/settings/billing" className="text-sm text-[var(--color-brand)] hover:underline">
                Plan &amp; usage
              </Link>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

function UsageRow({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const pct = limit === null ? 0 : Math.min(100, Math.round((used / limit) * 100));
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <dt className="text-[var(--color-ink-muted)]">{label}</dt>
        <dd className="tabular-nums">{limit === null ? `${used} · unlimited` : `${used} / ${limit}`}</dd>
      </div>
      {limit !== null ? (
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
          <div
            className={`h-full rounded-full ${pct >= 100 ? "bg-[var(--color-danger)]" : "bg-[var(--color-brand)]"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}
