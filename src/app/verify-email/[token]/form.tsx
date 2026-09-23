"use client";

import { useActionState } from "react";
import Link from "next/link";
import { SubmitButton } from "@/components/submit-button";
import { Alert } from "@/components/ui";
import { idleState } from "@/lib/action-state";
import { confirmEmailAction } from "@/server/account-actions";

export function ConfirmEmailForm({ token, email }: { token: string; email: string }) {
  const [state, action] = useActionState(confirmEmailAction, idleState);

  if (state.status === "success") {
    return (
      <div className="space-y-4">
        <Alert tone="positive" title="Address confirmed">
          {state.message}
        </Alert>
        <Link href="/dashboard" className="btn btn-primary w-full">
          Go to your dashboard
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4">
      {state.status === "error" && state.message ? (
        <Alert tone="danger">{state.message}</Alert>
      ) : null}

      <input type="hidden" name="token" value={token} />

      <p className="text-sm text-[var(--color-ink-muted)]">
        Confirm that <span className="font-medium text-[var(--color-ink)]">{email}</span> is yours.
      </p>

      <SubmitButton className="w-full" pendingLabel="Confirming…">
        Confirm my address
      </SubmitButton>
    </form>
  );
}
