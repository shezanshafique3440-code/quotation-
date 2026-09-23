"use client";

import Link from "next/link";
import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { Alert, Field } from "@/components/ui";
import { idleState } from "@/lib/action-state";
import { signInAction } from "@/server/auth-actions";

export function SignInForm({ justReset = false }: { justReset?: boolean }) {
  const [state, action] = useActionState(signInAction, idleState);
  const errors = state.fieldErrors ?? {};

  return (
    <form action={action} className="space-y-4" noValidate>
      {justReset && state.status === "idle" ? (
        <Alert tone="positive" title="Password changed">
          Sign in with your new password. Any other devices were signed out.
        </Alert>
      ) : null}
      {state.status === "error" && state.message ? (
        <Alert tone="danger">{state.message}</Alert>
      ) : null}

      <Field label="Work email" htmlFor="email" error={errors.email}>
        <input
          id="email"
          name="email"
          type="email"
          className="input"
          required
          autoComplete="email"
        />
      </Field>

      <Field label="Password" htmlFor="password" error={errors.password}>
        <input
          id="password"
          name="password"
          type="password"
          className="input"
          required
          autoComplete="current-password"
        />
      </Field>

      <SubmitButton className="w-full" pendingLabel="Signing in…">
        Sign in
      </SubmitButton>

      <p className="text-center text-sm">
        <Link
          href="/forgot-password"
          className="text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] hover:underline"
        >
          Forgot your password?
        </Link>
      </p>
    </form>
  );
}
