import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  defaultValidUntil,
  expireLapsedQuotations,
  nextFollowUpAt,
  scheduleAutoFollowUp,
} from "@/lib/follow-ups";
import { zonedParts } from "@/lib/timezone";
import { createSharedQuotation, createWorkspace, resetDatabase } from "./helpers";

beforeEach(resetDatabase);

describe("nextFollowUpAt", () => {
  it("lands at a civilised local hour, the requested number of days out", () => {
    const sent = new Date("2026-04-01T22:00:00Z");
    const due = nextFollowUpAt(sent, 3, "Europe/Berlin");
    const parts = zonedParts(due, "Europe/Berlin");

    expect(parts.hour).toBe(10);
    expect(parts.minute).toBe(0);
    // 22:00Z on 1 April is already 2 April in Berlin, so +3 days is 5 April.
    expect(parts.day).toBe(5);
  });

  it("uses the business's own morning, not the server's", () => {
    const sent = new Date("2026-04-01T09:00:00Z");
    for (const zone of ["Pacific/Auckland", "America/Los_Angeles", "Asia/Kolkata"]) {
      expect(zonedParts(nextFollowUpAt(sent, 2, zone), zone).hour).toBe(10);
    }
  });

  it("pulls the chase earlier rather than scheduling it after expiry", () => {
    const sent = new Date("2026-04-01T09:00:00Z");
    const validUntil = new Date("2026-04-02T23:59:59.999Z");
    const due = nextFollowUpAt(sent, 7, "UTC", validUntil);

    expect(due.getTime()).toBeLessThan(validUntil.getTime());
    expect(due.getTime()).toBeGreaterThan(sent.getTime());
  });

  it("always lands in the future, even with a same-day expiry", () => {
    const sent = new Date("2026-04-01T09:00:00Z");
    const due = nextFollowUpAt(sent, 5, "UTC", new Date("2026-04-01T18:00:00Z"));
    expect(due.getTime()).toBeGreaterThan(sent.getTime());
  });
});

describe("defaultValidUntil", () => {
  it("is the end of the local day, the configured number of days out", () => {
    const now = new Date("2026-04-01T09:00:00Z");
    expect(defaultValidUntil(now, 14, "UTC").toISOString()).toBe("2026-04-15T23:59:59.999Z");
    expect(defaultValidUntil(now, 14, "Europe/Berlin").toISOString()).toBe(
      "2026-04-15T21:59:59.999Z",
    );
  });
});

describe("scheduleAutoFollowUp", () => {
  const settings = { enabled: true, days: 3, timezone: "UTC" };

  it("creates one pending reminder and a timeline row", async () => {
    const workspace = await createWorkspace();
    const quotation = await createSharedQuotation(workspace);

    const result = await prisma.$transaction((tx) =>
      scheduleAutoFollowUp(tx, quotation, settings, new Date("2026-04-01T09:00:00Z")),
    );

    expect(result.scheduled).toBe(true);
    const reminders = await prisma.reminder.findMany({ where: { quotationId: quotation.id } });
    expect(reminders).toHaveLength(1);
    expect(reminders[0]!.autoCreated).toBe(true);
    expect(reminders[0]!.status).toBe("pending");

    expect(
      await prisma.activityEvent.count({
        where: { quotationId: quotation.id, kind: "quotation.follow_up_scheduled" },
      }),
    ).toBe(1);
  });

  it("does nothing when automatic follow-ups are off, and says why", async () => {
    const workspace = await createWorkspace();
    const quotation = await createSharedQuotation(workspace);

    const result = await prisma.$transaction((tx) =>
      scheduleAutoFollowUp(tx, quotation, { ...settings, enabled: false }),
    );

    expect(result.scheduled).toBe(false);
    expect(result.reason).toMatch(/turned off/i);
    expect(await prisma.reminder.count()).toBe(0);
  });

  it("is idempotent, so re-sending does not stack duplicates", async () => {
    const workspace = await createWorkspace();
    const quotation = await createSharedQuotation(workspace);

    await prisma.$transaction((tx) => scheduleAutoFollowUp(tx, quotation, settings));
    const second = await prisma.$transaction((tx) => scheduleAutoFollowUp(tx, quotation, settings));

    expect(second.scheduled).toBe(false);
    expect(second.reason).toMatch(/already pending/i);
    expect(await prisma.reminder.count({ where: { quotationId: quotation.id } })).toBe(1);
  });

  it("schedules again once the previous follow-up is closed", async () => {
    const workspace = await createWorkspace();
    const quotation = await createSharedQuotation(workspace);

    await prisma.$transaction((tx) => scheduleAutoFollowUp(tx, quotation, settings));
    await prisma.reminder.updateMany({ where: { quotationId: quotation.id }, data: { status: "done" } });

    const again = await prisma.$transaction((tx) => scheduleAutoFollowUp(tx, quotation, settings));
    expect(again.scheduled).toBe(true);
    expect(await prisma.reminder.count({ where: { quotationId: quotation.id } })).toBe(2);
  });
});

describe("expireLapsedQuotations", () => {
  const now = new Date("2026-04-10T12:00:00Z");

  it("expires only sent quotations whose validity has passed", async () => {
    const workspace = await createWorkspace();
    const lapsed = await createSharedQuotation(workspace, {
      validUntil: new Date("2026-04-09T23:59:59.999Z"),
    });
    const current = await createSharedQuotation(workspace, {
      validUntil: new Date("2026-04-20T23:59:59.999Z"),
    });
    const undated = await createSharedQuotation(workspace, { validUntil: null });
    const accepted = await createSharedQuotation(workspace, {
      status: "accepted",
      validUntil: new Date("2026-04-01T00:00:00Z"),
    });

    const result = await expireLapsedQuotations(now);

    expect(result.expired).toBe(1);
    expect(result.quotationIds).toEqual([lapsed.id]);

    const statusOf = async (id: string) =>
      (await prisma.quotation.findUniqueOrThrow({ where: { id } })).status;

    expect(await statusOf(lapsed.id)).toBe("expired");
    expect(await statusOf(current.id)).toBe("sent");
    expect(await statusOf(undated.id)).toBe("sent");
    expect(await statusOf(accepted.id)).toBe("accepted");
  });

  it("cancels the pending chase and records why the status changed", async () => {
    const workspace = await createWorkspace();
    const lapsed = await createSharedQuotation(workspace, {
      validUntil: new Date("2026-04-09T00:00:00Z"),
    });
    await prisma.reminder.create({
      data: {
        organizationId: workspace.organizationId,
        quotationId: lapsed.id,
        channel: "whatsapp",
        dueAt: new Date("2026-04-11T10:00:00Z"),
        autoCreated: true,
      },
    });

    await expireLapsedQuotations(now);

    expect(await prisma.reminder.count({ where: { quotationId: lapsed.id, status: "pending" } })).toBe(0);
    const event = await prisma.activityEvent.findFirst({
      where: { quotationId: lapsed.id, kind: "quotation.expired" },
    });
    expect(event?.actorType).toBe("system");
  });

  it("does nothing and reports nothing when there is nothing to expire", async () => {
    const workspace = await createWorkspace();
    await createSharedQuotation(workspace, { validUntil: new Date("2026-12-31T00:00:00Z") });

    expect(await expireLapsedQuotations(now)).toEqual({ expired: 0, quotationIds: [] });
  });

  it("expires across workspaces without mixing their timelines", async () => {
    const a = await createWorkspace();
    const b = await createWorkspace();
    const lapsedA = await createSharedQuotation(a, { validUntil: new Date("2026-04-01T00:00:00Z") });
    const lapsedB = await createSharedQuotation(b, { validUntil: new Date("2026-04-01T00:00:00Z") });

    const result = await expireLapsedQuotations(now);
    expect(result.expired).toBe(2);

    const eventsA = await prisma.activityEvent.findMany({
      where: { organizationId: a.organizationId, kind: "quotation.expired" },
    });
    expect(eventsA).toHaveLength(1);
    expect(eventsA[0]!.quotationId).toBe(lapsedA.id);
    expect(eventsA[0]!.quotationId).not.toBe(lapsedB.id);
  });
});
