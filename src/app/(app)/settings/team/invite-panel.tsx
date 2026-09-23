"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { Alert, Field } from "@/components/ui";
import { idleState } from "@/lib/action-state";
import { INVITABLE_ROLES, ROLE_DESCRIPTIONS, ROLE_LABELS } from "@/lib/roles";
import { inviteMemberAction } from "@/server/member-actions";

export function InvitePanel({
  emailConfigured,
  seatsLeft,
}: {
  emailConfigured: boolean;
  seatsLeft: number | null;
}) {
  const [state, action] = useActionState(inviteMemberAction, idleState);
  const errors = state.fieldErrors ?? {};
  const link = typeof state.data?.url === "string" ? state.data.url : null;

  return (
    <div className="space-y-4 px-5 py-4">
      {state.status === "error" && state.message ? (
        <Alert tone="danger">{state.message}</Alert>
      ) : null}
      {state.status === "success" && state.message ? (
        <Alert tone="positive">{state.message}</Alert>
      ) : null}

      {link ? (
        <div>
          <label className="text-xs font-medium text-[var(--color-ink-muted)]" htmlFor="invite-url">
            Invitation link
          </label>
          <input id="invite-url" className="input mt-1 font-mono text-xs" value={link} readOnly />
          <p className="mt-1 text-xs text-[var(--color-ink-subtle)]">
            Shown once. Only a hash of it is stored, so it cannot be displayed again — re-send the
            invitation if it is lost.
          </p>
        </div>
      ) : null}

      {!emailConfigured ? (
        <Alert tone="warning" title="Email is not configured">
          Invitations are still created, but nothing is sent. You will get a link to pass on
          yourself.
        </Alert>
      ) : null}

      <form action={action} className="space-y-4" noValidate>
        <Field label="Email address" htmlFor="invite-email" error={errors.email}>
          <input
            id="invite-email"
            name="email"
            type="email"
            className="input"
            required
            placeholder="teammate@yourbusiness.com"
          />
        </Field>

        <Field
          label="Role"
          htmlFor="invite-role"
          error={errors.role}
          hint={ROLE_DESCRIPTIONS.member}
        >
          <select id="invite-role" name="role" className="input" defaultValue="member">
            {INVITABLE_ROLES.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role]}
              </option>
            ))}
          </select>
        </Field>

        <SubmitButton pendingLabel="Inviting…">Send invitation</SubmitButton>

        {seatsLeft !== null ? (
          <p className="text-xs text-[var(--color-ink-subtle)]">
            {seatsLeft > 0
              ? `${seatsLeft} ${seatsLeft === 1 ? "seat" : "seats"} left on your plan.`
              : "Your plan has no seat left. Upgrade to add teammates."}
          </p>
        ) : null}
      </form>
    </div>
  );
}
