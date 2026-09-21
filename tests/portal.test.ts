import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { resetEnvCache } from "@/lib/env";
import { NotFoundError } from "@/lib/errors";
import {
  hasActivePortalLink,
  issuePortalLink,
  loadPortal,
  portalUrl,
  recordPortalVisit,
  revokePortalLinks,
} from "@/lib/portal";
import { createSharedQuotation, createWorkspace, resetDatabase } from "./helpers";

beforeEach(async () => {
  await resetDatabase();
  process.env.PUBLIC_PAGES_ENABLED = "true";
  resetEnvCache();
});

function actorFor(workspace: { userId: string }) {
  return { userId: workspace.userId, label: "Sam" };
}

describe("issuePortalLink", () => {
  it("returns a usable link and stores only its hash", async () => {
    const workspace = await createWorkspace();
    const link = await issuePortalLink(workspace.organizationId, workspace.customerId, actorFor(workspace));

    expect(link.token.length).toBeGreaterThan(30);
    expect(link.url).toBe(portalUrl(link.token));
    expect(link.expiresAt.getTime()).toBeGreaterThan(Date.now());

    const rows = await prisma.customerPortalToken.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).not.toBe(link.token);
    expect(rows[0]!.id).toMatch(/^[0-9a-f]{64}$/);
  });

  it("revokes the previous link, so only one credential is live", async () => {
    const workspace = await createWorkspace();
    const first = await issuePortalLink(workspace.organizationId, workspace.customerId, actorFor(workspace));
    const second = await issuePortalLink(workspace.organizationId, workspace.customerId, actorFor(workspace));

    expect(await loadPortal(first.token)).toBeNull();
    expect(await loadPortal(second.token)).not.toBeNull();
    expect(await prisma.customerPortalToken.count({ where: { revokedAt: null } })).toBe(1);
  });

  it("refuses a customer in another workspace", async () => {
    const mine = await createWorkspace();
    const theirs = await createWorkspace();

    await expect(
      issuePortalLink(mine.organizationId, theirs.customerId, actorFor(mine)),
    ).rejects.toThrow(NotFoundError);
  });

  it("writes an audit row", async () => {
    const workspace = await createWorkspace();
    await issuePortalLink(workspace.organizationId, workspace.customerId, actorFor(workspace));

    const events = await prisma.activityEvent.findMany({
      where: { customerId: workspace.customerId, kind: "customer.portal_link_issued" },
    });
    expect(events).toHaveLength(1);
  });
});

describe("revokePortalLinks", () => {
  it("kills a live link and is a no-op when there is none", async () => {
    const workspace = await createWorkspace();
    const link = await issuePortalLink(workspace.organizationId, workspace.customerId, actorFor(workspace));

    expect(await revokePortalLinks(workspace.organizationId, workspace.customerId, actorFor(workspace))).toBe(1);
    expect(await loadPortal(link.token)).toBeNull();
    expect(await revokePortalLinks(workspace.organizationId, workspace.customerId, actorFor(workspace))).toBe(0);
  });

  it("cannot revoke another workspace's links", async () => {
    const mine = await createWorkspace();
    const theirs = await createWorkspace();
    const link = await issuePortalLink(theirs.organizationId, theirs.customerId, actorFor(theirs));

    expect(await revokePortalLinks(mine.organizationId, theirs.customerId, actorFor(mine))).toBe(0);
    expect(await loadPortal(link.token)).not.toBeNull();
  });
});

describe("hasActivePortalLink", () => {
  it("reports the live link and its expiry", async () => {
    const workspace = await createWorkspace();
    expect(await hasActivePortalLink(workspace.organizationId, workspace.customerId)).toEqual({
      active: false,
      expiresAt: null,
    });

    const link = await issuePortalLink(workspace.organizationId, workspace.customerId, actorFor(workspace));
    const status = await hasActivePortalLink(workspace.organizationId, workspace.customerId);
    expect(status.active).toBe(true);
    expect(status.expiresAt?.getTime()).toBe(link.expiresAt.getTime());
  });
});

describe("loadPortal", () => {
  it("lists the customer's sent quotations, newest first", async () => {
    const workspace = await createWorkspace();
    await createSharedQuotation(workspace);
    await createSharedQuotation(workspace, { status: "accepted" });

    const link = await issuePortalLink(workspace.organizationId, workspace.customerId, actorFor(workspace));
    const session = await loadPortal(link.token);

    expect(session).not.toBeNull();
    expect(session!.quotations).toHaveLength(2);
    expect(session!.customer.name).toContain("Customer");
    expect(session!.business.legalName).toBeTruthy();
    expect(session!.palette.base).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("never shows a draft, because the business has not issued it", async () => {
    const workspace = await createWorkspace();
    await createSharedQuotation(workspace, { status: "draft" });
    await createSharedQuotation(workspace);

    const link = await issuePortalLink(workspace.organizationId, workspace.customerId, actorFor(workspace));
    const session = await loadPortal(link.token);

    expect(session!.quotations).toHaveLength(1);
    expect(session!.quotations[0]!.status).toBe("sent");
  });

  it("shows only that customer's quotations", async () => {
    const workspace = await createWorkspace();
    const other = await prisma.customer.create({
      data: { organizationId: workspace.organizationId, name: "Someone Else" },
    });
    await createSharedQuotation(workspace);

    const link = await issuePortalLink(workspace.organizationId, other.id, actorFor(workspace));
    const session = await loadPortal(link.token);

    expect(session!.quotations).toHaveLength(0);
  });

  it("returns null for an expired, revoked, unknown or malformed token", async () => {
    const workspace = await createWorkspace();
    const link = await issuePortalLink(workspace.organizationId, workspace.customerId, actorFor(workspace));

    expect(await loadPortal("unknown-token-value-long-enough")).toBeNull();
    expect(await loadPortal("short")).toBeNull();
    expect(await loadPortal("")).toBeNull();

    expect(
      await loadPortal(link.token, new Date(link.expiresAt.getTime() + 1000)),
    ).toBeNull();

    await revokePortalLinks(workspace.organizationId, workspace.customerId, actorFor(workspace));
    expect(await loadPortal(link.token)).toBeNull();
  });

  it("is blocked by the fleet-wide kill switch", async () => {
    const workspace = await createWorkspace();
    const link = await issuePortalLink(workspace.organizationId, workspace.customerId, actorFor(workspace));

    process.env.PUBLIC_PAGES_ENABLED = "false";
    resetEnvCache();
    expect(await loadPortal(link.token)).toBeNull();
  });
});

describe("recordPortalVisit", () => {
  it("records a real visit once per window and never for a bot", async () => {
    const workspace = await createWorkspace();
    const link = await issuePortalLink(workspace.organizationId, workspace.customerId, actorFor(workspace));
    const session = (await loadPortal(link.token))!;
    const start = new Date("2026-04-01T10:00:00Z");

    await recordPortalVisit(link.token, session, { ipHash: "h", userAgent: "ua", automated: false }, start);
    await recordPortalVisit(
      link.token,
      session,
      { ipHash: "h", userAgent: "ua", automated: false },
      new Date(start.getTime() + 60_000),
    );
    await recordPortalVisit(
      link.token,
      session,
      { ipHash: null, userAgent: "bot", automated: true },
      new Date(start.getTime() + 10 * 3_600_000),
    );

    const events = await prisma.activityEvent.count({
      where: { customerId: workspace.customerId, kind: "customer.portal_opened" },
    });
    expect(events).toBe(1);

    const row = await prisma.customerPortalToken.findFirstOrThrow({ where: { revokedAt: null } });
    expect(row.lastUsedAt).not.toBeNull();
  });
});
