import { convertToBase } from "./money";
import { prisma } from "./db";
import { QUOTATION_STATUSES, type QuotationStatus } from "./constants";

export interface FunnelStage {
  key: "sent" | "viewed" | "accepted";
  label: string;
  count: number;
  /** Share of the previous stage, or null when the previous stage is empty. */
  conversionFromPrevious: number | null;
}

export interface CurrencyTotal {
  currency: string;
  totalCents: number;
  count: number;
}

export interface AnalyticsSummary {
  periodStart: Date;
  periodEnd: Date;
  baseCurrency: string;

  statusCounts: Record<QuotationStatus, number>;
  /** Quotations that have left draft — the denominator for the funnel. */
  issued: number;
  viewed: number;
  funnel: FunnelStage[];

  /** Per-currency value, always exact. */
  valueByCurrency: { accepted: CurrencyTotal[]; open: CurrencyTotal[] };
  /**
   * Value converted to the reporting currency, with the number of quotations
   * that had no recorded rate. Those are excluded, never estimated.
   */
  acceptedInBase: { totalCents: number; converted: number; unconverted: number };

  /** Median hours from send to the customer's decision. Null when none yet. */
  medianHoursToDecision: number | null;
  /** Median hours from send to first view. Null when nothing was viewed. */
  medianHoursToFirstView: number | null;

  winRate: number | null;
  viewRate: number | null;

  topCustomers: {
    customerId: string;
    name: string;
    acceptedCount: number;
    quotedCount: number;
  }[];

  monthly: {
    month: string;
    sent: number;
    accepted: number;
    rejected: number;
    expired: number;
  }[];
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function groupByCurrency(
  rows: { currency: string; totalCents: number }[],
): CurrencyTotal[] {
  const map = new Map<string, CurrencyTotal>();
  for (const row of rows) {
    const entry = map.get(row.currency) ?? { currency: row.currency, totalCents: 0, count: 0 };
    entry.totalCents += row.totalCents;
    entry.count += 1;
    map.set(row.currency, entry);
  }
  return [...map.values()].sort((a, b) => b.totalCents - a.totalCents);
}

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Funnel and value analytics for one workspace.
 *
 * Every figure is derived from recorded facts: "viewed" counts quotations with
 * a real `firstViewedAt` from the share page, never an assumption that a sent
 * quote was read. Cross-currency totals only include quotations that carry an
 * exchange rate, and the count of excluded ones is reported alongside.
 */
export async function getAnalytics(
  organizationId: string,
  options: { since?: Date; until?: Date; baseCurrency?: string; months?: number } = {},
): Promise<AnalyticsSummary> {
  const until = options.until ?? new Date();
  const months = options.months ?? 6;
  const since =
    options.since ??
    new Date(Date.UTC(until.getUTCFullYear(), until.getUTCMonth() - (months - 1), 1));

  const [profile, rows] = await Promise.all([
    prisma.businessProfile.findUnique({
      where: { organizationId },
      select: { currency: true },
    }),
    prisma.quotation.findMany({
      where: { organizationId, createdAt: { gte: since, lte: until } },
      select: {
        id: true,
        status: true,
        currency: true,
        totalCents: true,
        exchangeRateToBase: true,
        createdAt: true,
        sentAt: true,
        firstViewedAt: true,
        respondedAt: true,
        decidedAt: true,
        customerId: true,
        customer: { select: { name: true } },
      },
    }),
  ]);

  const baseCurrency = options.baseCurrency ?? profile?.currency ?? "USD";

  const statusCounts = Object.fromEntries(
    QUOTATION_STATUSES.map((status) => [status, 0]),
  ) as Record<QuotationStatus, number>;
  for (const row of rows) {
    if (row.status in statusCounts) statusCounts[row.status as QuotationStatus] += 1;
  }

  const issuedRows = rows.filter((r) => r.status !== "draft");
  const viewedRows = issuedRows.filter((r) => r.firstViewedAt !== null);
  const acceptedRows = rows.filter((r) => r.status === "accepted");
  const openRows = rows.filter((r) => r.status === "sent");

  const issued = issuedRows.length;
  const viewed = viewedRows.length;
  const accepted = acceptedRows.length;
  const decided = accepted + statusCounts.rejected;

  const funnel: FunnelStage[] = [
    { key: "sent", label: "Sent", count: issued, conversionFromPrevious: null },
    {
      key: "viewed",
      label: "Opened",
      count: viewed,
      conversionFromPrevious: issued === 0 ? null : viewed / issued,
    },
    {
      key: "accepted",
      label: "Accepted",
      count: accepted,
      conversionFromPrevious: viewed === 0 ? null : accepted / viewed,
    },
  ];

  let convertedTotal = 0;
  let converted = 0;
  let unconverted = 0;
  for (const row of acceptedRows) {
    const value = convertToBase(row.totalCents, row.currency, baseCurrency, row.exchangeRateToBase);
    if (value === null) unconverted += 1;
    else {
      convertedTotal += value;
      converted += 1;
    }
  }

  const hoursBetween = (from: Date | null, to: Date | null): number | null =>
    from && to ? (to.getTime() - from.getTime()) / 3_600_000 : null;

  const decisionHours = rows
    .map((r) => hoursBetween(r.sentAt, r.respondedAt ?? r.decidedAt))
    .filter((v): v is number => v !== null && v >= 0);

  const viewHours = issuedRows
    .map((r) => hoursBetween(r.sentAt, r.firstViewedAt))
    .filter((v): v is number => v !== null && v >= 0);

  const perCustomer = new Map<string, { name: string; acceptedCount: number; quotedCount: number }>();
  for (const row of issuedRows) {
    const entry = perCustomer.get(row.customerId) ?? {
      name: row.customer.name,
      acceptedCount: 0,
      quotedCount: 0,
    };
    entry.quotedCount += 1;
    if (row.status === "accepted") entry.acceptedCount += 1;
    perCustomer.set(row.customerId, entry);
  }

  const monthlyMap = new Map<string, { sent: number; accepted: number; rejected: number; expired: number }>();
  for (let i = months - 1; i >= 0; i -= 1) {
    const date = new Date(Date.UTC(until.getUTCFullYear(), until.getUTCMonth() - i, 1));
    monthlyMap.set(monthKey(date), { sent: 0, accepted: 0, rejected: 0, expired: 0 });
  }
  for (const row of issuedRows) {
    const key = monthKey(row.sentAt ?? row.createdAt);
    const bucket = monthlyMap.get(key);
    if (!bucket) continue;
    bucket.sent += 1;
    if (row.status === "accepted") bucket.accepted += 1;
    if (row.status === "rejected") bucket.rejected += 1;
    if (row.status === "expired") bucket.expired += 1;
  }

  return {
    periodStart: since,
    periodEnd: until,
    baseCurrency,
    statusCounts,
    issued,
    viewed,
    funnel,
    valueByCurrency: {
      accepted: groupByCurrency(acceptedRows),
      open: groupByCurrency(openRows),
    },
    acceptedInBase: { totalCents: convertedTotal, converted, unconverted },
    medianHoursToDecision: median(decisionHours),
    medianHoursToFirstView: median(viewHours),
    winRate: decided === 0 ? null : accepted / decided,
    viewRate: issued === 0 ? null : viewed / issued,
    topCustomers: [...perCustomer.entries()]
      .map(([customerId, value]) => ({ customerId, ...value }))
      .sort((a, b) => b.acceptedCount - a.acceptedCount || b.quotedCount - a.quotedCount)
      .slice(0, 5),
    monthly: [...monthlyMap.entries()].map(([month, value]) => ({ month, ...value })),
  };
}
