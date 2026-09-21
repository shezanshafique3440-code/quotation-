import { beforeEach, describe, expect, it } from "vitest";
import { getAnalytics } from "@/lib/analytics";
import { prisma } from "@/lib/db";
import { createSharedQuotation, createWorkspace, resetDatabase, type Workspace } from "./helpers";

beforeEach(resetDatabase);

const NOW = new Date("2026-06-15T12:00:00Z");

async function quotation(
  workspace: Workspace,
  data: Partial<{
    status: string;
    currency: string;
    totalCents: number;
    exchangeRateToBase: number | null;
    createdAt: Date;
    sentAt: Date | null;
    firstViewedAt: Date | null;
    respondedAt: Date | null;
  }>,
) {
  const created = await createSharedQuotation(workspace, {
    status: data.status ?? "sent",
    currency: data.currency ?? "USD",
  });
  return prisma.quotation.update({
    where: { id: created.id },
    data: {
      status: data.status ?? "sent",
      currency: data.currency ?? "USD",
      totalCents: data.totalCents ?? 10_000,
      exchangeRateToBase:
        data.exchangeRateToBase === undefined ? 1 : data.exchangeRateToBase,
      createdAt: data.createdAt ?? new Date("2026-06-01T09:00:00Z"),
      sentAt: data.sentAt === undefined ? new Date("2026-06-01T09:00:00Z") : data.sentAt,
      firstViewedAt: data.firstViewedAt ?? null,
      respondedAt: data.respondedAt ?? null,
    },
  });
}

describe("getAnalytics", () => {
  it("returns an honest zero state for a workspace with nothing sent", async () => {
    const workspace = await createWorkspace();
    const analytics = await getAnalytics(workspace.organizationId, { until: NOW });

    expect(analytics.issued).toBe(0);
    expect(analytics.viewed).toBe(0);
    expect(analytics.winRate).toBeNull();
    expect(analytics.viewRate).toBeNull();
    expect(analytics.medianHoursToDecision).toBeNull();
    expect(analytics.funnel[1]!.conversionFromPrevious).toBeNull();
    expect(analytics.valueByCurrency.accepted).toEqual([]);
  });

  it("counts drafts separately and excludes them from the funnel", async () => {
    const workspace = await createWorkspace();
    await quotation(workspace, { status: "draft" });
    await quotation(workspace, { status: "sent" });

    const analytics = await getAnalytics(workspace.organizationId, { until: NOW });
    expect(analytics.statusCounts.draft).toBe(1);
    expect(analytics.issued).toBe(1);
    expect(analytics.funnel[0]!.count).toBe(1);
  });

  it("only counts a quotation as opened when a real view was recorded", async () => {
    const workspace = await createWorkspace();
    await quotation(workspace, { status: "sent" });
    await quotation(workspace, {
      status: "sent",
      firstViewedAt: new Date("2026-06-01T15:00:00Z"),
    });

    const analytics = await getAnalytics(workspace.organizationId, { until: NOW });
    expect(analytics.issued).toBe(2);
    expect(analytics.viewed).toBe(1);
    expect(analytics.viewRate).toBe(0.5);
  });

  it("computes the funnel conversions against the previous stage", async () => {
    const workspace = await createWorkspace();
    for (let i = 0; i < 4; i += 1) await quotation(workspace, { status: "sent" });
    await quotation(workspace, {
      status: "sent",
      firstViewedAt: new Date("2026-06-02T09:00:00Z"),
    });
    await quotation(workspace, {
      status: "accepted",
      firstViewedAt: new Date("2026-06-02T09:00:00Z"),
      respondedAt: new Date("2026-06-03T09:00:00Z"),
    });

    const analytics = await getAnalytics(workspace.organizationId, { until: NOW });
    expect(analytics.funnel.map((s) => s.count)).toEqual([6, 2, 1]);
    expect(analytics.funnel[1]!.conversionFromPrevious).toBeCloseTo(2 / 6);
    expect(analytics.funnel[2]!.conversionFromPrevious).toBeCloseTo(1 / 2);
  });

  it("bases the win rate on decided quotations only", async () => {
    const workspace = await createWorkspace();
    await quotation(workspace, { status: "accepted" });
    await quotation(workspace, { status: "accepted" });
    await quotation(workspace, { status: "rejected" });
    await quotation(workspace, { status: "sent" });
    await quotation(workspace, { status: "expired" });

    const analytics = await getAnalytics(workspace.organizationId, { until: NOW });
    // 2 accepted of 3 decided — the open and expired ones are not a loss yet.
    expect(analytics.winRate).toBeCloseTo(2 / 3);
  });

  it("reports value exactly per currency", async () => {
    const workspace = await createWorkspace();
    await quotation(workspace, { status: "accepted", currency: "USD", totalCents: 10_000 });
    await quotation(workspace, { status: "accepted", currency: "USD", totalCents: 5_000 });
    await quotation(workspace, {
      status: "accepted",
      currency: "JPY",
      totalCents: 200_000,
      exchangeRateToBase: 0.0064,
    });
    await quotation(workspace, { status: "sent", currency: "EUR", totalCents: 7_000 });

    const analytics = await getAnalytics(workspace.organizationId, { until: NOW, baseCurrency: "USD" });

    expect(analytics.valueByCurrency.accepted).toEqual([
      { currency: "JPY", totalCents: 200_000, count: 1 },
      { currency: "USD", totalCents: 15_000, count: 2 },
    ]);
    expect(analytics.valueByCurrency.open).toEqual([
      { currency: "EUR", totalCents: 7_000, count: 1 },
    ]);
  });

  it("excludes unconverted quotations from the base total and reports how many", async () => {
    const workspace = await createWorkspace();
    await quotation(workspace, { status: "accepted", currency: "USD", totalCents: 10_000 });
    await quotation(workspace, {
      status: "accepted",
      currency: "EUR",
      totalCents: 10_000,
      exchangeRateToBase: 1.1,
    });
    await quotation(workspace, {
      status: "accepted",
      currency: "GBP",
      totalCents: 10_000,
      exchangeRateToBase: null,
    });

    const analytics = await getAnalytics(workspace.organizationId, { until: NOW, baseCurrency: "USD" });

    // 10000 + round(100 * 1.1 * 100) = 10000 + 11000; the GBP one is left out.
    expect(analytics.acceptedInBase.totalCents).toBe(21_000);
    expect(analytics.acceptedInBase.converted).toBe(2);
    expect(analytics.acceptedInBase.unconverted).toBe(1);
  });

  it("reports median times from real timestamps only", async () => {
    const workspace = await createWorkspace();
    const sentAt = new Date("2026-06-01T09:00:00Z");
    await quotation(workspace, {
      status: "accepted",
      sentAt,
      firstViewedAt: new Date("2026-06-01T11:00:00Z"),
      respondedAt: new Date("2026-06-02T09:00:00Z"),
    });
    await quotation(workspace, {
      status: "rejected",
      sentAt,
      firstViewedAt: new Date("2026-06-01T13:00:00Z"),
      respondedAt: new Date("2026-06-04T09:00:00Z"),
    });
    await quotation(workspace, { status: "sent", sentAt });

    const analytics = await getAnalytics(workspace.organizationId, { until: NOW });
    expect(analytics.medianHoursToDecision).toBe((24 + 72) / 2);
    expect(analytics.medianHoursToFirstView).toBe((2 + 4) / 2);
  });

  it("ranks customers by acceptances", async () => {
    const workspace = await createWorkspace();
    const other = await prisma.customer.create({
      data: { organizationId: workspace.organizationId, name: "Second Customer" },
    });

    await quotation(workspace, { status: "accepted" });
    await quotation(workspace, { status: "accepted" });
    const single = await quotation(workspace, { status: "accepted" });
    await prisma.quotation.update({ where: { id: single.id }, data: { customerId: other.id } });

    const analytics = await getAnalytics(workspace.organizationId, { until: NOW });
    expect(analytics.topCustomers[0]!.acceptedCount).toBe(2);
    expect(analytics.topCustomers).toHaveLength(2);
  });

  it("buckets by month and always returns the full requested window", async () => {
    const workspace = await createWorkspace();
    await quotation(workspace, {
      status: "accepted",
      createdAt: new Date("2026-05-10T09:00:00Z"),
      sentAt: new Date("2026-05-10T09:00:00Z"),
    });
    await quotation(workspace, {
      status: "rejected",
      createdAt: new Date("2026-06-10T09:00:00Z"),
      sentAt: new Date("2026-06-10T09:00:00Z"),
    });

    const analytics = await getAnalytics(workspace.organizationId, { until: NOW, months: 3 });
    expect(analytics.monthly).toHaveLength(3);
    expect(analytics.monthly.map((m) => m.month)).toEqual(["2026-04", "2026-05", "2026-06"]);
    expect(analytics.monthly[1]).toEqual({ month: "2026-05", sent: 1, accepted: 1, rejected: 0, expired: 0 });
    expect(analytics.monthly[2]).toEqual({ month: "2026-06", sent: 1, accepted: 0, rejected: 1, expired: 0 });
  });

  it("never mixes one workspace's numbers into another's", async () => {
    const mine = await createWorkspace();
    const theirs = await createWorkspace();
    await quotation(mine, { status: "accepted", totalCents: 10_000 });
    for (let i = 0; i < 5; i += 1) await quotation(theirs, { status: "accepted", totalCents: 99_000 });

    const analytics = await getAnalytics(mine.organizationId, { until: NOW });
    expect(analytics.issued).toBe(1);
    expect(analytics.acceptedInBase.totalCents).toBe(10_000);
    expect(analytics.topCustomers).toHaveLength(1);
  });

  it("honours the requested date window", async () => {
    const workspace = await createWorkspace();
    await quotation(workspace, { status: "accepted", createdAt: new Date("2026-01-05T09:00:00Z") });
    await quotation(workspace, { status: "accepted", createdAt: new Date("2026-06-05T09:00:00Z") });

    const analytics = await getAnalytics(workspace.organizationId, {
      since: new Date("2026-06-01T00:00:00Z"),
      until: NOW,
    });
    expect(analytics.issued).toBe(1);
  });
});
