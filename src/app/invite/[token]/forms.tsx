"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { Alert, Field } from "@/components/ui";
import { idleState } from "@/lib/action-state";
import { MIN_PASSWORD_LENGTH } from "@/lib/constants";
import {
  acceptInvitationAction,
  acceptInvitationAsNewUserAction,
} from "@/server/member-actions";

/** For someone who already has a QuoteFlow account and is signed in as it. */
export function AcceptInvitationForm({
  token,
  workspaceName,
}: {
  token: string;
  workspaceName: string;
}) {
  const [state, action] = useActionState(acceptInvitationAction, idleState);

  return (
    <form action={action} className="space-y-4">
      {state.status === "error" && state.message ? (
        <Alert tone="danger">{state.message}</Alert>
      ) : null}

      <input type="hidden" name="token" value={token} />

      <SubmitButton className="w-full" pendingLabel="Joining…">
        Join {workspaceName}
      </SubmitButton>
    </form>
  );
}

/** For an address that has no account yet: create one and join in one step. */
export function CreateAccountAndJoinForm({
  token,
  email,
}: {
  token: string;
  email: string;
}) {
  const [state, action] = useActionState(acceptInvitationAsNewUserAction, idleState);
  const errors = state.fieldErrors ?? {};

  return (
    <form action={action} className="space-y-4" noValidate>
      {state.status === "error" && state.message ? (
        <Alert tone="danger">{state.message}</Alert>
      ) : null}

      <input type="hidden" name="token" value={token} />

      <Field label="Email" htmlFor="invited-email" hint="Set by the invitation.">
        <input id="invited-email" className="input" value={email} readOnly disabled />
      </Field>

      <Field label="Your name" htmlFor="name" error={errors.name}>
        <input
          id="name"
          name="name"
          className="input"
          required
          maxLength={120}
          autoComplete="name"
          placeholder="Alex Moreau"
        />
      </Field>

      <Field
        label="Choose a password"
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

      <SubmitButton className="w-full" pendingLabel="Creating your account…">
        Create account and join
      </SubmitButton>
    </form>
  );
}
