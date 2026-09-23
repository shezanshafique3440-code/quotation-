import { ACTIVITY_KINDS, recordActivity } from "./activity";
import { prisma } from "./db";
import { AppError, NotFoundError } from "./errors";
import { canActOn, isRole, type Role } from "./roles";

export interface WorkspaceMember {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  role: string;
  emailVerifiedAt: Date | null;
  joinedAt: Date;
}

export async function listMembers(organizationId: string): Promise<WorkspaceMember[]> {
  const memberships = await prisma.membership.findMany({
    where: { organizationId },
    orderBy: { createdAt: "asc" },
    include: {
      user: { select: { id: true, name: true, email: true, emailVerifiedAt: true } },
    },
  });

  return memberships.map((m) => ({
    membershipId: m.id,
    userId: m.userId,
    name: m.user.name,
    email: m.user.email,
    role: m.role,
    emailVerifiedAt: m.user.emailVerifiedAt,
    joinedAt: m.createdAt,
  }));
}

export interface PendingInvitation {
  id: string;
  email: string;
  role: string;
  invitedByName: string;
  expiresAt: Date;
  createdAt: Date;
}

export async function listPendingInvitations(
  organizationId: string,
  now: Date = new Date(),
): Promise<PendingInvitation[]> {
  const rows = await prisma.invitation.findMany({
    where: { organizationId, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
    orderBy: { createdAt: "desc" },
    include: { invitedBy: { select: { name: true } } },
  });

  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    role: row.role,
    invitedByName: row.invitedBy.name,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  }));
}

async function ownerCount(organizationId: string): Promise<number> {
  return prisma.membership.count({ where: { organizationId, role: "owner" } });
}

interface ActorContext {
  organizationId: string;
  actorUserId: string;
  actorRole: string;
  actorLabel: string;
}

async function loadTarget(organizationId: string, membershipId: string) {
  const membership = await prisma.membership.findFirst({
    where: { id: membershipId, organizationId },
    include: { user: { select: { id: true, name: true, email: true } } },
  });
  if (!membership) throw new NotFoundError("That person is not in this workspace.");
  return membership;
}

/**
 * Remove someone from the workspace.
 *
 * Their sessions are not deleted here and do not need to be: `resolveSession`
 * re-checks membership on every request, so access stops at the next one.
 */
export async function removeMember(
  ctx: ActorContext,
  membershipId: string,
  now: Date = new Date(),
): Promise<{ removedEmail: string }> {
  const target = await loadTarget(ctx.organizationId, membershipId);

  if (target.userId === ctx.actorUserId) {
    throw new AppError("You cannot remove yourself. Ask another owner to do it.", { status: 400 });
  }
  if (!canActOn(ctx.actorRole, target.role)) {
    throw new AppError("You do not have permission to remove that person.", { status: 403 });
  }
  if (target.role === "owner" && (await ownerCount(ctx.organizationId)) <= 1) {
    throw new AppError("A workspace must always have an owner.", { status: 400 });
  }

  await prisma.membership.delete({ where: { id: target.id } });

  await recordActivity({
    organizationId: ctx.organizationId,
    category: "security",
    kind: ACTIVITY_KINDS.memberRemoved,
    summary: `${ctx.actorLabel} removed ${target.user.name} from the workspace`,
    actorType: "user",
    actorId: ctx.actorUserId,
    actorLabel: ctx.actorLabel,
    metadata: { email: target.user.email, role: target.role, at: now.toISOString() },
  });

  return { removedEmail: target.user.email };
}

/**
 * Change someone's role.
 *
 * Promoting to owner is deliberately possible — a workspace can have several —
 * but only an existing owner may do it, and the last owner cannot be demoted.
 */
export async function changeMemberRole(
  ctx: ActorContext,
  membershipId: string,
  nextRole: string,
): Promise<{ email: string; role: Role }> {
  if (!isRole(nextRole)) throw new AppError("That is not a valid role.", { status: 400 });

  const target = await loadTarget(ctx.organizationId, membershipId);

  if (target.role === nextRole) return { email: target.user.email, role: nextRole };

  if (!canActOn(ctx.actorRole, target.role)) {
    throw new AppError("You do not have permission to change that person's role.", { status: 403 });
  }
  if (nextRole === "owner" && ctx.actorRole !== "owner") {
    throw new AppError("Only an owner can make someone else an owner.", { status: 403 });
  }
  if (target.role === "owner" && (await ownerCount(ctx.organizationId)) <= 1) {
    throw new AppError(
      "This is the only owner. Make someone else an owner first, then change this role.",
      { status: 400 },
    );
  }

  await prisma.membership.update({ where: { id: target.id }, data: { role: nextRole } });

  await recordActivity({
    organizationId: ctx.organizationId,
    category: "security",
    kind: ACTIVITY_KINDS.memberRoleChanged,
    summary: `${ctx.actorLabel} changed ${target.user.name} from ${target.role} to ${nextRole}`,
    actorType: "user",
    actorId: ctx.actorUserId,
    actorLabel: ctx.actorLabel,
    metadata: { email: target.user.email, from: target.role, to: nextRole },
  });

  return { email: target.user.email, role: nextRole };
}
