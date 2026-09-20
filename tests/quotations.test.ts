import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { AppError, NotFoundError } from "@/lib/errors";
import {
  createQuotation,
  getQuotation,
  nextQuotationNumber,
  updateQuotation,
} from "@/lib/quotations";
import { createWorkspace, quotationInput, resetDatabase } from "./helpers";

beforeEach(resetDatabase);

describe("nextQuotationNumber", () => {
  it("starts at 0001 and increments per organization and year", async () => {
    const workspace = await createWorkspace();
    const now = new Date("2026-05-05T00:00:00.000Z");

    expect(await nextQuotationNumber(prisma, workspace.organizationId, "NJ", now)).toBe("NJ-2026-0001");

    await createQuotation({
      organizationId: workspace.organizationId,
      userId: workspace.userId,
      input: quotationInput(workspace),
      numberPrefix: "NJ",
    });

    const second = await nextQuotationNumber(prisma, workspace.organizationId, "NJ", new Date());
    expect(second.endsWith("-0002")).toBe(true);
  });

  it("numbers each workspace independently", async () => {
    const a = await createWorkspace();
    const b = await createWorkspace();

    const first = await createQuotation({
      organizationId: a.organizationId,
      userId: a.userId,
      input: quotationInput(a),
      numberPrefix: "QT",
    });
    const second = await createQuotation({
      organizationId: b.organizationId,
      userId: b.userId,
      input: quotationInput(b),
      numberPrefix: "QT",
    });

    expect(first.number).toBe(second.number);
    expect(first.organizationId).not.toBe(second.organizationId);
  });
});

describe("createQuotation", () => {
  it("persists totals computed on the server, not values supplied by the caller", async () => {
    const workspace = await createWorkspace();

    const quotation = await createQuotation({
      organizationId: workspace.organizationId,
      userId: workspace.userId,
      input: quotationInput(workspace, { discountCents: 2_000 }),
      numberPrefix: "QT",
    });

    // 2 × 10000 = 20000, less 2000 discount, 10% tax on 18000 = 1800.
    expect(quotation.subtotalCents).toBe(20_000);
    expect(quotation.discountCents).toBe(2_000);
    expect(quotation.taxCents).toBe(1_800);
    expect(quotation.totalCents).toBe(19_800);
    expect(quotation.items[0]!.lineTotalCents).toBe(20_000);
    expect(quotation.status).toBe("draft");
    expect(quotation.aiGenerated).toBe(false);
  });

  it("records AI provenance when the draft came from a model", async () => {
    const workspace = await createWorkspace();
    const quotation = await createQuotation({
      organizationId: workspace.organizationId,
      userId: workspace.userId,
      input: quotationInput(workspace),
      numberPrefix: "QT",
      ai: { model: "claude-opus-5" },
    });

    expect(quotation.aiGenerated).toBe(true);
    expect(quotation.aiModel).toBe("claude-opus-5");
  });

  it("refuses a customer belonging to another workspace", async () => {
    const mine = await createWorkspace();
    const theirs = await createWorkspace();

    await expect(
      createQuotation({
        organizationId: mine.organizationId,
        userId: mine.userId,
        input: quotationInput(mine, { customerId: theirs.customerId }),
        numberPrefix: "QT",
      }),
    ).rejects.toThrow(NotFoundError);

    expect(await prisma.quotation.count()).toBe(0);
  });

  it("refuses a line item referencing another workspace's product", async () => {
    const mine = await createWorkspace();
    const theirs = await createWorkspace();

    await expect(
      createQuotation({
        organizationId: mine.organizationId,
        userId: mine.userId,
        input: quotationInput(mine, {
          items: [
            {
              productId: theirs.productId,
              description: "Borrowed",
              quantity: 1,
              unit: "unit",
              unitPriceCents: 100,
              taxRateBp: 0,
            },
          ],
        }),
        numberPrefix: "QT",
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it("refuses an inquiry belonging to another workspace", async () => {
    const mine = await createWorkspace();
    const theirs = await createWorkspace();

    await expect(
      createQuotation({
        organizationId: mine.organizationId,
        userId: mine.userId,
        input: quotationInput(mine, { inquiryId: theirs.inquiryId }),
        numberPrefix: "QT",
      }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe("updateQuotation", () => {
  it("replaces line items and recomputes the totals", async () => {
    const workspace = await createWorkspace();
    const created = await createQuotation({
      organizationId: workspace.organizationId,
      userId: workspace.userId,
      input: quotationInput(workspace),
      numberPrefix: "QT",
    });

    const updated = await updateQuotation(
      workspace.organizationId,
      created.id,
      quotationInput(workspace, {
        title: "Revised",
        items: [
          {
            description: "One unit only",
            quantity: 1,
            unit: "unit",
            unitPriceCents: 10_000,
            taxRateBp: 0,
          },
        ],
      }),
    );

    expect(updated.title).toBe("Revised");
    expect(updated.items).toHaveLength(1);
    expect(updated.totalCents).toBe(10_000);
    expect(await prisma.quotationItem.count({ where: { quotationId: created.id } })).toBe(1);
  });

  it("refuses to edit a quotation that has already been sent", async () => {
    const workspace = await createWorkspace();
    const created = await createQuotation({
      organizationId: workspace.organizationId,
      userId: workspace.userId,
      input: quotationInput(workspace),
      numberPrefix: "QT",
    });
    await prisma.quotation.update({ where: { id: created.id }, data: { status: "sent" } });

    await expect(
      updateQuotation(workspace.organizationId, created.id, quotationInput(workspace)),
    ).rejects.toThrow(AppError);
  });

  it("refuses to edit another workspace's quotation", async () => {
    const mine = await createWorkspace();
    const theirs = await createWorkspace();
    const created = await createQuotation({
      organizationId: theirs.organizationId,
      userId: theirs.userId,
      input: quotationInput(theirs),
      numberPrefix: "QT",
    });

    await expect(
      updateQuotation(mine.organizationId, created.id, quotationInput(mine)),
    ).rejects.toThrow(NotFoundError);
  });
});

describe("getQuotation", () => {
  it("only returns a quotation inside the caller's workspace", async () => {
    const mine = await createWorkspace();
    const theirs = await createWorkspace();
    const created = await createQuotation({
      organizationId: theirs.organizationId,
      userId: theirs.userId,
      input: quotationInput(theirs),
      numberPrefix: "QT",
    });

    await expect(getQuotation(theirs.organizationId, created.id)).resolves.toMatchObject({
      id: created.id,
    });
    await expect(getQuotation(mine.organizationId, created.id)).rejects.toThrow(NotFoundError);
  });
});
