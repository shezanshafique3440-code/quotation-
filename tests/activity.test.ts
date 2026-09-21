import { beforeEach, describe, expect, it } from "vitest";
import {
  ACTIVITY_KINDS,
  auditLog,
  customerTimeline,
  quotationTimeline,
  recordActivity,
} from "@/lib/activity";
import { prisma } from "@/lib/db";
import { createSharedQuotation, createWorkspace, resetDatabase, type Workspace } from "./helpers";

beforeEach(resetDatabase);

function event(workspace: Workspace, overrides: Record<string, unknown> = {}) {
  return {
    organizationId: workspace.organizationId,
    category: "quotation" as const,
    kind: ACTIVITY_KINDS.quotationCreated,
    summary: "Something happened",
    actorType: "user" as const,
    actorLabel: "Sam",
    ...overrides,
  };
}

describe("recordActivity", () => {
  it("writes the row with its actor and serialised metadata", async () => {
    const workspace = await createWorkspace();
    await recordActivity(
      event(workspace, {
        customerId: workspace.customerId,
        metadata: { totalCents: 1234, currency: "USD" },
        ipHash: "hash",
        userAgent: "Mozilla/5.0",
      }),
    );

    const rows = await prisma.activityEvent.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actorLabel).toBe("Sam");
    expect(JSON.parse(rows[0]!.metadata!)).toEqual({ totalCents: 1234, currency: "USD" });
    expect(rows[0]!.ipHash).toBe("hash");
  });

  it("truncates long values instead of failing the write", async () => {
    const workspace = await createWorkspace();
    await recordActivity(
      event(workspace, { summary: "x".repeat(900), actorLabel: "y".repeat(400) }),
    );

    const row = await prisma.activityEvent.findFirstOrThrow();
    expect(row.summary).toHaveLength(500);
    expect(row.actorLabel).toHaveLength(200);
  });

  it("never throws, so an audit failure cannot roll back the business action", async () => {
    await expect(
      recordActivity(
        event({ organizationId: "does-not-exist" } as Workspace, {
          organizationId: "does-not-exist",
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it("parses back to null when metadata is absent", async () => {
    const workspace = await createWorkspace();
    await recordActivity(event(workspace));

    const entries = await auditLog(workspace.organizationId);
    expect(entries[0]!.metadata).toBeNull();
  });
});

describe("timelines", () => {
  it("returns a quotation's events newest first", async () => {
    const workspace = await createWorkspace();
    const quotation = await createSharedQuotation(workspace);

    await recordActivity(
      event(workspace, { quotationId: quotation.id, summary: "First", kind: ACTIVITY_KINDS.quotationCreated }),
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    await recordActivity(
      event(workspace, { quotationId: quotation.id, summary: "Second", kind: ACTIVITY_KINDS.quotationSent }),
    );

    const timeline = await quotationTimeline(workspace.organizationId, quotation.id);
    expect(timeline.map((e) => e.summary)).toEqual(["Second", "First"]);
  });

  it("scopes a customer timeline to that customer", async () => {
    const workspace = await createWorkspace();
    const other = await prisma.customer.create({
      data: { organizationId: workspace.organizationId, name: "Other" },
    });

    await recordActivity(event(workspace, { customerId: workspace.customerId, summary: "Mine" }));
    await recordActivity(event(workspace, { customerId: other.id, summary: "Theirs" }));

    const timeline = await customerTimeline(workspace.organizationId, workspace.customerId);
    expect(timeline.map((e) => e.summary)).toEqual(["Mine"]);
  });

  it("never returns another workspace's events", async () => {
    const mine = await createWorkspace();
    const theirs = await createWorkspace();
    const quotation = await createSharedQuotation(theirs);

    await recordActivity(
      event(theirs, { quotationId: quotation.id, customerId: theirs.customerId, summary: "Secret" }),
    );

    expect(await quotationTimeline(mine.organizationId, quotation.id)).toEqual([]);
    expect(await customerTimeline(mine.organizationId, theirs.customerId)).toEqual([]);
    expect(await auditLog(mine.organizationId)).toEqual([]);
  });

  it("respects the take limit", async () => {
    const workspace = await createWorkspace();
    const quotation = await createSharedQuotation(workspace);
    for (let i = 0; i < 5; i += 1) {
      await recordActivity(event(workspace, { quotationId: quotation.id, summary: `Event ${i}` }));
    }

    expect(await quotationTimeline(workspace.organizationId, quotation.id, 3)).toHaveLength(3);
  });
});

describe("auditLog", () => {
  it("filters by category", async () => {
    const workspace = await createWorkspace();
    await recordActivity(event(workspace, { category: "security", kind: ACTIVITY_KINDS.signedIn, summary: "Signed in" }));
    await recordActivity(event(workspace, { category: "billing", kind: ACTIVITY_KINDS.planChanged, summary: "Plan" }));
    await recordActivity(event(workspace, { summary: "Quotation" }));

    expect((await auditLog(workspace.organizationId)).length).toBe(3);
    expect((await auditLog(workspace.organizationId, { category: "security" })).map((e) => e.summary)).toEqual([
      "Signed in",
    ]);
    expect((await auditLog(workspace.organizationId, { category: "billing" })).map((e) => e.summary)).toEqual([
      "Plan",
    ]);
  });

  it("survives malformed metadata written by an older version", async () => {
    const workspace = await createWorkspace();
    await prisma.activityEvent.create({
      data: {
        organizationId: workspace.organizationId,
        category: "quotation",
        kind: "quotation.created",
        summary: "Legacy row",
        actorType: "system",
        actorLabel: "QuoteFlow",
        metadata: "{not json",
      },
    });

    const entries = await auditLog(workspace.organizationId);
    expect(entries[0]!.metadata).toBeNull();
    expect(entries[0]!.summary).toBe("Legacy row");
  });
});
