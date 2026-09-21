"use client";

import { useActionState } from "react";
import { CopyField } from "@/components/copy-field";
import { SubmitButton } from "@/components/submit-button";
import { Alert } from "@/components/ui";
import { idleState } from "@/lib/action-state";
import { Field } from "@/components/ui";
import { sendPortalLinkEmailAction } from "@/server/email-actions";
import { issuePortalLinkAction, revokePortalLinkAction } from "@/server/portal-actions";

export function PortalPanel({
  customerId,
  hasActiveLink,
  expiresLabel,
  emailEnabled,
  customerEmail,
}: {
  customerId: string;
  hasActiveLink: boolean;
  expiresLabel: string | null;
  emailEnabled: boolean;
  customerEmail: string | null;
}) {
  const [issueState, issue] = useActionState(issuePortalLinkAction, idleState);
  const [revokeState, revoke] = useActionState(revokePortalLinkAction, idleState);
  const [emailState, sendEmail] = useActionState(sendPortalLinkEmailAction, idleState);

  // Either path mints a link, so both count as "there is one now".
  const url =
    (issueState.data?.url as string | undefined) ?? (emailState.data?.url as string | undefined);

  // The server is the source of truth on load; after an action succeeds, its
  // result is. Deriving this rather than re-rendering the page keeps the
  // issued link — which exists nowhere else — on screen.
  const active =
    revokeState.status === "success"
      ? false
      : issueState.status === "success" || emailState.status === "success" || url
        ? true
        : hasActiveLink;

  return (
    <div className="space-y-4 px-5 py-4">
      {issueState.status === "error" && issueState.message ? (
        <Alert tone="danger">{issueState.message}</Alert>
      ) : null}
      {revokeState.status !== "idle" && revokeState.message ? (
        <Alert tone={revokeState.status === "error" ? "danger" : "positive"}>
          {revokeState.message}
        </Alert>
      ) : null}
      {emailState.status !== "idle" && emailState.message ? (
        <Alert tone={emailState.status === "error" ? "danger" : "positive"}>
          {emailState.message}
        </Alert>
      ) : null}

      {url ? (
        <div className="space-y-2">
          <Alert tone="positive" title="Link created">
            {issueState.message}
          </Alert>
          <CopyField
            value={url}
            label="Customer portal link"
            helpText="Send this to your customer. It lists every quotation you have sent them."
          />
        </div>
      ) : (
        <p className="text-sm text-[var(--color-ink-muted)]">
          {active
            ? `This customer has an active portal link${expiresLabel ? `, valid until ${expiresLabel}` : ""}. For security the link itself is not stored, so it cannot be shown again — create a new one if it was lost.`
            : "Give this customer one page listing every quotation you have sent them, with no password to remember."}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <form action={issue}>
          <input type="hidden" name="customerId" value={customerId} />
          <SubmitButton variant="secondary" pendingLabel="Creating…">
            {active ? "Create a new link" : "Create portal link"}
          </SubmitButton>
        </form>

        {active ? (
          <form action={revoke}>
            <input type="hidden" name="customerId" value={customerId} />
            <SubmitButton variant="danger" pendingLabel="Revoking…">
              Revoke access
            </SubmitButton>
          </form>
        ) : null}
      </div>

      {active ? (
        <p className="text-xs text-[var(--color-ink-subtle)]">
          Creating a new link revokes the previous one immediately.
        </p>
      ) : null}

      {emailEnabled ? (
        <form action={sendEmail} className="space-y-3 border-t border-[var(--color-line)] pt-4">
          <input type="hidden" name="customerId" value={customerId} />
          <Field
            label="Or email the link straight to them"
            htmlFor="portal-to"
            error={emailState.fieldErrors?.to}
            hint={
              customerEmail
                ? "Creates a fresh link and sends it. The previous link stops working."
                : "This customer has no email address saved."
            }
          >
            <input
              id="portal-to"
              name="to"
              type="email"
              className="input"
              required
              defaultValue={customerEmail ?? ""}
              placeholder="customer@example.com"
            />
          </Field>
          <SubmitButton variant="secondary" pendingLabel="Sending…">
            Create and email the link
          </SubmitButton>
        </form>
      ) : null}
    </div>
  );
}
