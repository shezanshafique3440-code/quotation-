import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { AppError, NotFoundError } from "@/lib/errors";
import { resetEnvCache } from "@/lib/env";
import {
  disableSharing,
  enableSharing,
  isExpired,
  loadPublicQuotation,
  recordPublicView,
  respondToQuotation,
  rotateShareToken,
  shareUrl,
  toPublicView,
} from "@/lib/sharing";
import { createSharedQuotation, createWorkspace, resetDatabase } from "./helpers";

const actor = { userId: "u1", label: "Sam" };

beforeEach(async () => {
  await resetDatabase();
  process.env.PUBLIC_PAGES_ENABLED = "true";
  resetEnvCache();
});

describe("share link lifecycle", () => {
  it("mints a token, keeps it stable across re-enabling, and builds an absolute URL", async () => {
    const workspace = await createWorkspace();
    const quotation = await createSharedQuotation(workspace, { publicEnabled: false });

    const token = await enableSharing(workspace.organizationId, quotation.id, {
      ...actor,
      userId: workspace.userId,
    });
    expect(token.length).toBeGreaterThan(20);
    expect(shareUrl(token)).toMatch(/^https?:\/\/.+\/q\/.+$/);

    await disableSharing(workspace.organizationId, quotation.id, {
      ...actor,
      userId: workspace.userId,
    });
    const again = await enableSharing(workspace.organizationId, quotation.id, {
      ...actor,
      userId: workspace.userId,
    });
    expect(again).toBe(token);
  });

  it("rotating replaces the token so the old link stops resolving", async () => {
    const workspace = await createWorkspace();
    const quotation = await createSharedQuotation(workspace);
    const original = quotation.publicToken!;

    const rotated = await rotateShareToken(workspace.organizationId, quotation.id, {
      ...actor,
      userId: workspace.userId,
    });

    expect(rotated).not.toBe(original);
    expect(await loadPublicQuotation(original)).toBeNull();
    expect(await loadPublicQuotation(rotated)).not.toBeNull();
  });

  it("records an auditable event for every share change", async () => {
    const workspace = await createWorkspace();
    const quotation = await createSharedQuotation(workspace, { publicEnabled: false });

    await enableSharing(workspace.organizationId, quotation.id, { ...actor, userId: workspace.userId });
    await rotateShareToken(workspace.organizationId, quotation.id, { ...actor, userId: workspace.userId });
    await disableSharing(workspace.organizationId, quotation.id, { ...actor, userId: workspace.userId });

    const kinds = (
      await prisma.activityEvent.findMany({
        where: { quotationId: quotation.id },
        orderBy: { createdAt: "asc" },
        select: { kind: true },
      })
    ).map((e) => e.kind);

    expect(kinds).toContain("quotation.share_enabled");
    expect(kinds).toContain("quotation.share_rotated");
    expect(kinds).toContain("quotation.share_disabled");
  });

  it("refuses to touch another workspace's quotation", async () => {
    const mine = await createWorkspace();
    const theirs = await createWorkspace();
    const quotation = await createSharedQuotation(theirs);

    await expect(
      enableSharing(mine.organizationId, quotation.id, { ...actor, userId: mine.userId }),
    ).rejects.toThrow(NotFoundError);
    await expect(
      rotateShareToken(mine.organizationId, quotation.id, { ...actor, userId: mine.userId }),
    ).rejects.toThrow(NotFoundError);
    await expect(
      disableSharing(mine.organizationId, quotation.id, { ...actor, userId: mine.userId }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe("loadPublicQuotation", () => {
  it("resolves a live link", async () => {
    const workspace = await createWorkspace();
    const quotation = await createSharedQuotation(workspace);
    expect((await loadPublicQuotation(quotation.publicToken!))?.id).toBe(quotation.id);
  });

  it("returns null — never an error that confirms existence — for every closed case", async () => {
    const workspace = await createWorkspace();

    const disabled = await createSharedQuotation(workspace, { publicEnabled: false });
    expect(await loadPublicQuotation(disabled.publicToken!)).toBeNull();

    const draft = await createSharedQuotation(workspace, { status: "draft" });
    expect(await loadPublicQuotation(draft.publicToken!)).toBeNull();

    expect(await loadPublicQuotation("unknown-token-value-that-is-long")).toBeNull();
    expect(await loadPublicQuotation("")).toBeNull();
    expect(await loadPublicQuotation("short")).toBeNull();
    expect(await loadPublicQuotation("x".repeat(500))).toBeNull();
  });

  it("honours the per-workspace switch and the fleet-wide kill switch", async () => {
    const workspace = await createWorkspace({ publicPagesEnabled: false });
    const quotation = await createSharedQuotation(workspace);
    expect(await loadPublicQuotation(quotation.publicToken!)).toBeNull();

    const open = await createWorkspace();
    const openQuotation = await createSharedQuotation(open);
    expect(await loadPublicQuotation(openQuotation.publicToken!)).not.toBeNull();

    process.env.PUBLIC_PAGES_ENABLED = "false";
    resetEnvCache();
    expect(await loadPublicQuotation(openQuotation.publicToken!)).toBeNull();
  });
});

describe("toPublicView", () => {
  it("exposes the customer-facing fields and withholds internal ones", async () => {
    const workspace = await createWorkspace();
    const quotation = await createSharedQuotation(workspace);
    await prisma.quotation.update({
      where: { id: quotation.id },
      data: { exchangeRateToBase: 1.23, aiModel: "claude-opus-5", aiGenerated: true },
    });

    const record = await loadPublicQuotation(quotation.publicToken!);
    const view = toPublicView(record!);

    expect(view.number).toBe(quotation.number);
    expect(view.items).toHaveLength(1);
    expect(view.business.legalName).toBeTruthy();

    // An allow-list projection: internal provenance and FX never appear.
    const serialised = JSON.stringify(view);
    expect(serialised).not.toContain("claude-opus-5");
    expect(serialised).not.toContain("exchangeRate");
    expect(serialised).not.toContain("aiGenerated");
    expect(Object.keys(view)).not.toContain("publicToken");
  });
});

describe("isExpired", () => {
  const now = new Date("2026-04-02T00:00:00Z");

  it("is true past the validity instant and false before it", () => {
    expect(isExpired({ validUntil: new Date("2026-04-01T23:59:59Z"), status: "sent" }, now)).toBe(true);
    expect(isExpired({ validUntil: new Date("2026-04-02T00:00:01Z"), status: "sent" }, now)).toBe(false);
  });

  it("treats a missing validity date as never expiring", () => {
    expect(isExpired({ validUntil: null, status: "sent" }, now)).toBe(false);
  });

  it("respects an already-expired status", () => {
    expect(isExpired({ validUntil: null, status: "expired" }, now)).toBe(true);
  });
});

describe("recordPublicView", () => {
  it("counts a real view and writes a timeline entry", async () => {
    const workspace = await createWorkspace();
    const quotation = await createSharedQuotation(workspace);
    const record = (await loadPublicQuotation(quotation.publicToken!))!;

    await recordPublicView(record, { ipHash: "hash", userAgent: "Mozilla/5.0", automated: false });

    const updated = await prisma.quotation.findUniqueOrThrow({ where: { id: quotation.id } });
    expect(updated.viewCount).toBe(1);
    expect(updated.firstViewedAt).not.toBeNull();
    expect(updated.lastViewedAt).not.toBeNull();

    const events = await prisma.activityEvent.findMany({
      where: { quotationId: quotation.id, kind: "quotation.viewed" },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.actorType).toBe("customer");
  });

  it("ignores automated agents, so a link preview is never reported as a customer view", async () => {
    const workspace = await createWorkspace();
    const quotation = await createSharedQuotation(workspace);
    const record = (await loadPublicQuotation(quotation.publicToken!))!;

    await recordPublicView(record, {
      ipHash: null,
      userAgent: "WhatsApp/2.23",
      automated: true,
    });

    const updated = await prisma.quotation.findUniqueOrThrow({ where: { id: quotation.id } });
    expect(updated.viewCount).toBe(0);
    expect(updated.firstViewedAt).toBeNull();
    expect(
      await prisma.activityEvent.count({ where: { quotationId: quotation.id, kind: "quotation.viewed" } }),
    ).toBe(0);
  });

  it("collapses a refresh inside the dedupe window but counts a later visit", async () => {
    const workspace = await createWorkspace();
    const quotation = await createSharedQuotation(workspace);
    const first = (await loadPublicQuotation(quotation.publicToken!))!;
    const start = new Date("2026-04-01T10:00:00Z");

    await recordPublicView(first, { ipHash: null, userAgent: "ua", automated: false }, start);

    const second = (await loadPublicQuotation(quotation.publicToken!))!;
    await recordPublicView(
      second,
      { ipHash: null, userAgent: "ua", automated: false },
      new Date(start.getTime() + 60_000),
    );
    expect((await prisma.quotation.findUniqueOrThrow({ where: { id: quotation.id } })).viewCount).toBe(1);

    const third = (await loadPublicQuotation(quotation.publicToken!))!;
    await recordPublicView(
      third,
      { ipHash: null, userAgent: "ua", automated: false },
      new Date(start.getTime() + 20 * 60_000),
    );
    expect((await prisma.quotation.findUniqueOrThrow({ where: { id: quotation.id } })).viewCount).toBe(2);
  });
});

describe("respondToQuotation", () => {
  const base = { ipHash: "iphash", userAgent: "Mozilla/5.0" };

  it("accepts, records the decision and cancels pending follow-ups", async () => {
    const workspace = await createWorkspace();
    const quotation = await createSharedQuotation(workspace);
    await prisma.reminder.create({
      data: {
        organizationId: workspace.organizationId,
        quotationId: quotation.id,
        channel: "whatsapp",
        dueAt: new Date(Date.now() + 86_400_000),
        autoCreated: true,
      },
    });

    const record = (await loadPublicQuotation(quotation.publicToken!))!;
    const result = await respondToQuotation(record, {
      decision: "accept",
      respondedByName: "Dana Whitfield",
      ...base,
    });

    expect(result).toEqual({ status: "accepted", alreadyDecided: false });

    const updated = await prisma.quotation.findUniqueOrThrow({ where: { id: quotation.id } });
    expect(updated.status).toBe("accepted");
    expect(updated.decisionSource).toBe("public_page");
    expect(updated.respondedByName).toBe("Dana Whitfield");
    expect(updated.respondedAt).not.toBeNull();
    expect(updated.decidedAt).not.toBeNull();

    expect(await prisma.reminder.count({ where: { quotationId: quotation.id, status: "pending" } })).toBe(0);
    expect(
      await prisma.activityEvent.count({
        where: { quotationId: quotation.id, kind: "quotation.accepted" },
      }),
    ).toBe(1);
  });

  it("declines and stores the reason", async () => {
    const workspace = await createWorkspace();
    const quotation = await createSharedQuotation(workspace);
    const record = (await loadPublicQuotation(quotation.publicToken!))!;

    await respondToQuotation(record, {
      decision: "reject",
      respondedByName: "Dana",
      rejectionReason: "Went with another supplier",
      ...base,
    });

    const updated = await prisma.quotation.findUniqueOrThrow({ where: { id: quotation.id } });
    expect(updated.status).toBe("rejected");
    expect(updated.rejectionReason).toBe("Went with another supplier");
    expect(updated.signatureName).toBeNull();
  });

  it("records a typed signature with its timestamp and IP hash", async () => {
    const workspace = await createWorkspace();
    const quotation = await createSharedQuotation(workspace, { requireSignature: true });
    const record = (await loadPublicQuotation(quotation.publicToken!))!;

    await respondToQuotation(record, {
      decision: "accept",
      respondedByName: "Dana Whitfield",
      signatureName: "Dana Whitfield",
      signatureEmail: "dana@example.test",
      ...base,
    });

    const updated = await prisma.quotation.findUniqueOrThrow({ where: { id: quotation.id } });
    expect(updated.signatureName).toBe("Dana Whitfield");
    expect(updated.signatureEmail).toBe("dana@example.test");
    expect(updated.signedAt).not.toBeNull();
    expect(updated.signatureIpHash).toBe("iphash");

    expect(
      await prisma.activityEvent.count({
        where: { quotationId: quotation.id, kind: "quotation.signed" },
      }),
    ).toBe(1);
  });

  it("refuses to accept without a signature when one is required", async () => {
    const workspace = await createWorkspace();
    const quotation = await createSharedQuotation(workspace, { requireSignature: true });
    const record = (await loadPublicQuotation(quotation.publicToken!))!;

    await expect(
      respondToQuotation(record, { decision: "accept", respondedByName: "Dana", ...base }),
    ).rejects.toMatchObject({ code: "signature_required" });

    await expect(
      respondToQuotation(record, {
        decision: "accept",
        respondedByName: "Dana",
        signatureName: " D ",
        ...base,
      }),
    ).rejects.toMatchObject({ code: "signature_required" });

    expect((await prisma.quotation.findUniqueOrThrow({ where: { id: quotation.id } })).status).toBe("sent");
  });

  it("refuses an expired quotation", async () => {
    const workspace = await createWorkspace();
    const quotation = await createSharedQuotation(workspace, {
      validUntil: new Date("2026-01-01T00:00:00Z"),
    });
    const record = (await loadPublicQuotation(quotation.publicToken!))!;

    await expect(
      respondToQuotation(record, { decision: "accept", respondedByName: "Dana", ...base }, new Date()),
    ).rejects.toMatchObject({ code: "expired" });
  });

  it("refuses a quotation that is not open for a response", async () => {
    const workspace = await createWorkspace();
    const quotation = await createSharedQuotation(workspace, { status: "expired" });
    const record = (await loadPublicQuotation(quotation.publicToken!))!;

    await expect(
      respondToQuotation(record, { decision: "accept", respondedByName: "Dana", ...base }),
    ).rejects.toThrow(AppError);
  });

  it("is idempotent: a second response reports the first decision instead of overwriting it", async () => {
    const workspace = await createWorkspace();
    const quotation = await createSharedQuotation(workspace);

    const first = (await loadPublicQuotation(quotation.publicToken!))!;
    await respondToQuotation(first, { decision: "accept", respondedByName: "Dana", ...base });

    const second = (await loadPublicQuotation(quotation.publicToken!))!;
    const result = await respondToQuotation(second, {
      decision: "reject",
      respondedByName: "Someone else",
      ...base,
    });

    expect(result).toEqual({ status: "accepted", alreadyDecided: true });
    const updated = await prisma.quotation.findUniqueOrThrow({ where: { id: quotation.id } });
    expect(updated.status).toBe("accepted");
    expect(updated.respondedByName).toBe("Dana");
  });

  it("lets two concurrent responses produce exactly one decision", async () => {
    const workspace = await createWorkspace();
    const quotation = await createSharedQuotation(workspace);
    const record = (await loadPublicQuotation(quotation.publicToken!))!;

    const outcomes = await Promise.allSettled([
      respondToQuotation(record, { decision: "accept", respondedByName: "A", ...base }),
      respondToQuotation(record, { decision: "reject", respondedByName: "B", ...base }),
    ]);

    const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);

    const updated = await prisma.quotation.findUniqueOrThrow({ where: { id: quotation.id } });
    expect(["accepted", "rejected"]).toContain(updated.status);

    const decisions = await prisma.activityEvent.count({
      where: {
        quotationId: quotation.id,
        kind: { in: ["quotation.accepted", "quotation.rejected"] },
      },
    });
    expect(decisions).toBe(1);
  });

  it("marks the originating inquiry won on acceptance", async () => {
    const workspace = await createWorkspace();
    const { createQuotation } = await import("@/lib/quotations");
    const { randomShareToken } = await import("@/lib/crypto");
    const { quotationInput } = await import("./helpers");

    const created = await createQuotation({
      organizationId: workspace.organizationId,
      userId: workspace.userId,
      input: quotationInput(workspace, { inquiryId: workspace.inquiryId }),
      numberPrefix: "QT",
    });
    await prisma.quotation.update({
      where: { id: created.id },
      data: { status: "sent", publicToken: randomShareToken(), publicEnabled: true },
    });

    const record = (await loadPublicQuotation(
      (await prisma.quotation.findUniqueOrThrow({ where: { id: created.id } })).publicToken!,
    ))!;
    await respondToQuotation(record, { decision: "accept", respondedByName: "Dana", ...base });

    expect(
      (await prisma.inquiry.findUniqueOrThrow({ where: { id: workspace.inquiryId } })).status,
    ).toBe("won");
  });
});
