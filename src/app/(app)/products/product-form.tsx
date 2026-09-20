"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { Alert, Field } from "@/components/ui";
import { idleState, type ActionState } from "@/lib/action-state";

export interface ProductValues {
  id?: string;
  name?: string;
  sku?: string | null;
  description?: string | null;
  unitPrice?: string;
  unit?: string;
  taxRate?: string;
  active?: boolean;
}

export function ProductForm({
  action,
  values = {},
  submitLabel,
  currency,
  resetOnSuccess = false,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  values?: ProductValues;
  submitLabel: string;
  currency: string;
  resetOnSuccess?: boolean;
}) {
  const [state, formAction] = useActionState(action, idleState);
  const errors = state.fieldErrors ?? {};
  const formKey = resetOnSuccess && state.status === "success" ? (state.message ?? "done") : "form";

  return (
    <form action={formAction} className="space-y-4 px-5 py-4" noValidate key={formKey}>
      {state.status === "error" && state.message ? <Alert tone="danger">{state.message}</Alert> : null}
      {state.status === "success" && state.message ? (
        <Alert tone="positive">{state.message}</Alert>
      ) : null}

      {values.id ? <input type="hidden" name="id" value={values.id} /> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor={`name-${values.id ?? "new"}`} error={errors.name}>
          <input
            id={`name-${values.id ?? "new"}`}
            name="name"
            className="input"
            required
            maxLength={160}
            defaultValue={values.name ?? ""}
            placeholder="Fitted oak shelving"
          />
        </Field>
        <Field label="SKU" htmlFor={`sku-${values.id ?? "new"}`} error={errors.sku}>
          <input
            id={`sku-${values.id ?? "new"}`}
            name="sku"
            className="input"
            maxLength={64}
            defaultValue={values.sku ?? ""}
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field
          label={`Unit price (${currency})`}
          htmlFor={`unitPrice-${values.id ?? "new"}`}
          error={errors.unitPriceCents}
        >
          <input
            id={`unitPrice-${values.id ?? "new"}`}
            name="unitPrice"
            className="input tabular-nums"
            required
            inputMode="decimal"
            defaultValue={values.unitPrice ?? ""}
            placeholder="250.00"
          />
        </Field>
        <Field label="Unit" htmlFor={`unit-${values.id ?? "new"}`} error={errors.unit}>
          <input
            id={`unit-${values.id ?? "new"}`}
            name="unit"
            className="input"
            maxLength={24}
            defaultValue={values.unit ?? "unit"}
            placeholder="hour, m², unit"
          />
        </Field>
        <Field label="Tax rate (%)" htmlFor={`taxRate-${values.id ?? "new"}`} error={errors.taxRateBp}>
          <input
            id={`taxRate-${values.id ?? "new"}`}
            name="taxRate"
            className="input tabular-nums"
            inputMode="decimal"
            defaultValue={values.taxRate ?? "0"}
          />
        </Field>
      </div>

      <Field label="Description" htmlFor={`description-${values.id ?? "new"}`} error={errors.description}>
        <textarea
          id={`description-${values.id ?? "new"}`}
          name="description"
          className="input min-h-20"
          maxLength={2000}
          defaultValue={values.description ?? ""}
          placeholder="What the AI should know when it picks this line."
        />
      </Field>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="active"
          defaultChecked={values.active ?? true}
          className="size-4 rounded border-[var(--color-line)]"
        />
        Active — offer this in new quotations and to the AI drafter
      </label>

      <SubmitButton pendingLabel="Saving…">{submitLabel}</SubmitButton>
    </form>
  );
}
