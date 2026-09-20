"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { Alert, Field } from "@/components/ui";
import { idleState } from "@/lib/action-state";
import { signInAction } from "@/server/auth-actions";

export function SignInForm() {
  const [state, action] = useActionState(signInAction, idleState);
  const errors = state.fieldErrors ?? {};

  return (
    <form action={action} className="space-y-4" noValidate>
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
    </form>
  );
}
