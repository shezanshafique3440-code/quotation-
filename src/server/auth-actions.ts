"use server";

import { redirect } from "next/navigation";
import {
  errorState,
  isFrameworkError,
  toActionState,
  type ActionState,
} from "@/lib/action-state";
import { createSession, destroyCurrentSession, setSessionCookie } from "@/lib/session";
import { fieldErrors, signInSchema, signUpSchema } from "@/lib/validation";
import { authenticate, registerAccount } from "./accounts";

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
    const account = await registerAccount(parsed.data);
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
    const account = await authenticate(parsed.data);
    const { token, expiresAt } = await createSession(account.userId, account.organizationId);
    await setSessionCookie(token, expiresAt);
  } catch (error) {
    if (isFrameworkError(error)) throw error;
    return toActionState(error);
  }

  redirect("/dashboard");
}

export async function signOutAction(): Promise<void> {
  await destroyCurrentSession();
  redirect("/sign-in");
}
