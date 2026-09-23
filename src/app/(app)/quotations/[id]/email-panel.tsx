"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { Alert, Field } from "@/components/ui";
import { idleState } from "@/lib/action-state";
import { sendQuotationEmailAction } from "@/server/email-actions";

export function EmailPanel({
  quotationId,
  enabled,
  senderVerified,
  defaultTo,
  isDraft,
  lastSent,
}: {
  quotationId: string;
  enabled: boolean;
  senderVerified: boolean;
  defaultTo: string | null;
  isDraft: boolean;
  lastSent: { toEmail: string; sentAtLabel: string } | null;
}) {
  const [state, action] = useActionState(sendQuotationEmailAction, idleState);
  const errors = state.fieldErrors ?? {};

  if (!enabled) {
    return (
      <div className="px-5 py-4">
        <Alert tone="warning" title="Email is not configured">
          This deployment has no email provider, so QuoteFlow cannot send anything. Copy the share
          link above and send it yourself, or ask your administrator to set{" "}
          <code>EMAIL_PROVIDER</code> and <code>EMAIL_FROM</code>.
        </Alert>
      </div>
    );
  }

  if (!senderVerified) {
    return (
      <div className="px-5 py-4">
        <Alert tone="warning" title="Confirm your email address first">
          QuoteFlow will not email customers from an unconfirmed address. Use the banner at the top
          of the page to send yourself a confirmation link, then come back. The share link above
          works now if you would rather send it yourself.
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-4 px-5 py-4">
      {state.status === "error" && state.message ? (
        <Alert tone="danger">{state.message}</Alert>
      ) : null}
      {state.status === "success" && state.message ? (
        <Alert tone="positive">{state.message}</Alert>
      ) : null}

      {lastSent ? (
        <p className="text-xs text-[var(--color-ink-subtle)]">
          Last emailed to {lastSent.toEmail} on {lastSent.sentAtLabel}.
        </p>
      ) : null}

      <form action={action} className="space-y-4">
        <input type="hidden" name="quotationId" value={quotationId} />

        <Field
          label="Send to"
          htmlFor="to"
          error={errors.to}
          hint={
            defaultTo
              ? undefined
              : "This customer has no email address saved. Type one, or add it on their record."
          }
        >
          <input
            id="to"
            name="to"
            type="email"
            className="input"
            required
            defaultValue={defaultTo ?? ""}
            placeholder="customer@example.com"
          />
        </Field>

        <Field
          label="Add a note"
          htmlFor="message"
          error={errors.message}
          hint="Optional. Replaces the default opening line."
        >
          <textarea
            id="message"
            name="message"
            className="input min-h-24"
            maxLength={2000}
            placeholder="Thanks for the call this morning — here's the quote we discussed."
          />
        </Field>

        <SubmitButton pendingLabel="Sending…">
          {isDraft ? "Send to customer and mark as sent" : "Email to customer"}
        </SubmitButton>

        <p className="text-xs text-[var(--color-ink-subtle)]">
          {isDraft
            ? "The quotation is only marked as sent if the email is actually accepted for delivery."
            : "The email includes the share link, so the customer can accept or decline from it."}
        </p>
      </form>
    </div>
  );
}
