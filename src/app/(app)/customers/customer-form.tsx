"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { Alert, Field } from "@/components/ui";
import { idleState, type ActionState } from "@/lib/action-state";

export interface CustomerValues {
  id?: string;
  name?: string;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  notes?: string | null;
}

export function CustomerForm({
  action,
  values = {},
  submitLabel,
  resetOnSuccess = false,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  values?: CustomerValues;
  submitLabel: string;
  resetOnSuccess?: boolean;
}) {
  const [state, formAction] = useActionState(action, idleState);
  const errors = state.fieldErrors ?? {};
  // Remounting the fields is what clears them after a successful create.
  const formKey = resetOnSuccess && state.status === "success" ? (state.message ?? "done") : "form";

  return (
    <form action={formAction} className="space-y-4 px-5 py-4" noValidate key={formKey}>
      {state.status === "error" && state.message ? <Alert tone="danger">{state.message}</Alert> : null}
      {state.status === "success" && state.message ? (
        <Alert tone="positive">{state.message}</Alert>
      ) : null}

      {values.id ? <input type="hidden" name="id" value={values.id} /> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor="name" error={errors.name}>
          <input
            id="name"
            name="name"
            className="input"
            required
            maxLength={120}
            defaultValue={values.name ?? ""}
            placeholder="Dana Whitfield"
          />
        </Field>
        <Field label="Company" htmlFor="company" error={errors.company}>
          <input
            id="company"
            name="company"
            className="input"
            maxLength={120}
            defaultValue={values.company ?? ""}
            placeholder="Whitfield Interiors"
          />
        </Field>
        <Field label="Email" htmlFor="email" error={errors.email}>
          <input
            id="email"
            name="email"
            type="email"
            className="input"
            defaultValue={values.email ?? ""}
          />
        </Field>
        <Field label="Phone" htmlFor="phone" error={errors.phone}>
          <input id="phone" name="phone" className="input" defaultValue={values.phone ?? ""} />
        </Field>
        <Field
          label="WhatsApp number"
          htmlFor="whatsapp"
          error={errors.whatsapp}
          hint="Include the country code — this is what the click-to-chat link uses."
        >
          <input
            id="whatsapp"
            name="whatsapp"
            className="input"
            defaultValue={values.whatsapp ?? ""}
            placeholder="+15551234567"
          />
        </Field>
      </div>

      <Field label="Notes" htmlFor="notes" error={errors.notes}>
        <textarea
          id="notes"
          name="notes"
          className="input min-h-20"
          maxLength={2000}
          defaultValue={values.notes ?? ""}
        />
      </Field>

      <SubmitButton pendingLabel="Saving…">{submitLabel}</SubmitButton>
    </form>
  );
}
