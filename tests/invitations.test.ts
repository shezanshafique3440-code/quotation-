import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  acceptInvitation,
  createInvitation,
  pruneInvitations,
  resolveInvitation,
  revokeInvitation,
  seatUsage,
} from "@/lib/invitations";
import { hashPassword } from "@/lib/password";
import { createWorkspace, resetDatabase, type Workspace } from "./helpers";

beforeEach(resetDatabase);

let outsider = 0;

async function createUser(email: string, name = "Alex Moreau") {
  outsider += 1;
  return prisma.user.create({
    data: {
      email,
      name: `${name} ${outsider}`,
      passwordHash: await hashPassword("correct-horse-battery"),
    },
  });
}

function actorOf(workspace: Workspace) {
  return { userId: workspace.userId, label: "Owner" };
}

/**
 * Free includes exactly one seat, which the owner fills, so any test that
 * expects someone to join needs a plan with room. `acceptInvitation` reads the
 * plan from the database, so it has to be set there rather than passed in.
 */
async function proWorkspace() {
  return createWorkspace({ plan: "pro" });
}

async function invite(
  workspace: Workspace,
  email: string,
  overrides: { role?: "admin" | "member"; plan?: string } = {},
) {
  return createInvitation({
    organizationId: workspace.organizationId,
    plan: overrides.plan ?? "pro",
    email,
    role: overrides.role ?? "member",
    actor: actorOf(workspace),
  });
}

describe("seatUsage", () => {
  it("counts the existing members against the plan", async () => {
    const workspace = await createWorkspace();
    const seats = await seatUsage(workspace.organizationId, "free");

    expect(seats).toMatchObject({ members: 1, pending: 0, used: 1, limit: 1, hasRoom: false });
  });

  it("counts a pending invitation as a seat already promised", async () => {
    const workspace = await createWorkspace();
    await invite(workspace, "alex@example.test");

    const seats = await seatUsage(workspace.organizationId, "pro");
    expect(seats).toMatchObject({ members: 1, pending: 1, used: 2, limit: 10, hasRoom: true });
  });

  it("stops counting an invitation once it is revoked", async () => {
    const workspace = await createWorkspace();
    await invite(workspace, "alex@example.test");
    const row = await prisma.invitation.findFirstOrThrow();
    await revokeInvitation(workspace.organizationId, row.id, actorOf(workspace));

    expect((await seatUsage(workspace.organizationId, "pro")).pending).toBe(0);
  });

  it("stops counting an invitation once it has expired", async () => {
    const workspace = await createWorkspace();
    await invite(workspace, "alex@example.test");

    const later = new Date(Date.now() + 15 * 86_400_000);
    expect((await seatUsage(workspace.organizationId, "pro", later)).pending).toBe(0);
  });
});

describe("createInvitation", () => {
  it("stores only a hash of the token", async () => {
    const workspace = await createWorkspace();
    const invitation = await invite(workspace, "alex@example.test");

    const row = await prisma.invitation.findFirstOrThrow();
    expect(row.id).not.toBe(invitation.token);
    expect(JSON.stringify(row)).not.toContain(invitation.token);
  });

  it("normalises the address", async () => {
    const workspace = await createWorkspace();
    const invitation = await invite(workspace, "  Alex@Example.TEST ");
    expect(invitation.email).toBe("alex@example.test");
  });

  it("refuses a Free workspace that has no seat left", async () => {
    const workspace = await createWorkspace();
    await expect(invite(workspace, "alex@example.test", { plan: "free" })).rejects.toThrow(
      /1 seat/i,
    );
    expect(await prisma.invitation.count()).toBe(0);
  });

  it("refuses someone who is already a member", async () => {
    const workspace = await createWorkspace();
    const owner = await prisma.user.findUniqueOrThrow({ where: { id: workspace.userId } });

    await expect(invite(workspace, owner.email)).rejects.toThrow(/already in this workspace/i);
  });

  it("refuses a second live invitation to the same address", async () => {
    const workspace = await createWorkspace();
    await invite(workspace, "alex@example.test");

    await expect(invite(workspace, "alex@example.test")).rejects.toThrow(/pending invitation/i);
  });

  it("allows a fresh invitation once the previous one is revoked", async () => {
    const workspace = await createWorkspace();
    await invite(workspace, "alex@example.test");
    const row = await prisma.invitation.findFirstOrThrow();
    await revokeInvitation(workspace.organizationId, row.id, actorOf(workspace));

    await expect(invite(workspace, "alex@example.test")).resolves.toBeTruthy();
  });

  it("writes an audit row naming the address and role", async () => {
    const workspace = await createWorkspace();
    await invite(workspace, "alex@example.test", { role: "admin" });

    const event = await prisma.activityEvent.findFirstOrThrow({
      where: { kind: "security.member_invited" },
    });
    expect(event.summary).toMatch(/alex@example\.test/);
    expect(event.summary).toMatch(/admin/);
  });
});

describe("resolveInvitation", () => {
  it("reports whether the address already has an account", async () => {
    const workspace = await createWorkspace();
    const withAccount = await invite(workspace, "alex@example.test");
    await createUser("alex@example.test");

    expect((await resolveInvitation(withAccount.token))?.existingUserId).not.toBeNull();

    const other = await createWorkspace();
    const withoutAccount = await invite(other, "nobody@example.test");
    expect((await resolveInvitation(withoutAccount.token))?.existingUserId).toBeNull();
  });

  it("returns nothing for a revoked, expired or unknown token", async () => {
    const workspace = await createWorkspace();
    const invitation = await invite(workspace, "alex@example.test");

    expect(await resolveInvitation("not-a-real-token-value-here")).toBeNull();
    expect(
      await resolveInvitation(invitation.token, new Date(Date.now() + 15 * 86_400_000)),
    ).toBeNull();

    const row = await prisma.invitation.findFirstOrThrow();
    await revokeInvitation(workspace.organizationId, row.id, actorOf(workspace));
    expect(await resolveInvitation(invitation.token)).toBeNull();
  });
});

describe("acceptInvitation", () => {
  it("creates the membership with the invited role", async () => {
    const workspace = await proWorkspace();
    const invitation = await invite(workspace, "alex@example.test", { role: "admin" });
    const user = await createUser("alex@example.test");

    const accepted = await acceptInvitation(invitation.token, user.id);
    expect(accepted).toMatchObject({ organizationId: workspace.organizationId, role: "admin" });

    const membership = await prisma.membership.findUniqueOrThrow({
      where: { userId_organizationId: { userId: user.id, organizationId: workspace.organizationId } },
    });
    expect(membership.role).toBe("admin");
  });

  it("refuses an account whose address is not the invited one", async () => {
    const workspace = await proWorkspace();
    const invitation = await invite(workspace, "alex@example.test");
    const someoneElse = await createUser("mallory@example.test");

    await expect(acceptInvitation(invitation.token, someoneElse.id)).rejects.toThrow(
      /sent to alex@example\.test/i,
    );
    expect(await prisma.membership.count({ where: { userId: someoneElse.id } })).toBe(0);
  });

  it("cannot be used twice", async () => {
    const workspace = await proWorkspace();
    const invitation = await invite(workspace, "alex@example.test");
    const user = await createUser("alex@example.test");

    await acceptInvitation(invitation.token, user.id);
    await expect(acceptInvitation(invitation.token, user.id)).rejects.toThrow(/no longer valid/i);
  });

  it("creates exactly one membership when the link is followed twice at once", async () => {
    const workspace = await proWorkspace();
    const invitation = await invite(workspace, "alex@example.test");
    const user = await createUser("alex@example.test");

    await Promise.allSettled([
      acceptInvitation(invitation.token, user.id),
      acceptInvitation(invitation.token, user.id),
    ]);

    expect(
      await prisma.membership.count({
        where: { userId: user.id, organizationId: workspace.organizationId },
      }),
    ).toBe(1);
  });

  it("refuses when the workspace filled up after the invitation was sent", async () => {
    const workspace = await proWorkspace();
    const invitation = await invite(workspace, "alex@example.test");
    const user = await createUser("alex@example.test");

    // Downgrade to a plan whose single seat the owner already occupies.
    await prisma.organization.update({
      where: { id: workspace.organizationId },
      data: { plan: "free" },
    });

    await expect(acceptInvitation(invitation.token, user.id)).rejects.toThrow(/no seat available/i);
    expect(await prisma.membership.count({ where: { userId: user.id } })).toBe(0);
  });

  it("writes an audit row on the joining workspace", async () => {
    const workspace = await proWorkspace();
    const invitation = await invite(workspace, "alex@example.test");
    const user = await createUser("alex@example.test");

    await acceptInvitation(invitation.token, user.id);

    const event = await prisma.activityEvent.findFirstOrThrow({
      where: { kind: "security.member_joined" },
    });
    expect(event.organizationId).toBe(workspace.organizationId);
  });

  it("never lets an invitation reach another workspace's records", async () => {
    const mine = await proWorkspace();
    const theirs = await createWorkspace();
    const invitation = await invite(mine, "alex@example.test");
    const user = await createUser("alex@example.test");

    await acceptInvitation(invitation.token, user.id);

    expect(
      await prisma.membership.count({
        where: { userId: user.id, organizationId: theirs.organizationId },
      }),
    ).toBe(0);
  });
});

describe("pruneInvitations", () => {
  it("removes long-dead invitations and keeps live ones", async () => {
    const workspace = await createWorkspace();
    await invite(workspace, "alex@example.test");

    expect(await pruneInvitations(new Date())).toBe(0);
    expect(await pruneInvitations(new Date(Date.now() + 60 * 86_400_000))).toBe(1);
  });
});
