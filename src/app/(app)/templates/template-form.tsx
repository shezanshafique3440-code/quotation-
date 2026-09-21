"use client";

import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { Alert, Field } from "@/components/ui";
import { idleState, type ActionState } from "@/lib/action-state";
import { CURRENCIES } from "@/lib/currency";

export interface TemplateLine {
  key: string;
  productId: string;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  taxRate: string;
}

export interface TemplateProduct {
  id: string;
  name: string;
  description: string | null;
  unit: string;
  unitPriceCents: number;
  taxRateBp: number;
}

export interface TemplateValues {
  id?: string;
  name?: string;
  description?: string | null;
  titlePattern?: string | null;
  notes?: string | null;
  terms?: string | null;
  currency?: string | null;
  validityDays?: string;
  requireSignature?: boolean;
  isDefault?: boolean;
  lines?: Omit<TemplateLine, "key">[];
}

let seed = 0;
const nextKey = () => `tline-${(seed += 1)}`;

function blankLine(taxRate: string): TemplateLine {
  return {
    key: nextKey(),
    productId: "",
    description: "",
    quantity: "1",
    unit: "unit",
    unitPrice: "",
    taxRate,
  };
}

export function TemplateForm({
  action,
  products,
  values = {},
  defaultTaxRateBp,
  defaultValidityDays,
  submitLabel,
  resetOnSuccess = false,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  products: TemplateProduct[];
  values?: TemplateValues;
  defaultTaxRateBp: number;
  defaultValidityDays: number;
  submitLabel: string;
  resetOnSuccess?: boolean;
}) {
  const defaultTaxRate = String(defaultTaxRateBp / 100);
  const [state, formAction] = useActionState(action, idleState);
  const [lines, setLines] = useState<TemplateLine[]>(() =>
    (values.lines ?? []).length > 0
      ? values.lines!.map((line) => ({ ...line, key: nextKey() }))
      : [blankLine(defaultTaxRate)],
  );

  const errors = state.fieldErrors ?? {};
  const suffix = values.id ?? "new";
  const resetKey = resetOnSuccess && state.status === "success" ? (state.message ?? "done") : "form";

  const update = (key: string, patch: Partial<TemplateLine>) =>
    setLines((current) => current.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const applyProduct = (key: string, productId: string) => {
    const product = products.find((p) => p.id === productId);
    if (!product) {
      update(key, { productId: "" });
      return;
    }
    update(key, {
      productId,
      description: product.description?.trim() || product.name,
      unit: product.unit,
      unitPrice: (product.unitPriceCents / 100).toFixed(2),
      taxRate: String(product.taxRateBp / 100),
    });
  };

  return (
    <form action={formAction} className="space-y-5 px-5 py-4" noValidate key={resetKey}>
      {state.status === "error" && state.message ? <Alert tone="danger">{state.message}</Alert> : null}
      {state.status === "success" && state.message ? (
        <Alert tone="positive">{state.message}</Alert>
      ) : null}

      {values.id ? <input type="hidden" name="id" value={values.id} /> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Template name" htmlFor={`name-${suffix}`} error={errors.name}>
          <input
            id={`name-${suffix}`}
            name="name"
            className="input"
            required
            maxLength={80}
            defaultValue={values.name ?? ""}
            placeholder="Standard install"
          />
        </Field>
        <Field
          label="Quotation title pattern"
          htmlFor={`titlePattern-${suffix}`}
          error={errors.titlePattern}
          hint="Use {customer}, {subject} or {date}."
        >
          <input
            id={`titlePattern-${suffix}`}
            name="titlePattern"
            className="input"
            maxLength={160}
            defaultValue={values.titlePattern ?? "{subject}"}
          />
        </Field>
      </div>

      <Field label="Internal description" htmlFor={`description-${suffix}`} error={errors.description}>
        <input
          id={`description-${suffix}`}
          name="description"
          className="input"
          maxLength={400}
          defaultValue={values.description ?? ""}
          placeholder="When to reach for this one"
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field
          label="Currency"
          htmlFor={`currency-${suffix}`}
          error={errors.currency}
          hint="Leave blank to use the workspace currency."
        >
          <select
            id={`currency-${suffix}`}
            name="currency"
            className="input"
            defaultValue={values.currency ?? ""}
          >
            <option value="">Workspace default</option>
            {CURRENCIES.map((currency) => (
              <option key={currency.code} value={currency.code}>
                {currency.code} — {currency.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Valid for (days)" htmlFor={`validityDays-${suffix}`} error={errors.validityDays}>
          <input
            id={`validityDays-${suffix}`}
            name="validityDays"
            className="input tabular-nums"
            inputMode="numeric"
            required
            defaultValue={values.validityDays ?? String(defaultValidityDays)}
          />
        </Field>
        <div className="flex flex-col justify-end gap-2 pb-1">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="requireSignature"
              defaultChecked={values.requireSignature ?? false}
              className="size-4 rounded border-[var(--color-line)]"
            />
            Require a signature
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="isDefault"
              defaultChecked={values.isDefault ?? false}
              className="size-4 rounded border-[var(--color-line)]"
            />
            Use as default
          </label>
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Lines</h3>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setLines((c) => [...c, blankLine(defaultTaxRate)])}
          >
            Add line
          </button>
        </div>

        {errors.items ? (
          <p className="mb-2 text-xs text-[var(--color-danger)]" role="alert">
            {errors.items}
          </p>
        ) : null}

        <div className="space-y-3">
          {lines.map((line, index) => (
            <div key={line.key} className="rounded-xl border border-[var(--color-line)] p-3">
              <div className="space-y-3">
                {products.length > 0 ? (
                  <select
                    className="input"
                    aria-label={`Catalog product for line ${index + 1}`}
                    value={line.productId}
                    onChange={(event) => applyProduct(line.key, event.target.value)}
                  >
                    <option value="">Custom line (not from catalog)</option>
                    {products.map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.name}
                      </option>
                    ))}
                  </select>
                ) : null}

                <input
                  name="item-description"
                  className="input"
                  required
                  maxLength={400}
                  aria-label={`Description for line ${index + 1}`}
                  placeholder="What this line covers"
                  value={line.description}
                  onChange={(event) => update(line.key, { description: event.target.value })}
                />

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <input
                    name="item-quantity"
                    className="input tabular-nums"
                    inputMode="decimal"
                    required
                    aria-label={`Quantity for line ${index + 1}`}
                    value={line.quantity}
                    onChange={(event) => update(line.key, { quantity: event.target.value })}
                  />
                  <input
                    name="item-unit"
                    className="input"
                    maxLength={24}
                    aria-label={`Unit for line ${index + 1}`}
                    value={line.unit}
                    onChange={(event) => update(line.key, { unit: event.target.value })}
                  />
                  <input
                    name="item-unit-price"
                    className="input tabular-nums"
                    inputMode="decimal"
                    required
                    aria-label={`Unit price for line ${index + 1}`}
                    value={line.unitPrice}
                    onChange={(event) => update(line.key, { unitPrice: event.target.value })}
                  />
                  <input
                    name="item-tax-rate"
                    className="input tabular-nums"
                    inputMode="decimal"
                    aria-label={`Tax rate for line ${index + 1}`}
                    value={line.taxRate}
                    onChange={(event) => update(line.key, { taxRate: event.target.value })}
                  />
                </div>

                <input type="hidden" name="item-product-id" value={line.productId} />

                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() =>
                    setLines((c) =>
                      c.length === 1 ? [blankLine(defaultTaxRate)] : c.filter((l) => l.key !== line.key),
                    )
                  }
                >
                  Remove line
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Default notes" htmlFor={`notes-${suffix}`} error={errors.notes}>
          <textarea
            id={`notes-${suffix}`}
            name="notes"
            className="input min-h-24"
            maxLength={4000}
            defaultValue={values.notes ?? ""}
          />
        </Field>
        <Field label="Default terms" htmlFor={`terms-${suffix}`} error={errors.terms}>
          <textarea
            id={`terms-${suffix}`}
            name="terms"
            className="input min-h-24"
            maxLength={4000}
            defaultValue={values.terms ?? ""}
          />
        </Field>
      </div>

      <SubmitButton pendingLabel="Saving…">{submitLabel}</SubmitButton>
    </form>
  );
}
