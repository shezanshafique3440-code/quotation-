"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { Alert } from "@/components/ui";
import { idleState } from "@/lib/action-state";
import { sendVerificationEmailAction } from "@/server/account-actions";

/**
 * Shown until the signed-in user's address is confirmed.
 *
 * It is informational, not a gate: locking someone out of their own workspace
 * because a provider is slow would be worse than the unconfirmed address. The
 * one thing it does gate is emailing customers, which is enforced server-side.
 */
export function VerifyBanner({ email }: { email: string }) {
  const [state, action] = useActionState(sendVerificationEmailAction, idleState);

  return (
    <Alert tone="warning" title="Confirm your email address">
      <p>
        QuoteFlow cannot email quotations from {email} until you confirm it. Check your inbox for
        the link we sent when you signed up.
      </p>
      {state.status !== "idle" && state.message ? (
        <p className="mt-2 font-medium">{state.message}</p>
      ) : null}
      <form action={action} className="mt-3">
        <SubmitButton variant="secondary" pendingLabel="Sending…">
          Send it again
        </SubmitButton>
      </form>
    </Alert>
  );
}
