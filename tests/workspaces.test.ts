import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createSession, resolveSession } from "@/lib/session";
import { listWorkspaces, switchWorkspace } from "@/lib/workspaces";
import { createWorkspace, resetDatabase } from "./helpers";

beforeEach(resetDatabase);

async function setup() {
  const first = await createWorkspace({ name: "First workspace" });
  const second = await createWorkspace({ name: "Second workspace" });
  await prisma.membership.create({
    data: { userId: first.userId, organizationId: second.organizationId, role: "member" },
  });
  const { token, expiresAt } = await createSession(first.userId, first.organizationId);
  const session = (await resolveSession(token))!;
  return { first, second, token, expiresAt, session };
}

describe("workspace switching", () => {
  it("lists only workspaces the user belongs to", async () => {
    const { first, second } = await setup();
    await createWorkspace({ name: "Unrelated workspace" });

    expect(await listWorkspaces(first.userId)).toEqual([
      { id: first.organizationId, name: "First workspace", role: "owner" },
      { id: second.organizationId, name: "Second workspace", role: "member" },
    ]);
    expect(await listWorkspaces("unknown-user")).toEqual([]);
  });

  it("switches the current session, preserves expiry and uses the destination role", async () => {
    const { first, second, token, expiresAt, session } = await setup();
    const otherSession = await createSession(first.userId, first.organizationId);

    await switchWorkspace(session, second.organizationId);

    const switched = await resolveSession(token);
    expect(switched?.organizationId).toBe(second.organizationId);
    expect(switched?.role).toBe("member");
    expect(switched?.sessionId).toBe(session.sessionId);
    expect((await prisma.session.findUniqueOrThrow({ where: { id: session.sessionId } })).expiresAt)
      .toEqual(expiresAt);
    expect((await resolveSession(otherSession.token))?.organizationId).toBe(first.organizationId);
  });

  it("does not allow a guessed workspace id or create a membership", async () => {
    const { first, token, session } = await setup();
    const outsider = await createWorkspace();

    await expect(switchWorkspace(session, outsider.organizationId)).rejects.toMatchObject({ status: 403 });
    await expect(switchWorkspace(session, "nonexistent-workspace")).rejects.toMatchObject({ status: 403 });
    expect((await resolveSession(token))?.organizationId).toBe(first.organizationId);
    expect(await prisma.membership.count({ where: { userId: first.userId } })).toBe(2);
  });

  it("rejects a destination membership removed after the picker was rendered", async () => {
    const { first, second, token, session } = await setup();
    await prisma.membership.deleteMany({
      where: { userId: first.userId, organizationId: second.organizationId },
    });

    await expect(switchWorkspace(session, second.organizationId)).rejects.toMatchObject({ status: 403 });
    expect((await resolveSession(token))?.organizationId).toBe(first.organizationId);
    expect(await listWorkspaces(first.userId)).toHaveLength(1);
  });

  it("rejects revoked access to the current workspace", async () => {
    const { first, second, session } = await setup();
    await prisma.membership.deleteMany({
      where: { userId: first.userId, organizationId: first.organizationId },
    });

    await expect(switchWorkspace(session, second.organizationId)).rejects.toMatchObject({ status: 401 });
    expect((await prisma.session.findUniqueOrThrow({ where: { id: session.sessionId } })).organizationId)
      .toBe(first.organizationId);
  });

  it("rejects an expired or deleted session", async () => {
    const { first, second, session } = await setup();
    await prisma.session.update({
      where: { id: session.sessionId },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });

    await expect(switchWorkspace(session, second.organizationId)).rejects.toMatchObject({ status: 401 });
    expect((await prisma.session.findUniqueOrThrow({ where: { id: session.sessionId } })).organizationId)
      .toBe(first.organizationId);
    await prisma.session.delete({ where: { id: session.sessionId } });
    await expect(switchWorkspace(session, second.organizationId)).rejects.toMatchObject({ status: 401 });
  });

  it("cannot mutate another user's session or reuse an old workspace context", async () => {
    const { first, second, token, session } = await setup();

    await expect(switchWorkspace({ ...session, userId: second.userId }, second.organizationId))
      .rejects.toMatchObject({ status: 401 });
    expect((await resolveSession(token))?.organizationId).toBe(first.organizationId);

    await switchWorkspace(session, second.organizationId);
    await expect(switchWorkspace(session, first.organizationId)).rejects.toMatchObject({ status: 401 });
    expect((await resolveSession(token))?.organizationId).toBe(second.organizationId);
  });
});
