"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { Alert, Field } from "@/components/ui";
import { idleState } from "@/lib/action-state";
import { MIN_PASSWORD_LENGTH } from "@/lib/constants";
import { signUpAction } from "@/server/auth-actions";

export function SignUpForm() {
  const [state, action] = useActionState(signUpAction, idleState);
  const errors = state.fieldErrors ?? {};

  return (
    <form action={action} className="space-y-4" noValidate>
      {state.status === "error" && state.message ? (
        <Alert tone="danger">{state.message}</Alert>
      ) : null}

      <Field label="Business name" htmlFor="businessName" error={errors.businessName}>
        <input
          id="businessName"
          name="businessName"
          className="input"
          required
          maxLength={120}
          autoComplete="organization"
          placeholder="Northline Joinery"
        />
      </Field>

      <Field label="Your name" htmlFor="name" error={errors.name}>
        <input
          id="name"
          name="name"
          className="input"
          required
          maxLength={120}
          autoComplete="name"
          placeholder="Sam Rivera"
        />
      </Field>

      <Field label="Work email" htmlFor="email" error={errors.email}>
        <input
          id="email"
          name="email"
          type="email"
          className="input"
          required
          autoComplete="email"
          placeholder="you@business.com"
        />
      </Field>

      <Field
        label="Password"
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

      <SubmitButton className="w-full" pendingLabel="Creating workspace…">
        Create workspace
      </SubmitButton>
    </form>
  );
}
