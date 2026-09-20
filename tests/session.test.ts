import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createSession, resolveSession, safeEquals } from "@/lib/session";
import { createWorkspace, resetDatabase } from "./helpers";

beforeEach(resetDatabase);

describe("sessions", () => {
  it("stores only a fingerprint, never the cookie token", async () => {
    const workspace = await createWorkspace();
    const { token } = await createSession(workspace.userId, workspace.organizationId);

    const rows = await prisma.session.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).not.toBe(token);
    expect(rows[0]!.id).toMatch(/^[0-9a-f]{64}$/);
  });

  it("resolves a valid token to the user and organization", async () => {
    const workspace = await createWorkspace();
    const { token } = await createSession(workspace.userId, workspace.organizationId);

    const context = await resolveSession(token);
    expect(context?.userId).toBe(workspace.userId);
    expect(context?.organizationId).toBe(workspace.organizationId);
    expect(context?.role).toBe("owner");
  });

  it("rejects a missing, unknown or tampered token", async () => {
    const workspace = await createWorkspace();
    const { token } = await createSession(workspace.userId, workspace.organizationId);

    expect(await resolveSession(undefined)).toBeNull();
    expect(await resolveSession("")).toBeNull();
    expect(await resolveSession("not-a-real-token")).toBeNull();
    expect(await resolveSession(`${token}x`)).toBeNull();
  });

  it("rejects and cleans up an expired session", async () => {
    const workspace = await createWorkspace();
    const { token } = await createSession(workspace.userId, workspace.organizationId);
    await prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });

    expect(await resolveSession(token)).toBeNull();
    expect(await prisma.session.count()).toBe(0);
  });

  it("stops resolving as soon as the membership is revoked", async () => {
    const workspace = await createWorkspace();
    const { token } = await createSession(workspace.userId, workspace.organizationId);
    await prisma.membership.deleteMany({ where: { userId: workspace.userId } });

    expect(await resolveSession(token)).toBeNull();
  });
});

describe("safeEquals", () => {
  it("compares equal-length secrets and rejects mismatches", () => {
    expect(safeEquals("abc123", "abc123")).toBe(true);
    expect(safeEquals("abc123", "abc124")).toBe(false);
    expect(safeEquals("abc", "abcd")).toBe(false);
    expect(safeEquals("", "")).toBe(true);
  });
});
