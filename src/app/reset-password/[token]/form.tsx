"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { Alert, Field } from "@/components/ui";
import { idleState } from "@/lib/action-state";
import { MIN_PASSWORD_LENGTH } from "@/lib/constants";
import { resetPasswordAction } from "@/server/account-actions";

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action] = useActionState(resetPasswordAction, idleState);
  const errors = state.fieldErrors ?? {};

  return (
    <form action={action} className="space-y-4" noValidate>
      {state.status === "error" && state.message ? (
        <Alert tone="danger">{state.message}</Alert>
      ) : null}

      <input type="hidden" name="token" value={token} />

      <Field
        label="New password"
        htmlFor="password"
        error={errors.password}
        hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
      >
        <input
          id="password"
          name="password"
          type="password"
          className="input"
          required
          minLength={MIN_PASSWORD_LENGTH}
          autoComplete="new-password"
        />
      </Field>

      <Field label="Confirm new password" htmlFor="confirmPassword" error={errors.confirmPassword}>
        <input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          className="input"
          required
          minLength={MIN_PASSWORD_LENGTH}
          autoComplete="new-password"
        />
      </Field>

      <SubmitButton className="w-full" pendingLabel="Saving…">
        Set new password
      </SubmitButton>

      <p className="text-xs text-[var(--color-ink-subtle)]">
        Changing it signs you out on every device.
      </p>
    </form>
  );
}
