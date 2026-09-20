"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { Alert, Field } from "@/components/ui";
import { idleState, type ActionState } from "@/lib/action-state";
import { computeTotals, formatMoney, parseAmountToCents } from "@/lib/money";

export interface EditorProduct {
  id: string;
  name: string;
  description: string | null;
  unit: string;
  unitPriceCents: number;
  taxRateBp: number;
}

export interface EditorCustomer {
  id: string;
  name: string;
  company: string | null;
}

export interface EditorLine {
  key: string;
  productId: string;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  taxRate: string;
}

export interface EditorValues {
  id?: string;
  customerId?: string;
  inquiryId?: string;
  title?: string;
  currency?: string;
  discount?: string;
  notes?: string;
  terms?: string;
  validUntil?: string;
  lines?: Omit<EditorLine, "key">[];
}

let keySeed = 0;
function nextKey(): string {
  keySeed += 1;
  return `line-${keySeed}`;
}

function blankLine(defaultTaxRate: string): EditorLine {
  return {
    key: nextKey(),
    productId: "",
    description: "",
    quantity: "1",
    unit: "unit",
    unitPrice: "",
    taxRate: defaultTaxRate,
  };
}

/** Parse a user-entered amount without throwing, for the live preview only. */
function safeCents(value: string): number {
  try {
    return parseAmountToCents(value);
  } catch {
    return 0;
  }
}

function safeQuantity(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function safeBp(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : 0;
}

export function QuotationEditor({
  action,
  customers,
  products,
  values = {},
  defaultCurrency,
  defaultTaxRateBp,
  locale,
  submitLabel,
  cancelHref,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  customers: EditorCustomer[];
  products: EditorProduct[];
  values?: EditorValues;
  defaultCurrency: string;
  defaultTaxRateBp: number;
  locale: string;
  submitLabel: string;
  cancelHref: string;
}) {
  const [state, formAction] = useActionState(action, idleState);
  const defaultTaxRate = String(defaultTaxRateBp / 100);

  const [lines, setLines] = useState<EditorLine[]>(() =>
    (values.lines ?? []).length > 0
      ? values.lines!.map((line) => ({ ...line, key: nextKey() }))
      : [blankLine(defaultTaxRate)],
  );
  const [currency, setCurrency] = useState(values.currency ?? defaultCurrency);
  const [discount, setDiscount] = useState(values.discount ?? "0.00");

  const errors = state.fieldErrors ?? {};

  const totals = useMemo(() => {
    const priced = lines
      .map((line) => ({
        quantity: safeQuantity(line.quantity),
        unitPriceCents: safeCents(line.unitPrice),
        taxRateBp: safeBp(line.taxRate),
      }))
      .filter((line) => line.quantity > 0);

    if (priced.length === 0) {
      return { lines: [], subtotalCents: 0, discountCents: 0, taxCents: 0, totalCents: 0 };
    }
    try {
      return computeTotals(priced, safeCents(discount));
    } catch {
      return { lines: [], subtotalCents: 0, discountCents: 0, taxCents: 0, totalCents: 0 };
    }
  }, [lines, discount]);

  const money = (cents: number) => formatMoney(cents, currency, locale);

  const updateLine = (key: string, patch: Partial<EditorLine>) => {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  };

  const applyProduct = (key: string, productId: string) => {
    const product = products.find((p) => p.id === productId);
    if (!product) {
      updateLine(key, { productId: "" });
      return;
    }
    updateLine(key, {
      productId,
      description: product.description?.trim() || product.name,
      unit: product.unit,
      unitPrice: (product.unitPriceCents / 100).toFixed(2),
      taxRate: String(product.taxRateBp / 100),
    });
  };

  if (customers.length === 0) {
    return (
      <div className="px-5 py-6">
        <Alert tone="brand" title="Add a customer first">
          A quotation needs someone to send it to.{" "}
          <Link href="/customers" className="font-medium underline">
            Add a customer
          </Link>
          .
        </Alert>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-6 px-5 py-5" noValidate>
      {state.status === "error" && state.message ? <Alert tone="danger">{state.message}</Alert> : null}
      {state.status === "success" && state.message ? (
        <Alert tone="positive">{state.message}</Alert>
      ) : null}

      {values.id ? <input type="hidden" name="id" value={values.id} /> : null}
      {values.inquiryId ? <input type="hidden" name="inquiryId" value={values.inquiryId} /> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Customer" htmlFor="customerId" error={errors.customerId}>
          <select
            id="customerId"
            name="customerId"
            className="input"
            required
            defaultValue={values.customerId ?? ""}
          >
            <option value="" disabled>
              Select a customer
            </option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.name}
                {customer.company ? ` — ${customer.company}` : ""}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Currency" htmlFor="currency" error={errors.currency}>
          <input
            id="currency"
            name="currency"
            className="input uppercase"
            maxLength={3}
            required
            value={currency}
            onChange={(event) => setCurrency(event.target.value.toUpperCase())}
          />
        </Field>
      </div>

      <Field label="Title" htmlFor="title" error={errors.title}>
        <input
          id="title"
          name="title"
          className="input"
          required
          maxLength={160}
          defaultValue={values.title ?? ""}
          placeholder="Fitted shelving — Leeds flat"
        />
      </Field>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Line items</h3>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setLines((current) => [...current, blankLine(defaultTaxRate)])}
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
          {lines.map((line, index) => {
            const lineTotal = Math.round(safeQuantity(line.quantity) * safeCents(line.unitPrice));
            const rowErrors = {
              description: errors[`items.${index}.description`],
              quantity: errors[`items.${index}.quantity`],
              unitPrice: errors[`items.${index}.unitPriceCents`],
            };

            return (
              <div key={line.key} className="rounded-xl border border-[var(--color-line)] p-3">
                <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
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

                    <div>
                      <input
                        name="item-description"
                        className="input"
                        required
                        maxLength={400}
                        aria-label={`Description for line ${index + 1}`}
                        placeholder="What this line covers"
                        value={line.description}
                        onChange={(event) => updateLine(line.key, { description: event.target.value })}
                      />
                      {rowErrors.description ? (
                        <p className="mt-1 text-xs text-[var(--color-danger)]">{rowErrors.description}</p>
                      ) : null}
                    </div>

                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <div>
                        <label className="label text-xs" htmlFor={`${line.key}-qty`}>
                          Qty
                        </label>
                        <input
                          id={`${line.key}-qty`}
                          name="item-quantity"
                          className="input tabular-nums"
                          inputMode="decimal"
                          required
                          value={line.quantity}
                          onChange={(event) => updateLine(line.key, { quantity: event.target.value })}
                        />
                        {rowErrors.quantity ? (
                          <p className="mt-1 text-xs text-[var(--color-danger)]">{rowErrors.quantity}</p>
                        ) : null}
                      </div>
                      <div>
                        <label className="label text-xs" htmlFor={`${line.key}-unit`}>
                          Unit
                        </label>
                        <input
                          id={`${line.key}-unit`}
                          name="item-unit"
                          className="input"
                          maxLength={24}
                          value={line.unit}
                          onChange={(event) => updateLine(line.key, { unit: event.target.value })}
                        />
                      </div>
                      <div>
                        <label className="label text-xs" htmlFor={`${line.key}-price`}>
                          Unit price
                        </label>
                        <input
                          id={`${line.key}-price`}
                          name="item-unit-price"
                          className="input tabular-nums"
                          inputMode="decimal"
                          required
                          value={line.unitPrice}
                          onChange={(event) => updateLine(line.key, { unitPrice: event.target.value })}
                        />
                        {rowErrors.unitPrice ? (
                          <p className="mt-1 text-xs text-[var(--color-danger)]">{rowErrors.unitPrice}</p>
                        ) : null}
                      </div>
                      <div>
                        <label className="label text-xs" htmlFor={`${line.key}-tax`}>
                          Tax %
                        </label>
                        <input
                          id={`${line.key}-tax`}
                          name="item-tax-rate"
                          className="input tabular-nums"
                          inputMode="decimal"
                          value={line.taxRate}
                          onChange={(event) => updateLine(line.key, { taxRate: event.target.value })}
                        />
                      </div>
                    </div>

                    <input type="hidden" name="item-product-id" value={line.productId} />
                  </div>

                  <div className="flex flex-row items-end justify-between gap-3 sm:flex-col sm:items-end sm:justify-between">
                    <p className="text-sm font-medium tabular-nums">{money(lineTotal)}</p>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() =>
                        setLines((current) =>
                          current.length === 1
                            ? [blankLine(defaultTaxRate)]
                            : current.filter((l) => l.key !== line.key),
                        )
                      }
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={`Discount (${currency})`} htmlFor="discount" error={errors.discountCents}>
          <input
            id="discount"
            name="discount"
            className="input tabular-nums"
            inputMode="decimal"
            value={discount}
            onChange={(event) => setDiscount(event.target.value)}
          />
        </Field>
        <Field label="Valid until" htmlFor="validUntil" error={errors.validUntil}>
          <input
            id="validUntil"
            name="validUntil"
            type="date"
            className="input"
            defaultValue={values.validUntil ?? ""}
          />
        </Field>
      </div>

      <div className="rounded-xl bg-[var(--color-surface-2)] p-4">
        <dl className="ml-auto max-w-xs space-y-1.5 text-sm">
          <div className="flex justify-between">
            <dt className="text-[var(--color-ink-muted)]">Subtotal</dt>
            <dd className="tabular-nums">{money(totals.subtotalCents)}</dd>
          </div>
          {totals.discountCents > 0 ? (
            <div className="flex justify-between">
              <dt className="text-[var(--color-ink-muted)]">Discount</dt>
              <dd className="tabular-nums">-{money(totals.discountCents)}</dd>
            </div>
          ) : null}
          {totals.taxCents > 0 ? (
            <div className="flex justify-between">
              <dt className="text-[var(--color-ink-muted)]">Tax</dt>
              <dd className="tabular-nums">{money(totals.taxCents)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between border-t border-[var(--color-line)] pt-1.5 text-base font-semibold">
            <dt>Total</dt>
            <dd className="tabular-nums">{money(totals.totalCents)}</dd>
          </div>
        </dl>
        <p className="mt-2 text-xs text-[var(--color-ink-subtle)]">
          Preview only — the server recomputes every total when you save.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Notes to the customer" htmlFor="notes" error={errors.notes}>
          <textarea
            id="notes"
            name="notes"
            className="input min-h-28"
            maxLength={4000}
            defaultValue={values.notes ?? ""}
          />
        </Field>
        <Field label="Terms" htmlFor="terms" error={errors.terms}>
          <textarea
            id="terms"
            name="terms"
            className="input min-h-28"
            maxLength={4000}
            defaultValue={values.terms ?? ""}
          />
        </Field>
      </div>

      <div className="flex flex-wrap gap-2">
        <SubmitButton pendingLabel="Saving…">{submitLabel}</SubmitButton>
        <Link href={cancelHref} className="btn btn-secondary">
          Cancel
        </Link>
      </div>
    </form>
  );
}
