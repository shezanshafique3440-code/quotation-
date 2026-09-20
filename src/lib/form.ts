import { parseAmountToCents } from "./money";

/** Read a single text field; `undefined` when absent so zod defaults apply. */
export function text(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === "string" ? value : undefined;
}

export function checkbox(formData: FormData, name: string): boolean {
  const value = formData.get(name);
  return value === "on" || value === "true" || value === "1";
}

/** Money inputs are entered in major units ("1,250.00") and stored as cents. */
export function moneyCents(formData: FormData, name: string): number | undefined {
  const raw = text(formData, name);
  if (raw === undefined || raw.trim() === "") return undefined;
  return parseAmountToCents(raw);
}

/** Percentages are entered as "12.5" and stored as basis points. */
export function percentBp(formData: FormData, name: string): number | undefined {
  const raw = text(formData, name);
  if (raw === undefined || raw.trim() === "") return undefined;
  const value = Number(raw.trim());
  if (!Number.isFinite(value)) return Number.NaN;
  return Math.round(value * 100);
}

export function optionalDate(formData: FormData, name: string): Date | undefined {
  const raw = text(formData, name);
  if (raw === undefined || raw.trim() === "") return undefined;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export interface RawItem {
  productId: string | undefined;
  description: string;
  quantity: string;
  unit: string;
  unitPriceCents: number;
  taxRateBp: number;
}

/**
 * Line items are posted as parallel repeated fields. FormData preserves
 * document order, so index `i` of each list belongs to the same row.
 */
export function lineItems(formData: FormData): RawItem[] {
  const descriptions = formData.getAll("item-description").map(String);
  const productIds = formData.getAll("item-product-id").map(String);
  const quantities = formData.getAll("item-quantity").map(String);
  const units = formData.getAll("item-unit").map(String);
  const prices = formData.getAll("item-unit-price").map(String);
  const taxes = formData.getAll("item-tax-rate").map(String);

  const rows: RawItem[] = [];
  for (let i = 0; i < descriptions.length; i += 1) {
    const description = (descriptions[i] ?? "").trim();
    const quantity = (quantities[i] ?? "").trim();
    const price = (prices[i] ?? "").trim();

    // A row the user left completely blank is dropped rather than rejected.
    if (description === "" && quantity === "" && price === "") continue;

    const productId = (productIds[i] ?? "").trim();
    const taxRaw = (taxes[i] ?? "").trim();
    const taxValue = taxRaw === "" ? 0 : Number(taxRaw);

    rows.push({
      productId: productId === "" ? undefined : productId,
      description,
      quantity,
      unit: (units[i] ?? "unit").trim() || "unit",
      unitPriceCents: price === "" ? Number.NaN : parseAmountToCents(price),
      taxRateBp: Number.isFinite(taxValue) ? Math.round(taxValue * 100) : Number.NaN,
    });
  }
  return rows;
}
