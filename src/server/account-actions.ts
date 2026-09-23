"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  errorState,
  isFrameworkError,
  successState,
  toActionState,
  type ActionState,
} from "@/lib/action-state";
import { ACTIVITY_KINDS, recordActivity } from "@/lib/activity";
import { consumeAuthToken, issueAuthToken } from "@/lib/auth-tokens";
import { prisma } from "@/lib/db";
import { isEmailConfigured } from "@/lib/env";
import { NotConfiguredError } from "@/lib/errors";
import { sendPasswordResetEmail, sendVerificationEmail } from "@/lib/notifications";
import { enforceRateLimit } from "@/lib/rate-limit";
import { clientIp, clientIpHash, userAgent } from "@/lib/request";
import { getSession } from "@/lib/session";
import { fieldErrors, forgotPasswordSchema, resetPasswordSchema } from "@/lib/validation";
import { applyPasswordReset } from "./accounts";

/**
 * The same answer for every address.
 *
 * Saying "no account with that email" would turn this form into a way to test
 * which addresses are registered, so the reply never varies — and it describes
 * only what it can promise.
 */
const NEUTRAL_RESET_REPLY =
  "If that address has an account, a reset link is on its way. It is valid for one hour.";

export async function requestPasswordResetAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    if (!isEmailConfigured()) {
      throw new NotConfiguredError(
        "This deployment cannot send email, so passwords cannot be reset from here. Contact your administrator.",
      );
    }

    const parsed = forgotPasswordSchema.safeParse({ email: formData.get("email") });
    if (!parsed.success) {
      return errorState("Please fix the highlighted fields.", fieldErrors(parsed.error));
    }

    const headerBag = await headers();
    await enforceRateLimit("passwordReset", clientIp(headerBag));
    await enforceRateLimit("passwordReset", `account:${parsed.data.email}`);

    const user = await prisma.user.findUnique({
      where: { email: parsed.data.email },
      select: {
        id: true,
        name: true,
        email: true,
        memberships: { orderBy: { createdAt: "asc" }, take: 1, select: { organizationId: true } },
      },
    });

    const organizationId = user?.memberships[0]?.organizationId;
    if (!user || !organizationId) return successState(NEUTRAL_RESET_REPLY);

    const ipHash = clientIpHash(headerBag);
    const issued = await issueAuthToken(user.id, "password_reset", { ipHash });

    const outcome = await sendPasswordResetEmail({
      organizationId,
      userId: user.id,
      to: user.email,
      name: user.name,
      url: issued.url,
      expiresAt: issued.expiresAt,
    });

    await recordActivity({
      organizationId,
      category: "security",
      kind: ACTIVITY_KINDS.passwordResetRequested,
      summary: outcome.ok
        ? `Password reset link sent to ${user.email}`
        : `Password reset link for ${user.email} could not be sent`,
      actorType: "anonymous",
      actorLabel: user.email,
      ipHash,
      userAgent: userAgent(headerBag),
      metadata: outcome.ok ? null : { error: outcome.error ?? outcome.reason },
    });

    // A send failure is the one case worth breaking neutrality for: the
    // address is already known to exist, and silently promising an email that
    // was rejected would leave the person waiting for nothing.
    if (!outcome.ok) {
      return errorState(
        `The reset email could not be sent: ${outcome.error ?? outcome.reason ?? "unknown error"}`,
      );
    }

    return successState(NEUTRAL_RESET_REPLY);
  } catch (error) {
    if (isFrameworkError(error)) throw error;
    return toActionState(error);
  }
}

/**
 * Set a new password from a reset link.
 *
 * Every session is destroyed on success. If the link was used by someone who
 * should not have it, the legitimate owner is signed out and knows something
 * happened; if it was the owner, signing in again is a small price.
 */
export async function resetPasswordAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let signedIn = false;

  try {
    const parsed = resetPasswordSchema.safeParse({
      token: formData.get("token"),
      password: formData.get("password"),
      confirmPassword: formData.get("confirmPassword"),
    });
    if (!parsed.success) {
      return errorState("Please fix the highlighted fields.", fieldErrors(parsed.error));
    }

    const headerBag = await headers();
    await enforceRateLimit("passwordReset", clientIp(headerBag));

    const applied = await applyPasswordReset(parsed.data.token, parsed.data.password);
    if (!applied) {
      return errorState(
        "That reset link is no longer valid — it may have expired or already been used. Request a new one.",
      );
    }

    if (applied.organizationId) {
      await recordActivity({
        organizationId: applied.organizationId,
        category: "security",
        kind: ACTIVITY_KINDS.passwordReset,
        summary: `${applied.name} reset their password`,
        actorType: "user",
        actorId: applied.userId,
        actorLabel: applied.name,
        ipHash: clientIpHash(headerBag),
        userAgent: userAgent(headerBag),
        metadata: { sessionsEnded: applied.sessionsEnded },
      });
    }

    signedIn = true;
  } catch (error) {
    if (isFrameworkError(error)) throw error;
    return toActionState(error);
  }

  if (signedIn) redirect("/sign-in?reset=1");
  return errorState("The password could not be changed.");
}

/**
 * Send (or re-send) the address-verification link for the signed-in user.
 *
 * Returns rather than throws when there is nothing to do, so the banner can
 * say what actually happened instead of showing an error for a no-op.
 */
export async function sendVerificationEmailAction(
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  try {
    const session = await getSession();
    if (!session) return errorState("Sign in first.");

    if (!isEmailConfigured()) {
      throw new NotConfiguredError(
        "This deployment cannot send email, so addresses cannot be verified here.",
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { id: true, name: true, email: true, emailVerifiedAt: true },
    });
    if (!user) return errorState("Account not found.");
    if (user.emailVerifiedAt) return successState("That address is already confirmed.");

    const headerBag = await headers();
    await enforceRateLimit("emailVerification", `user:${user.id}`);

    const issued = await issueAuthToken(user.id, "email_verification", {
      ipHash: clientIpHash(headerBag),
    });

    const outcome = await sendVerificationEmail({
      organizationId: session.organizationId,
      userId: user.id,
      to: user.email,
      name: user.name,
      url: issued.url,
      expiresAt: issued.expiresAt,
    });

    await recordActivity({
      organizationId: session.organizationId,
      category: "security",
      kind: ACTIVITY_KINDS.emailVerificationSent,
      summary: outcome.ok
        ? `Verification link sent to ${user.email}`
        : `Verification link for ${user.email} could not be sent`,
      actorType: "user",
      actorId: user.id,
      actorLabel: user.name,
      ipHash: clientIpHash(headerBag),
      userAgent: userAgent(headerBag),
    });

    if (!outcome.ok) {
      return errorState(
        outcome.error ?? outcome.reason ?? "The verification email could not be sent.",
      );
    }

    return successState(`Confirmation link sent to ${user.email}. Check your inbox.`);
  } catch (error) {
    if (isFrameworkError(error)) throw error;
    return toActionState(error);
  }
}

/**
 * Confirm an address from a verification link.
 *
 * Deliberately a button rather than a bare GET: mail scanners and link
 * prefetchers follow URLs in messages, and a scanner "confirming" an address
 * would make the verified flag mean nothing. A click is the proof.
 */
export async function confirmEmailAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const token = String(formData.get("token") ?? "");
    if (!token) return errorState("That confirmation link is not valid.");

    const headerBag = await headers();
    await enforceRateLimit("emailVerification", clientIp(headerBag));

    const consumed = await consumeAuthToken(token, "email_verification");
    if (!consumed) {
      return errorState(
        "That confirmation link is no longer valid — it may have expired or already been used. Sign in and ask for a new one.",
      );
    }

    // Re-confirming is harmless but must not move the timestamp: the first
    // proof is the one worth recording.
    if (!consumed.user.emailVerifiedAt) {
      await prisma.user.update({
        where: { id: consumed.userId },
        data: { emailVerifiedAt: new Date() },
      });

      const membership = await prisma.membership.findFirst({
        where: { userId: consumed.userId },
        orderBy: { createdAt: "asc" },
        select: { organizationId: true },
      });

      if (membership) {
        await recordActivity({
          organizationId: membership.organizationId,
          category: "security",
          kind: ACTIVITY_KINDS.emailVerified,
          summary: `${consumed.user.name} confirmed ${consumed.user.email}`,
          actorType: "user",
          actorId: consumed.userId,
          actorLabel: consumed.user.name,
          ipHash: clientIpHash(headerBag),
          userAgent: userAgent(headerBag),
        });
      }
    }

    return successState(`${consumed.user.email} is confirmed.`);
  } catch (error) {
    if (isFrameworkError(error)) throw error;
    return toActionState(error);
  }
}
