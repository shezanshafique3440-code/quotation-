import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { LimitExceededError } from "@/lib/errors";
import { PLAN_LIMITS } from "@/lib/plans";
import { assertWithinLimit, getUsage, recordUsage } from "@/lib/usage";
import { createQuotation } from "@/lib/quotations";
import { createWorkspace, quotationInput, resetDatabase } from "./helpers";

beforeEach(resetDatabase);

describe("getUsage", () => {
  it("counts only the current UTC month", async () => {
    const workspace = await createWorkspace();
    const now = new Date("2026-06-15T12:00:00.000Z");

    await prisma.usageEvent.createMany({
      data: [
        { organizationId: workspace.organizationId, kind: "ai_draft", createdAt: new Date("2026-06-01T00:00:00.000Z") },
        { organizationId: workspace.organizationId, kind: "ai_draft", createdAt: new Date("2026-05-31T23:59:59.000Z") },
        { organizationId: workspace.organizationId, kind: "ai_draft", createdAt: new Date("2026-07-01T00:00:00.000Z") },
      ],
    });

    const usage = await getUsage(workspace.organizationId, now);
    expect(usage.aiDraftsUsed).toBe(1);
    expect(usage.periodStart.toISOString()).toBe("2026-06-01T00:00:00.000Z");
  });

  it("never counts another workspace's usage", async () => {
    const mine = await createWorkspace();
    const theirs = await createWorkspace();
    await recordUsage(theirs.organizationId, "ai_draft");

    expect((await getUsage(mine.organizationId)).aiDraftsUsed).toBe(0);
    expect((await getUsage(theirs.organizationId)).aiDraftsUsed).toBe(1);
  });

  it("counts active products and team members", async () => {
    const workspace = await createWorkspace();
    await prisma.product.create({
      data: {
        organizationId: workspace.organizationId,
        name: "Inactive",
        unitPriceCents: 100,
        active: false,
      },
    });

    const usage = await getUsage(workspace.organizationId);
    expect(usage.productsUsed).toBe(1);
    expect(usage.teamMembers).toBe(1);
  });
});

describe("assertWithinLimit", () => {
  it("allows a free workspace up to its allowance and blocks the next one", async () => {
    const workspace = await createWorkspace({ plan: "free" });
    const limit = PLAN_LIMITS.free.aiDraftsPerMonth!;

    for (let i = 0; i < limit; i += 1) {
      await assertWithinLimit(workspace.organizationId, "aiDraftsPerMonth");
      await recordUsage(workspace.organizationId, "ai_draft");
    }

    await expect(
      assertWithinLimit(workspace.organizationId, "aiDraftsPerMonth"),
    ).rejects.toThrow(LimitExceededError);
  });

  it("reports the feature, count and limit so the UI can explain the block", async () => {
    const workspace = await createWorkspace({ plan: "free" });
    for (let i = 0; i < PLAN_LIMITS.free.products!; i += 1) {
      await prisma.product.create({
        data: { organizationId: workspace.organizationId, name: `P${i}`, unitPriceCents: 100 },
      });
    }

    const error = (await assertWithinLimit(workspace.organizationId, "products").catch(
      (e) => e,
    )) as LimitExceededError;

    expect(error).toBeInstanceOf(LimitExceededError);
    expect(error.status).toBe(402);
    expect(error.details).toMatchObject({
      feature: "products",
      limit: PLAN_LIMITS.free.products,
      plan: "free",
    });
  });

  it("does not meter a pro workspace on unlimited features", async () => {
    const workspace = await createWorkspace({ plan: "pro" });
    for (let i = 0; i < PLAN_LIMITS.free.aiDraftsPerMonth! + 5; i += 1) {
      await recordUsage(workspace.organizationId, "ai_draft");
    }

    await expect(
      assertWithinLimit(workspace.organizationId, "aiDraftsPerMonth"),
    ).resolves.toMatchObject({ plan: "pro" });
  });

  it("counts real quotations towards the monthly quotation limit", async () => {
    const workspace = await createWorkspace({ plan: "free" });
    await createQuotation({
      organizationId: workspace.organizationId,
      userId: workspace.userId,
      input: quotationInput(workspace),
      numberPrefix: "QT",
    });

    expect((await getUsage(workspace.organizationId)).quotationsUsed).toBe(1);
  });
});
