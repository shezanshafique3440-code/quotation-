"use client";

import { useActionState, useId } from "react";
import { ConfirmForm } from "@/components/confirm-form";
import { SubmitButton } from "@/components/submit-button";
import { Alert } from "@/components/ui";
import { idleState, type ActionState } from "@/lib/action-state";
import { resendInvitationAction, revokeInvitationAction } from "@/server/member-actions";

/** Keep the replacement link visible even if delivery fails. */
export function InvitationActions({
  invitationId,
  email,
  emailConfigured,
}: {
  invitationId: string;
  email: string;
  emailConfigured: boolean;
}) {
  const [state, action] = useActionState(async (previous: ActionState, formData: FormData) => {
    const next = await resendInvitationAction(previous, formData);
    // A later rate-limit or validation error must not lose the last usable
    // link or make the revoke button target its already-replaced predecessor.
    return next.data ? next : { ...next, data: previous.data };
  }, idleState);
  const linkId = useId();
  const currentId = typeof state.data?.invitationId === "string"
    ? state.data.invitationId
    : invitationId;
  const link = typeof state.data?.url === "string" ? state.data.url : null;

  return (
    <div className="flex max-w-md flex-col items-end gap-2">
      <form
        action={action}
        onSubmit={(event) => {
          if (!window.confirm("Create a new invitation link? The previous link will stop working.")) {
            event.preventDefault();
          }
        }}
      >
        <input type="hidden" name="invitationId" value={currentId} />
        <SubmitButton variant="secondary" pendingLabel={emailConfigured ? "Sending…" : "Replacing…"}>
          {emailConfigured ? "Re-send" : "Replace link"}
        </SubmitButton>
      </form>
      {state.message ? (
        <Alert tone={state.status === "error" ? "danger" : "positive"}>{state.message}</Alert>
      ) : null}
      {link ? (
        <div className="w-full">
          <label className="text-xs font-medium" htmlFor={linkId}>New invitation link</label>
          <input id={linkId} className="input mt-1 font-mono text-xs" value={link} readOnly />
          <p className="mt-1 text-xs text-[var(--color-ink-subtle)]">
            Copy this link before leaving. It is shown only once.
          </p>
        </div>
      ) : null}
      <ConfirmForm
        action={revokeInvitationAction}
        fields={{ invitationId: currentId }}
        label="Revoke"
        pendingLabel="Revoking…"
        variant="danger"
        confirm={`Revoke the invitation for ${email}? The link stops working immediately.`}
      />
    </div>
  );
}
