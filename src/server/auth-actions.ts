"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  errorState,
  isFrameworkError,
  toActionState,
  type ActionState,
} from "@/lib/action-state";
import { ACTIVITY_KINDS, recordActivity } from "@/lib/activity";
import { prisma } from "@/lib/db";
import { enforceRateLimit } from "@/lib/rate-limit";
import { clientIp, clientIpHash, userAgent } from "@/lib/request";
import {
  createSession,
  destroyCurrentSession,
  getSession,
  setSessionCookie,
} from "@/lib/session";
import { issueAuthToken } from "@/lib/auth-tokens";
import { isEmailConfigured } from "@/lib/env";
import { sendVerificationEmail } from "@/lib/notifications";
import { fieldErrors, signInSchema, signUpSchema } from "@/lib/validation";
import { authenticate, registerAccount } from "./accounts";

/**
 * Send the address-verification link, best effort.
 *
 * A provider outage must not block someone from reaching the workspace they
 * just created, so a failure here is logged and the banner in the app offers a
 * re-send. Nothing marks the address verified either way.
 */
async function sendVerificationOnSignUp(account: {
  userId: string;
  organizationId: string;
  email: string;
  name: string;
}): Promise<void> {
  if (!isEmailConfigured()) return;

  try {
    const issued = await issueAuthToken(account.userId, "email_verification");
    const outcome = await sendVerificationEmail({
      organizationId: account.organizationId,
      userId: account.userId,
      to: account.email,
      name: account.name,
      url: issued.url,
      expiresAt: issued.expiresAt,
    });
    if (!outcome.ok) {
      console.warn("[auth] verification email not sent", outcome.error ?? outcome.reason);
    }
  } catch (error) {
    console.error("[auth] verification email failed", error);
  }
}

export async function signUpAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = signUpSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    businessName: formData.get("businessName"),
  });
  if (!parsed.success) {
    return errorState("Please fix the highlighted fields.", fieldErrors(parsed.error));
  }

  try {
    const headerBag = await headers();
    await enforceRateLimit("signUp", clientIp(headerBag));

    const account = await registerAccount(parsed.data);

    await recordActivity({
      organizationId: account.organizationId,
      category: "security",
      kind: ACTIVITY_KINDS.signedUp,
      summary: `${parsed.data.name} created the workspace`,
      actorType: "user",
      actorId: account.userId,
      actorLabel: parsed.data.name,
      ipHash: clientIpHash(headerBag),
      userAgent: userAgent(headerBag),
    });

    await sendVerificationOnSignUp({
      userId: account.userId,
      organizationId: account.organizationId,
      email: parsed.data.email,
      name: parsed.data.name,
    });

    const { token, expiresAt } = await createSession(account.userId, account.organizationId);
    await setSessionCookie(token, expiresAt);
  } catch (error) {
    if (isFrameworkError(error)) throw error;
    return toActionState(error);
  }

  redirect("/dashboard");
}

export async function signInAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return errorState("Please fix the highlighted fields.", fieldErrors(parsed.error));
  }

  try {
    const headerBag = await headers();
    const ip = clientIp(headerBag);

    // Limited by address *and* by account, so neither a single noisy client
    // nor a distributed attempt at one inbox gets unlimited tries.
    await enforceRateLimit("signIn", ip);
    await enforceRateLimit("signIn", `account:${parsed.data.email}`);

    let account;
    try {
      account = await authenticate(parsed.data);
    } catch (error) {
      await recordFailedSignIn(parsed.data.email, headerBag);
      throw error;
    }

    await recordActivity({
      organizationId: account.organizationId,
      category: "security",
      kind: ACTIVITY_KINDS.signedIn,
      summary: `Signed in as ${parsed.data.email}`,
      actorType: "user",
      actorId: account.userId,
      actorLabel: parsed.data.email,
      ipHash: clientIpHash(headerBag),
      userAgent: userAgent(headerBag),
    });

    const { token, expiresAt } = await createSession(account.userId, account.organizationId);
    await setSessionCookie(token, expiresAt);
  } catch (error) {
    if (isFrameworkError(error)) throw error;
    return toActionState(error);
  }

  redirect("/dashboard");
}

/**
 * Record a failed attempt against the workspace it targeted, when that
 * workspace exists. An attempt on an unknown address is intentionally not
 * recorded anywhere — there is no tenant to own the row.
 */
async function recordFailedSignIn(email: string, headerBag: Awaited<ReturnType<typeof headers>>) {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, memberships: { take: 1, select: { organizationId: true } } },
  });
  const organizationId = user?.memberships[0]?.organizationId;
  if (!organizationId) return;

  await recordActivity({
    organizationId,
    category: "security",
    kind: ACTIVITY_KINDS.signInFailed,
    summary: `Failed sign-in attempt for ${email}`,
    actorType: "anonymous",
    actorLabel: email,
    ipHash: clientIpHash(headerBag),
    userAgent: userAgent(headerBag),
  });
}

export async function signOutAction(): Promise<void> {
  const session = await getSession();
  if (session) {
    const headerBag = await headers();
    await recordActivity({
      organizationId: session.organizationId,
      category: "security",
      kind: ACTIVITY_KINDS.signedOut,
      summary: `${session.user.name} signed out`,
      actorType: "user",
      actorId: session.userId,
      actorLabel: session.user.name,
      ipHash: clientIpHash(headerBag),
      userAgent: userAgent(headerBag),
    });
  }

  await destroyCurrentSession();
  redirect("/sign-in");
}
