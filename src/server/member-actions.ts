"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  errorState,
  isFrameworkError,
  successState,
  toActionState,
  type ActionState,
} from "@/lib/action-state";
import { prisma } from "@/lib/db";
import { isEmailConfigured } from "@/lib/env";
import { AppError, NotConfiguredError } from "@/lib/errors";
import { text } from "@/lib/form";
import {
  acceptInvitation,
  createInvitation,
  invitationUrl,
  resolveInvitation,
  revokeInvitation,
} from "@/lib/invitations";
import { changeMemberRole, removeMember } from "@/lib/members";
import { sendInvitationEmail } from "@/lib/notifications";
import { hashPassword } from "@/lib/password";
import { enforceRateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request";
import { can, ROLE_DESCRIPTIONS, ROLE_LABELS, type Role } from "@/lib/roles";
import { createSession, requireSession, setSessionCookie } from "@/lib/session";
import {
  acceptInvitationSchema,
  fieldErrors,
  invitationRefSchema,
  inviteMemberSchema,
  memberRoleSchema,
  membershipRefSchema,
} from "@/lib/validation";

const TEAM_PATH = "/settings/team";

async function requireMemberManager() {
  const session = await requireSession();
  if (!can(session.role, "members:manage")) {
    throw new AppError("Only an owner or admin can manage teammates.", { status: 403 });
  }
  return session;
}

/**
 * Invite someone to the workspace.
 *
 * The invitation row is created first because it is the thing being sent; if
 * the email then fails, the link is still valid and the reply hands it over so
 * the inviter can pass it on themselves rather than losing the seat.
 */
export async function inviteMemberAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const session = await requireMemberManager();

    const parsed = inviteMemberSchema.safeParse({
      email: text(formData, "email"),
      role: text(formData, "role"),
    });
    if (!parsed.success) {
      return errorState("Please fix the highlighted fields.", fieldErrors(parsed.error));
    }

    if (parsed.data.email === session.user.email.toLowerCase()) {
      return errorState("That is your own address — you are already here.");
    }

    await enforceRateLimit("invite", `org:${session.organizationId}`);

    const invitation = await createInvitation({
      organizationId: session.organizationId,
      plan: session.organization.plan,
      email: parsed.data.email,
      role: parsed.data.role,
      actor: { userId: session.userId, label: session.user.name },
    });

    revalidatePath(TEAM_PATH);

    if (!isEmailConfigured()) {
      return successState(
        `Invitation created for ${invitation.email}. This deployment cannot send email, so copy the link below and pass it on yourself.`,
        { url: invitation.url, email: invitation.email },
      );
    }

    const existing = await prisma.user.findUnique({
      where: { email: invitation.email },
      select: { id: true },
    });

    const role = invitation.role as Role;
    const outcome = await sendInvitationEmail({
      organizationId: session.organizationId,
      organizationName: session.organization.name,
      to: invitation.email,
      invitedByName: session.user.name,
      roleLabel: ROLE_LABELS[role],
      roleDescription: ROLE_DESCRIPTIONS[role],
      inviteUrl: invitation.url,
      expiresAt: invitation.expiresAt,
      hasAccount: Boolean(existing),
    });

    if (!outcome.ok) {
      return errorState(
        `${outcome.error ?? outcome.reason ?? "The invitation email could not be sent."} The invitation itself is valid — copy the link below and send it yourself.`,
      );
    }

    return successState(`Invitation emailed to ${invitation.email}.`, {
      url: invitation.url,
      email: invitation.email,
    });
  } catch (error) {
    if (isFrameworkError(error)) throw error;
    return toActionState(error);
  }
}

export async function revokeInvitationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const session = await requireMemberManager();

    const parsed = invitationRefSchema.safeParse({
      invitationId: text(formData, "invitationId"),
    });
    if (!parsed.success) return errorState("That invitation could not be found.");

    await revokeInvitation(session.organizationId, parsed.data.invitationId, {
      userId: session.userId,
      label: session.user.name,
    });

    revalidatePath(TEAM_PATH);
  } catch (error) {
    if (isFrameworkError(error)) throw error;
    return toActionState(error);
  }

  // Same reason as removal: the pending row disappears with the form.
  redirect(`${TEAM_PATH}?revoked=1`);
}

export async function removeMemberAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let removed: string;

  try {
    const session = await requireMemberManager();

    const parsed = membershipRefSchema.safeParse({
      membershipId: text(formData, "membershipId"),
    });
    if (!parsed.success) return errorState("That person could not be found.");

    const result = await removeMember(
      {
        organizationId: session.organizationId,
        actorUserId: session.userId,
        actorRole: session.role,
        actorLabel: session.user.name,
      },
      parsed.data.membershipId,
    );

    revalidatePath(TEAM_PATH);
    removed = result.removedEmail;
  } catch (error) {
    if (isFrameworkError(error)) throw error;
    return toActionState(error);
  }

  // The row that was showing this form has just gone, taking any inline
  // message with it, so the confirmation is carried on the URL instead.
  redirect(`${TEAM_PATH}?removed=${encodeURIComponent(removed)}`);
}

export async function changeMemberRoleAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const session = await requireMemberManager();

    const parsed = memberRoleSchema.safeParse({
      membershipId: text(formData, "membershipId"),
      role: text(formData, "role"),
    });
    if (!parsed.success) {
      return errorState("Please fix the highlighted fields.", fieldErrors(parsed.error));
    }

    const { email, role } = await changeMemberRole(
      {
        organizationId: session.organizationId,
        actorUserId: session.userId,
        actorRole: session.role,
        actorLabel: session.user.name,
      },
      parsed.data.membershipId,
      parsed.data.role,
    );

    revalidatePath(TEAM_PATH);
    return successState(`${email} is now ${ROLE_LABELS[role]}.`);
  } catch (error) {
    if (isFrameworkError(error)) throw error;
    return toActionState(error);
  }
}

/**
 * Accept an invitation as the signed-in user.
 *
 * The address must match: an invitation is to a person, not to whoever happens
 * to hold the link.
 */
export async function acceptInvitationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let joined: { organizationId: string; userId: string } | null = null;

  try {
    const session = await requireSession();
    const token = text(formData, "token") ?? "";

    const accepted = await acceptInvitation(token, session.userId);
    joined = { organizationId: accepted.organizationId, userId: accepted.userId };
  } catch (error) {
    if (isFrameworkError(error)) throw error;
    return toActionState(error);
  }

  if (joined) {
    // Switch the active workspace to the one just joined, so the redirect
    // lands where the person expects rather than in their old workspace.
    const { token: sessionToken, expiresAt } = await createSession(
      joined.userId,
      joined.organizationId,
    );
    await setSessionCookie(sessionToken, expiresAt);
    redirect("/dashboard");
  }

  return errorState("The invitation could not be accepted.");
}

/**
 * Accept an invitation by creating the account it was sent to.
 *
 * No workspace is created here — that is the whole point. The new user joins
 * the inviting workspace and nothing else, and the address is treated as
 * verified because following the emailed link is itself the proof.
 */
export async function acceptInvitationAsNewUserAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let joined: { organizationId: string; userId: string } | null = null;

  try {
    const parsed = acceptInvitationSchema.safeParse({
      token: text(formData, "token"),
      name: text(formData, "name"),
      password: text(formData, "password"),
    });
    if (!parsed.success) {
      return errorState("Please fix the highlighted fields.", fieldErrors(parsed.error));
    }

    const headerBag = await headers();
    await enforceRateLimit("signUp", clientIp(headerBag));

    const invitation = await resolveInvitation(parsed.data.token);
    if (!invitation) {
      return errorState("That invitation is no longer valid. Ask for a new one.");
    }
    if (invitation.existingUserId) {
      return errorState("That address already has an account. Sign in to accept the invitation.");
    }

    const passwordHash = await hashPassword(parsed.data.password);
    const user = await prisma.user.create({
      data: {
        email: invitation.email,
        name: parsed.data.name,
        passwordHash,
        // Following the emailed link proves the address.
        emailVerifiedAt: new Date(),
      },
      select: { id: true },
    });

    const accepted = await acceptInvitation(parsed.data.token, user.id);
    joined = { organizationId: accepted.organizationId, userId: user.id };
  } catch (error) {
    if (isFrameworkError(error)) throw error;
    return toActionState(error);
  }

  if (joined) {
    const { token: sessionToken, expiresAt } = await createSession(
      joined.userId,
      joined.organizationId,
    );
    await setSessionCookie(sessionToken, expiresAt);
    redirect("/dashboard");
  }

  return errorState("The invitation could not be accepted.");
}

/** Re-send an invitation email without minting a new link. */
export async function resendInvitationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const session = await requireMemberManager();

    if (!isEmailConfigured()) {
      throw new NotConfiguredError(
        "This deployment cannot send email. Copy the invitation link instead.",
      );
    }

    const parsed = invitationRefSchema.safeParse({
      invitationId: text(formData, "invitationId"),
    });
    if (!parsed.success) return errorState("That invitation could not be found.");

    // Only the HMAC of the token is stored, so an existing link cannot be
    // read back. Re-sending therefore means replacing it — which is said
    // plainly rather than implying the old link still works.
    const existing = await prisma.invitation.findFirst({
      where: {
        id: parsed.data.invitationId,
        organizationId: session.organizationId,
        acceptedAt: null,
        revokedAt: null,
      },
      select: { id: true, email: true, role: true },
    });
    if (!existing) return errorState("That invitation is no longer pending.");

    await enforceRateLimit("invite", `org:${session.organizationId}`);

    await revokeInvitation(session.organizationId, existing.id, {
      userId: session.userId,
      label: session.user.name,
    });

    const invitation = await createInvitation({
      organizationId: session.organizationId,
      plan: session.organization.plan,
      email: existing.email,
      role: existing.role === "admin" ? "admin" : "member",
      actor: { userId: session.userId, label: session.user.name },
    });

    const hasAccount = Boolean(
      await prisma.user.findUnique({ where: { email: invitation.email }, select: { id: true } }),
    );

    const role = invitation.role as Role;
    const outcome = await sendInvitationEmail({
      organizationId: session.organizationId,
      organizationName: session.organization.name,
      to: invitation.email,
      invitedByName: session.user.name,
      roleLabel: ROLE_LABELS[role],
      roleDescription: ROLE_DESCRIPTIONS[role],
      inviteUrl: invitationUrl(invitation.token),
      expiresAt: invitation.expiresAt,
      hasAccount,
    });

    revalidatePath(TEAM_PATH);

    if (!outcome.ok) {
      return errorState(
        `${outcome.error ?? outcome.reason ?? "The invitation could not be sent."} A fresh link was created — copy it below and send it yourself.`,
      );
    }

    return successState(
      `A new invitation was emailed to ${invitation.email}. The previous link no longer works.`,
      { url: invitation.url, email: invitation.email },
    );
  } catch (error) {
    if (isFrameworkError(error)) throw error;
    return toActionState(error);
  }
}
