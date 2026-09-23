import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { changeMemberRole, listMembers, listPendingInvitations, removeMember } from "@/lib/members";
import { createInvitation } from "@/lib/invitations";
import { hashPassword } from "@/lib/password";
import { createSession, resolveSession } from "@/lib/session";
import { createWorkspace, resetDatabase, type Workspace } from "./helpers";

beforeEach(resetDatabase);

let seq = 0;

/** Add somebody to a workspace directly, so role tests start where they mean to. */
async function addMember(workspace: Workspace, role: string, email?: string) {
  seq += 1;
  const user = await prisma.user.create({
    data: {
      email: email ?? `member${seq}@example.test`,
      name: `Member ${seq}`,
      passwordHash: await hashPassword("correct-horse-battery"),
    },
  });
  const membership = await prisma.membership.create({
    data: { userId: user.id, organizationId: workspace.organizationId, role },
  });
  return { user, membership };
}

function ownerCtx(workspace: Workspace) {
  return {
    organizationId: workspace.organizationId,
    actorUserId: workspace.userId,
    actorRole: "owner",
    actorLabel: "Owner",
  };
}

describe("listMembers", () => {
  it("returns everyone, oldest first, with their role", async () => {
    const workspace = await createWorkspace({ plan: "pro" });
    await addMember(workspace, "member");

    const members = await listMembers(workspace.organizationId);
    expect(members).toHaveLength(2);
    expect(members[0]!.role).toBe("owner");
    expect(members[1]!.role).toBe("member");
  });

  it("never returns another workspace's people", async () => {
    const mine = await createWorkspace({ plan: "pro" });
    const theirs = await createWorkspace({ plan: "pro" });
    await addMember(theirs, "member");

    const members = await listMembers(mine.organizationId);
    expect(members).toHaveLength(1);
    expect(members[0]!.userId).toBe(mine.userId);
  });

  it("reports whether each address is confirmed", async () => {
    const workspace = await createWorkspace({ plan: "pro" });
    const { user } = await addMember(workspace, "member");

    const before = await listMembers(workspace.organizationId);
    expect(before.find((m) => m.userId === user.id)!.emailVerifiedAt).toBeNull();

    await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
    const after = await listMembers(workspace.organizationId);
    expect(after.find((m) => m.userId === user.id)!.emailVerifiedAt).not.toBeNull();
  });
});

describe("listPendingInvitations", () => {
  it("shows only this workspace's live invitations", async () => {
    const mine = await createWorkspace({ plan: "pro" });
    const theirs = await createWorkspace({ plan: "pro" });

    await createInvitation({
      organizationId: mine.organizationId,
      plan: "pro",
      email: "alex@example.test",
      role: "member",
      actor: { userId: mine.userId, label: "Owner" },
    });
    await createInvitation({
      organizationId: theirs.organizationId,
      plan: "pro",
      email: "sam@example.test",
      role: "member",
      actor: { userId: theirs.userId, label: "Owner" },
    });

    const pending = await listPendingInvitations(mine.organizationId);
    expect(pending).toHaveLength(1);
    expect(pending[0]!.email).toBe("alex@example.test");
  });
});

describe("removeMember", () => {
  it("removes the membership and records who did it", async () => {
    const workspace = await createWorkspace({ plan: "pro" });
    const { membership, user } = await addMember(workspace, "member");

    const result = await removeMember(ownerCtx(workspace), membership.id);
    expect(result.removedEmail).toBe(user.email);
    expect(await prisma.membership.findUnique({ where: { id: membership.id } })).toBeNull();

    const event = await prisma.activityEvent.findFirstOrThrow({
      where: { kind: "security.member_removed" },
    });
    expect(event.summary).toMatch(/removed/i);
  });

  it("ends the removed person's access on their next request", async () => {
    const workspace = await createWorkspace({ plan: "pro" });
    const { membership, user } = await addMember(workspace, "member");
    const { token } = await createSession(user.id, workspace.organizationId);

    expect(await resolveSession(token)).not.toBeNull();
    await removeMember(ownerCtx(workspace), membership.id);
    expect(await resolveSession(token)).toBeNull();
  });

  it("refuses to remove yourself", async () => {
    const workspace = await createWorkspace({ plan: "pro" });
    const own = await prisma.membership.findFirstOrThrow({
      where: { userId: workspace.userId, organizationId: workspace.organizationId },
    });

    await expect(removeMember(ownerCtx(workspace), own.id)).rejects.toThrow(/cannot remove yourself/i);
  });

  it("refuses to remove the only owner", async () => {
    const workspace = await createWorkspace({ plan: "pro" });
    const { user: admin } = await addMember(workspace, "admin");
    const ownerMembership = await prisma.membership.findFirstOrThrow({
      where: { userId: workspace.userId },
    });

    const adminCtx = {
      organizationId: workspace.organizationId,
      actorUserId: admin.id,
      actorRole: "admin",
      actorLabel: "Admin",
    };

    await expect(removeMember(adminCtx, ownerMembership.id)).rejects.toThrow(/permission/i);
  });

  it("stops an admin removing another admin", async () => {
    const workspace = await createWorkspace({ plan: "pro" });
    const { user: admin } = await addMember(workspace, "admin");
    const { membership: otherAdmin } = await addMember(workspace, "admin");

    await expect(
      removeMember(
        {
          organizationId: workspace.organizationId,
          actorUserId: admin.id,
          actorRole: "admin",
          actorLabel: "Admin",
        },
        otherAdmin.id,
      ),
    ).rejects.toThrow(/permission/i);
  });

  it("stops a member removing anyone", async () => {
    const workspace = await createWorkspace({ plan: "pro" });
    const { user: member } = await addMember(workspace, "member");
    const { membership: target } = await addMember(workspace, "member");

    await expect(
      removeMember(
        {
          organizationId: workspace.organizationId,
          actorUserId: member.id,
          actorRole: "member",
          actorLabel: "Member",
        },
        target.id,
      ),
    ).rejects.toThrow(/permission/i);
  });

  it("refuses a membership belonging to another workspace", async () => {
    const mine = await createWorkspace({ plan: "pro" });
    const theirs = await createWorkspace({ plan: "pro" });
    const { membership } = await addMember(theirs, "member");

    await expect(removeMember(ownerCtx(mine), membership.id)).rejects.toThrow(/not in this workspace/i);
    expect(await prisma.membership.findUnique({ where: { id: membership.id } })).not.toBeNull();
  });
});

describe("changeMemberRole", () => {
  it("promotes and demotes, and records the change", async () => {
    const workspace = await createWorkspace({ plan: "pro" });
    const { membership } = await addMember(workspace, "member");

    await changeMemberRole(ownerCtx(workspace), membership.id, "admin");
    expect(
      (await prisma.membership.findUniqueOrThrow({ where: { id: membership.id } })).role,
    ).toBe("admin");

    const event = await prisma.activityEvent.findFirstOrThrow({
      where: { kind: "security.member_role_changed" },
    });
    expect(event.summary).toMatch(/member to admin/i);
  });

  it("is a no-op when the role is unchanged", async () => {
    const workspace = await createWorkspace({ plan: "pro" });
    const { membership } = await addMember(workspace, "member");

    await changeMemberRole(ownerCtx(workspace), membership.id, "member");
    expect(
      await prisma.activityEvent.count({ where: { kind: "security.member_role_changed" } }),
    ).toBe(0);
  });

  it("refuses an unknown role", async () => {
    const workspace = await createWorkspace({ plan: "pro" });
    const { membership } = await addMember(workspace, "member");

    await expect(changeMemberRole(ownerCtx(workspace), membership.id, "superuser")).rejects.toThrow(
      /not a valid role/i,
    );
  });

  it("stops an admin handing out ownership", async () => {
    const workspace = await createWorkspace({ plan: "pro" });
    const { user: admin } = await addMember(workspace, "admin");
    const { membership: target } = await addMember(workspace, "member");

    await expect(
      changeMemberRole(
        {
          organizationId: workspace.organizationId,
          actorUserId: admin.id,
          actorRole: "admin",
          actorLabel: "Admin",
        },
        target.id,
        "owner",
      ),
    ).rejects.toThrow(/only an owner/i);
  });

  it("refuses to demote the last owner", async () => {
    const workspace = await createWorkspace({ plan: "pro" });
    const { user: second } = await addMember(workspace, "owner");
    const ownerMembership = await prisma.membership.findFirstOrThrow({
      where: { userId: workspace.userId },
    });

    // A second owner exists, so demoting the first is allowed.
    await changeMemberRole(ownerCtx(workspace), ownerMembership.id, "admin");

    const secondMembership = await prisma.membership.findFirstOrThrow({
      where: { userId: second.id },
    });
    await expect(
      changeMemberRole(
        {
          organizationId: workspace.organizationId,
          actorUserId: second.id,
          actorRole: "owner",
          actorLabel: "Owner Two",
        },
        secondMembership.id,
        "admin",
      ),
    ).rejects.toThrow(/only owner/i);
  });
});
