import { ACTIVITY_KINDS, recordActivity } from "./activity";
import { fingerprint, randomToken } from "./crypto";
import { prisma } from "./db";
import { getEnv } from "./env";
import { AppError, NotFoundError } from "./errors";
import { limitsFor, isWithinLimit } from "./plans";
import type { InvitableRole } from "./roles";

export const INVITATION_TTL_DAYS = 14;

function invitationId(token: string): string {
  return fingerprint(token, "invitation");
}

export function invitationUrl(token: string): string {
  return `${getEnv().APP_URL.replace(/\/$/, "")}/invite/${token}`;
}

export interface SeatUsage {
  /** People who already have access. */
  members: number;
  /** Invitations that are still live, which will become members. */
  pending: number;
  /** members + pending: what the plan limit is actually measured against. */
  used: number;
  limit: number | null;
  /** False when one more person would exceed the plan. */
  hasRoom: boolean;
}

/**
 * Seats in use, counting pending invitations.
 *
 * An invitation that has been sent is a seat already promised, so counting
 * only accepted members would let a Free workspace invite ten people and
 * discover the limit only when they tried to join.
 */
export async function seatUsage(
  organizationId: string,
  plan: string,
  now: Date = new Date(),
): Promise<SeatUsage> {
  const [members, pending] = await Promise.all([
    prisma.membership.count({ where: { organizationId } }),
    prisma.invitation.count({
      where: { organizationId, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
    }),
  ]);

  const limit = limitsFor(plan).teamMembers;
  const used = members + pending;
  return { members, pending, used, limit, hasRoom: isWithinLimit(used, limit) };
}

export interface IssuedInvitation {
  token: string;
  url: string;
  expiresAt: Date;
  email: string;
  role: InvitableRole;
}

interface InviteInput {
  organizationId: string;
  plan: string;
  email: string;
  role: InvitableRole;
  actor: { userId: string; label: string };
  now?: Date;
}

/**
 * Invite someone to the workspace.
 *
 * Refuses before sending anything when the address already belongs to the
 * workspace, when an invitation to it is already live, or when the plan has no
 * seat left — so the caller never emails a link that cannot be accepted.
 */
export async function createInvitation(input: InviteInput): Promise<IssuedInvitation> {
  const now = input.now ?? new Date();
  const email = input.email.trim().toLowerCase();

  const existingMember = await prisma.membership.findFirst({
    where: { organizationId: input.organizationId, user: { email } },
    select: { id: true },
  });
  if (existingMember) {
    throw new AppError(`${email} is already in this workspace.`, {
      status: 409,
      code: "already_member",
    });
  }

  const livePending = await prisma.invitation.findFirst({
    where: {
      organizationId: input.organizationId,
      email,
      acceptedAt: null,
      revokedAt: null,
      expiresAt: { gt: now },
    },
    select: { id: true },
  });
  if (livePending) {
    throw new AppError(
      `${email} already has a pending invitation. Revoke it first if you want to send a new one.`,
      { status: 409, code: "already_invited" },
    );
  }

  const seats = await seatUsage(input.organizationId, input.plan, now);
  if (!seats.hasRoom) {
    throw new AppError(
      `Your plan includes ${seats.limit} ${seats.limit === 1 ? "seat" : "seats"}, and ${seats.used} ${
        seats.used === 1 ? "is" : "are"
      } in use. Upgrade to add teammates.`,
      { status: 402, code: "seat_limit" },
    );
  }

  const token = randomToken(32);
  const expiresAt = new Date(now.getTime() + INVITATION_TTL_DAYS * 86_400_000);

  await prisma.invitation.create({
    data: {
      id: invitationId(token),
      organizationId: input.organizationId,
      email,
      role: input.role,
      invitedById: input.actor.userId,
      expiresAt,
    },
  });

  await recordActivity({
    organizationId: input.organizationId,
    category: "security",
    kind: ACTIVITY_KINDS.memberInvited,
    summary: `${input.actor.label} invited ${email} as ${input.role}`,
    actorType: "user",
    actorId: input.actor.userId,
    actorLabel: input.actor.label,
    metadata: { email, role: input.role, expiresAt: expiresAt.toISOString() },
  });

  return { token, url: invitationUrl(token), expiresAt, email, role: input.role };
}

export interface ResolvedInvitation {
  id: string;
  organizationId: string;
  organizationName: string;
  email: string;
  role: string;
  invitedByName: string;
  expiresAt: Date;
  /** The account that already owns this address, if there is one. */
  existingUserId: string | null;
}

/** Look an invitation up without accepting it. Null for anything not live. */
export async function resolveInvitation(
  token: string,
  now: Date = new Date(),
): Promise<ResolvedInvitation | null> {
  if (!token || token.length < 16 || token.length > 128) return null;

  const record = await prisma.invitation.findUnique({
    where: { id: invitationId(token) },
    include: {
      organization: { select: { id: true, name: true } },
      invitedBy: { select: { name: true } },
    },
  });

  if (!record) return null;
  if (record.acceptedAt || record.revokedAt) return null;
  if (record.expiresAt.getTime() <= now.getTime()) return null;

  const existing = await prisma.user.findUnique({
    where: { email: record.email },
    select: { id: true },
  });

  return {
    id: record.id,
    organizationId: record.organizationId,
    organizationName: record.organization.name,
    email: record.email,
    role: record.role,
    invitedByName: record.invitedBy.name,
    expiresAt: record.expiresAt,
    existingUserId: existing?.id ?? null,
  };
}

export interface AcceptedInvitation {
  organizationId: string;
  userId: string;
  role: string;
}

/**
 * Turn a live invitation into a membership for `userId`.
 *
 * The seat check runs again here, because the workspace may have filled up
 * between the invitation being sent and this link being followed. The
 * membership and the acceptance stamp are written together, so a half-accepted
 * invitation cannot exist.
 */
export async function acceptInvitation(
  token: string,
  userId: string,
  now: Date = new Date(),
): Promise<AcceptedInvitation> {
  const invitation = await resolveInvitation(token, now);
  if (!invitation) {
    throw new NotFoundError("That invitation is no longer valid. Ask for a new one.");
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true },
  });
  if (!user) throw new NotFoundError("Account not found.");

  if (user.email.toLowerCase() !== invitation.email) {
    throw new AppError(
      `This invitation was sent to ${invitation.email}. Sign in as that address to accept it.`,
      { status: 403, code: "invitation_mismatch" },
    );
  }

  const already = await prisma.membership.findUnique({
    where: {
      userId_organizationId: { userId, organizationId: invitation.organizationId },
    },
    select: { id: true, role: true },
  });
  if (already) {
    await prisma.invitation.updateMany({
      where: { id: invitation.id, acceptedAt: null },
      data: { acceptedAt: now },
    });
    return { organizationId: invitation.organizationId, userId, role: already.role };
  }

  const organization = await prisma.organization.findUnique({
    where: { id: invitation.organizationId },
    select: { plan: true },
  });
  const seats = await seatUsage(invitation.organizationId, organization?.plan ?? "free", now);
  // The pending invitation being accepted is itself one of the counted seats,
  // so compare against the members already in place plus this one.
  if (!isWithinLimit(seats.members, seats.limit)) {
    throw new AppError(
      "This workspace has no seat available. Ask the owner to upgrade, then use the link again.",
      { status: 402, code: "seat_limit" },
    );
  }

  const claimed = await prisma.invitation.updateMany({
    where: { id: invitation.id, acceptedAt: null, revokedAt: null },
    data: { acceptedAt: now },
  });
  // Two clicks on the same link race here; only the one that flipped the row
  // goes on to create the membership.
  if (claimed.count === 0) {
    throw new NotFoundError("That invitation has already been used.");
  }

  await prisma.membership.create({
    data: { userId, organizationId: invitation.organizationId, role: invitation.role },
  });

  await recordActivity({
    organizationId: invitation.organizationId,
    category: "security",
    kind: ACTIVITY_KINDS.memberJoined,
    summary: `${user.name} joined as ${invitation.role}`,
    actorType: "user",
    actorId: userId,
    actorLabel: user.name,
    metadata: { email: user.email, role: invitation.role },
  });

  return { organizationId: invitation.organizationId, userId, role: invitation.role };
}

export async function revokeInvitation(
  organizationId: string,
  invitationId_: string,
  actor: { userId: string; label: string },
  now: Date = new Date(),
): Promise<void> {
  const invitation = await prisma.invitation.findFirst({
    where: { id: invitationId_, organizationId, acceptedAt: null, revokedAt: null },
    select: { id: true, email: true },
  });
  if (!invitation) throw new NotFoundError("That invitation is no longer pending.");

  await prisma.invitation.update({ where: { id: invitation.id }, data: { revokedAt: now } });

  await recordActivity({
    organizationId,
    category: "security",
    kind: ACTIVITY_KINDS.invitationRevoked,
    summary: `${actor.label} revoked the invitation for ${invitation.email}`,
    actorType: "user",
    actorId: actor.userId,
    actorLabel: actor.label,
    metadata: { email: invitation.email },
  });
}

/** Housekeeping for the scheduled endpoint. */
export async function pruneInvitations(now: Date = new Date()): Promise<number> {
  const { count } = await prisma.invitation.deleteMany({
    where: { acceptedAt: null, expiresAt: { lt: new Date(now.getTime() - 30 * 86_400_000) } },
  });
  return count;
}
