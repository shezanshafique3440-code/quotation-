import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { getReminderGroups } from "@/lib/reminder-list";
import { createWorkspace, resetDatabase } from "./helpers";

beforeEach(resetDatabase);

describe("follow-up lists", () => {
  it("keeps due work visible after hundreds of reminders have closed", async () => {
    const workspace = await createWorkspace();
    const foreign = await createWorkspace();
    const quotation = await prisma.quotation.create({ data: {
      organizationId: workspace.organizationId,
      customerId: workspace.customerId,
      createdById: workspace.userId,
      number: "LIST-0001",
      title: "Reminder list",
      currency: "USD",
      subtotalCents: 1000,
      totalCents: 1000,
    } });
    const now = new Date("2026-10-26T12:00:00Z");
    await prisma.reminder.createMany({ data: Array.from({ length: 205 }, (_, index) => ({
      organizationId: workspace.organizationId,
      quotationId: quotation.id,
      status: index % 2 === 0 ? "cancelled" : "done",
      dueAt: new Date("2026-01-01T12:00:00Z"),
    })) });
    const pending = await prisma.reminder.create({ data: {
      organizationId: workspace.organizationId,
      quotationId: quotation.id,
      status: "pending",
      dueAt: now,
    } });
    await prisma.reminder.create({ data: {
      organizationId: workspace.organizationId,
      quotationId: quotation.id,
      status: "pending",
      dueAt: new Date("2026-10-27T12:00:00Z"),
    } });

    const groups = await getReminderGroups(workspace.organizationId, { now });
    expect(groups.overdue.items.map((item) => item.id)).toEqual([pending.id]);
    expect(groups.upcoming.total).toBe(1);
    expect(groups.closed.total).toBe(205);
    expect(groups.closed.items).toHaveLength(20);
    const last = await getReminderGroups(workspace.organizationId, {
      now,
      pages: { closed: 11 },
    });
    expect(last.closed.items).toHaveLength(5);
    expect(last.closed.page).toBe(11);
    const absent = await getReminderGroups(foreign.organizationId, { now });
    expect(absent.overdue.total + absent.upcoming.total + absent.closed.total).toBe(0);
  });

  it("normalizes invalid and out-of-range pages", async () => {
    const groups = await getReminderGroups("missing-workspace", {
      pages: { overdue: "NaN", upcoming: "-3", closed: "900" },
    });
    for (const group of Object.values(groups)) {
      expect(group).toMatchObject({ page: 1, totalPages: 1, total: 0, items: [] });
    }
  });
});
