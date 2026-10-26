import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { listCustomers, listInquiries, listQuotations } from "@/lib/records";
import { createWorkspace, resetDatabase } from "./helpers";

beforeEach(resetDatabase);

describe("quotation search and pagination", () => {
  it("makes quotations older than the previous 200-row cutoff reachable and searchable", async () => {
    const workspace = await createWorkspace();
    await prisma.quotation.createMany({
      data: Array.from({ length: 201 }, (_, index) => ({
        organizationId: workspace.organizationId,
        customerId: workspace.customerId,
        number: `HISTORY-${String(index).padStart(4, "0")}`,
        title: index === 0 ? "Legacy staircase project" : `Recent project ${index}`,
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)),
      })),
    });

    const first = await listQuotations(workspace.organizationId);
    expect(first.rows).toHaveLength(25);
    expect(first.pagination).toMatchObject({ total: 201, pageCount: 9 });
    expect(first.rows.some((row) => row.number === "HISTORY-0000")).toBe(false);

    const last = await listQuotations(workspace.organizationId, { page: 9 });
    expect(last.rows).toHaveLength(1);
    expect(last.rows[0]!.number).toBe("HISTORY-0000");

    const searched = await listQuotations(workspace.organizationId, { query: "staircase" });
    expect(searched.rows.map((row) => row.number)).toEqual(["HISTORY-0000"]);
    expect(searched.pagination.total).toBe(1);
    const byNumber = await listQuotations(workspace.organizationId, { query: "HISTORY-0000" });
    expect(byNumber.rows[0]!.id).toBe(searched.rows[0]!.id);
  });

  it("keeps status counts and customer searches within the current tenant", async () => {
    const mine = await createWorkspace();
    const theirs = await createWorkspace();
    await prisma.customer.update({ where: { id: mine.customerId }, data: { company: "Oak Studio" } });
    await prisma.customer.update({ where: { id: theirs.customerId }, data: { company: "Oak Studio" } });
    await prisma.quotation.createMany({ data: [
      { organizationId: mine.organizationId, customerId: mine.customerId, number: "DRAFT-1", title: "Kitchen", status: "draft" },
      { organizationId: mine.organizationId, customerId: mine.customerId, number: "SENT-1", title: "Kitchen", status: "sent" },
      { organizationId: theirs.organizationId, customerId: theirs.customerId, number: "SECRET-1", title: "Kitchen", status: "accepted" },
    ] });

    const result = await listQuotations(mine.organizationId, { query: "Oak Studio", status: "sent" });
    expect(result.rows.map((row) => row.number)).toEqual(["SENT-1"]);
    expect(result.pagination.total).toBe(1);
    expect(result.total).toBe(2);
    expect(result.counts.get("draft")).toBe(1);
    expect(result.counts.get("sent")).toBe(1);
    expect(result.counts.get("accepted") ?? 0).toBe(0);
    expect((await listQuotations(mine.organizationId, { query: "SECRET-1" })).rows).toEqual([]);
  });

  it("uses a stable tie-breaker so equal timestamps do not duplicate rows between pages", async () => {
    const workspace = await createWorkspace();
    await prisma.quotation.createMany({
      data: Array.from({ length: 26 }, (_, index) => ({
        id: `quote-${String(index).padStart(2, "0")}`,
        organizationId: workspace.organizationId,
        customerId: workspace.customerId,
        number: `TIE-${index}`,
        title: "Same timestamp",
        createdAt: new Date("2026-01-01T12:00:00Z"),
      })),
    });
    const first = await listQuotations(workspace.organizationId);
    const last = await listQuotations(workspace.organizationId, { page: 999_999 });
    expect(first.rows[0]!.id).toBe("quote-25");
    expect(last.pagination.page).toBe(2);
    expect(last.rows.map((row) => row.id)).toEqual(["quote-00"]);
    expect(new Set([...first.rows, ...last.rows].map((row) => row.id)).size).toBe(26);
  });
});

describe("inquiry search and pagination", () => {
  it("makes inquiries older than the previous 100-row cutoff reachable and searchable", async () => {
    const workspace = await createWorkspace();
    await prisma.inquiry.deleteMany({ where: { organizationId: workspace.organizationId } });
    await prisma.inquiry.createMany({
      data: Array.from({ length: 101 }, (_, index) => ({
        organizationId: workspace.organizationId,
        customerId: workspace.customerId,
        subject: index === 0 ? "Legacy workshop inquiry" : `Recent inquiry ${index}`,
        message: index === 0 ? "Please price the reclaimed oak workbench." : "Please send a quote.",
        receivedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)),
      })),
    });

    const first = await listInquiries(workspace.organizationId);
    expect(first.rows).toHaveLength(25);
    expect(first.pagination).toMatchObject({ total: 101, pageCount: 5 });
    const last = await listInquiries(workspace.organizationId, { page: 5 });
    expect(last.rows.map((row) => row.subject)).toEqual(["Legacy workshop inquiry"]);
    expect((await listInquiries(workspace.organizationId, { query: "reclaimed oak" })).rows[0]!.id)
      .toBe(last.rows[0]!.id);
  });

  it("does not return another tenant's matching inquiry or inflate totals", async () => {
    const mine = await createWorkspace();
    const theirs = await createWorkspace();
    await prisma.inquiry.update({ where: { id: mine.inquiryId }, data: { subject: "Oak joinery" } });
    await prisma.inquiry.update({ where: { id: theirs.inquiryId }, data: { subject: "Oak private scope" } });

    const result = await listInquiries(mine.organizationId, { query: "Oak" });
    expect(result.pagination.total).toBe(1);
    expect(result.rows.map((row) => row.id)).toEqual([mine.inquiryId]);
    expect((await listInquiries(mine.organizationId, { query: "private scope" })).rows).toEqual([]);
  });
});

describe("customer search", () => {
  it("matches contact details within the tenant and retains related record counts", async () => {
    const mine = await createWorkspace();
    const theirs = await createWorkspace();
    await prisma.customer.update({ where: { id: mine.customerId }, data: { email: "oak@example.test" } });
    await prisma.customer.update({ where: { id: theirs.customerId }, data: { email: "oak@example.test" } });

    const result = await listCustomers(mine.organizationId, { query: "oak@example.test" });
    expect(result.pagination.total).toBe(1);
    expect(result.rows.map((row) => row.id)).toEqual([mine.customerId]);
    expect(result.rows[0]!._count.inquiries).toBe(1);
  });
});
