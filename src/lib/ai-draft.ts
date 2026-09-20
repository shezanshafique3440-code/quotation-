import type { AiDraft, CatalogEntry } from "./ai";
import { AppError } from "./errors";
import type { QuotationInput } from "./validation";

export interface MappingContext {
  customerId: string;
  inquiryId: string;
  currency: string;
  defaultTaxRateBp: number;
  defaultValidityDays: number;
  catalog: (CatalogEntry & { taxRateBp: number })[];
  now?: Date;
}

export interface MappedDraft {
  input: QuotationInput;
  /** Lines the model produced that could not be used, with the reason why. */
  rejected: { description: string; reason: string }[];
  whatsappMessage: string;
  summary: string;
}

function clampQuantity(value: number): number | null {
  if (!Number.isFinite(value) || value <= 0 || value > 1_000_000) return null;
  // Three decimal places is enough for hours, metres and kilograms.
  return Math.round(value * 1000) / 1000;
}

function clampPriceCents(value: number): number | null {
  if (!Number.isFinite(value) || value < 0 || value > 1_000_000_000_00) return null;
  return Math.round(value);
}

/**
 * Convert a model-produced draft into validated quotation input.
 *
 * Catalog prices win over anything the model wrote: when a line references a
 * known product we use the stored price and tax rate, so a hallucinated number
 * can never reach a customer-facing document. Lines that cannot be made valid
 * are dropped and reported rather than silently corrected.
 */
export function mapDraftToQuotationInput(draft: AiDraft, ctx: MappingContext): MappedDraft {
  const catalogById = new Map(ctx.catalog.map((p) => [p.id, p]));
  const rejected: MappedDraft["rejected"] = [];
  const items: QuotationInput["items"] = [];

  for (const raw of draft.items) {
    const description = raw.description?.trim() ?? "";
    const product = raw.product_id ? catalogById.get(raw.product_id) : undefined;

    if (raw.product_id && !product) {
      rejected.push({
        description: description || raw.product_id,
        reason: "Referenced a product that is not in your catalog.",
      });
      continue;
    }

    const quantity = clampQuantity(raw.quantity);
    if (quantity === null) {
      rejected.push({ description: description || "(untitled line)", reason: "Invalid quantity." });
      continue;
    }

    const unitPriceCents = product
      ? product.unitPriceCents
      : clampPriceCents(raw.unit_price_cents);
    if (unitPriceCents === null) {
      rejected.push({ description: description || "(untitled line)", reason: "Invalid unit price." });
      continue;
    }

    const finalDescription = description || product?.name || "";
    if (finalDescription === "") {
      rejected.push({ description: "(untitled line)", reason: "Missing description." });
      continue;
    }

    items.push({
      productId: product?.id,
      description: finalDescription.slice(0, 400),
      quantity,
      unit: (product?.unit ?? raw.unit?.trim() ?? "unit").slice(0, 24) || "unit",
      unitPriceCents,
      taxRateBp: product ? product.taxRateBp : ctx.defaultTaxRateBp,
    });
  }

  if (items.length === 0) {
    throw new AppError(
      "The AI draft did not contain any usable line items. Try adding more detail to the inquiry, or create the quotation manually.",
      { status: 422, code: "ai_empty_draft" },
    );
  }

  const validityDays =
    Number.isFinite(draft.validity_days) && draft.validity_days >= 1 && draft.validity_days <= 365
      ? Math.round(draft.validity_days)
      : ctx.defaultValidityDays;

  const now = ctx.now ?? new Date();
  const validUntil = new Date(now.getTime() + validityDays * 24 * 60 * 60 * 1000);

  return {
    input: {
      customerId: ctx.customerId,
      inquiryId: ctx.inquiryId,
      title: (draft.title?.trim() || "Quotation").slice(0, 160),
      currency: ctx.currency,
      items,
      discountCents: 0,
      notes: draft.notes?.trim() ? draft.notes.trim().slice(0, 4000) : undefined,
      terms: draft.terms?.trim() ? draft.terms.trim().slice(0, 4000) : undefined,
      validUntil,
    },
    rejected,
    whatsappMessage: draft.whatsapp_message?.trim() ?? "",
    summary: draft.summary?.trim() ?? "",
  };
}
