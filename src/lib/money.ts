import { minorUnitDigits, minorUnitFactor } from "./currency";
import { AppError } from "./errors";

export interface LineInput {
  quantity: number;
  unitPriceCents: number;
  /** Tax rate in basis points: 1250 === 12.50%. */
  taxRateBp: number;
}

export interface LineTotals extends LineInput {
  lineTotalCents: number;
  taxCents: number;
}

export interface QuotationTotals {
  lines: LineTotals[];
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
}

/** Half-up rounding to whole cents; `Math.round` alone is half-up only for positives. */
function roundCents(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/**
 * Compute line and document totals.
 *
 * A document-level discount is spread proportionally across lines before tax so
 * that per-line tax rates stay correct. Rounding happens once per line, and the
 * document tax is the sum of the rounded line taxes, so the printed lines always
 * add up to the printed total.
 */
export function computeTotals(lines: LineInput[], discountCents = 0): QuotationTotals {
  if (discountCents < 0) {
    throw new AppError("Discount cannot be negative.");
  }

  const priced = lines.map((line) => {
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
      throw new AppError("Line quantity must be greater than zero.");
    }
    if (!Number.isInteger(line.unitPriceCents) || line.unitPriceCents < 0) {
      throw new AppError("Line unit price must be a non-negative whole number of cents.");
    }
    if (!Number.isInteger(line.taxRateBp) || line.taxRateBp < 0 || line.taxRateBp > 100_000) {
      throw new AppError("Line tax rate must be between 0 and 100000 basis points.");
    }
    return { ...line, lineTotalCents: roundCents(line.quantity * line.unitPriceCents) };
  });

  const subtotalCents = priced.reduce((sum, l) => sum + l.lineTotalCents, 0);
  const effectiveDiscount = Math.min(discountCents, subtotalCents);

  const withTax: LineTotals[] = priced.map((line) => {
    const share =
      subtotalCents === 0 ? 0 : (line.lineTotalCents / subtotalCents) * effectiveDiscount;
    const taxableCents = line.lineTotalCents - share;
    return { ...line, taxCents: roundCents((taxableCents * line.taxRateBp) / 10_000) };
  });

  const taxCents = withTax.reduce((sum, l) => sum + l.taxCents, 0);

  return {
    lines: withTax,
    subtotalCents,
    discountCents: effectiveDiscount,
    taxCents,
    totalCents: subtotalCents - effectiveDiscount + taxCents,
  };
}

/**
 * Parse user-entered money ("1,234.50") into integer minor units.
 *
 * The scale comes from the currency: "1000" is 100000 minor units in USD but
 * 1000 in JPY. Defaults to 2 digits when no currency is supplied, which keeps
 * the plain two-argument callers correct.
 */
export function parseAmountToCents(input: string | number, currency = "USD"): number {
  const raw = typeof input === "number" ? String(input) : input.trim().replace(/,/g, "");
  if (raw === "" || !/^-?\d*(\.\d+)?$/.test(raw)) {
    throw new AppError(`"${input}" is not a valid amount.`);
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new AppError(`"${input}" is not a valid amount.`);
  }
  return roundCents(value * minorUnitFactor(currency));
}

export function formatMoney(cents: number, currency: string, locale = "en-US"): string {
  const digits = minorUnitDigits(currency);
  const major = cents / 10 ** digits;
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(major);
  } catch {
    // Unknown currency code — fall back to a plain, unambiguous rendering.
    return `${currency} ${major.toFixed(digits)}`;
  }
}

/** Currency-symbol-free rendering, used inside the generated PDF. */
export function formatDecimal(cents: number, currency = "USD"): string {
  const digits = minorUnitDigits(currency);
  return (cents / 10 ** digits).toFixed(digits);
}

/**
 * Convert an amount into the organization's reporting currency.
 *
 * Returns null when no rate was recorded, so callers report "not converted"
 * instead of inventing a number.
 */
export function convertToBase(
  cents: number,
  currency: string,
  baseCurrency: string,
  rate: number | null | undefined,
): number | null {
  if (currency.toUpperCase() === baseCurrency.toUpperCase()) return cents;
  if (rate === null || rate === undefined || !Number.isFinite(rate) || rate <= 0) return null;

  const major = cents / 10 ** minorUnitDigits(currency);
  return roundCents(major * rate * 10 ** minorUnitDigits(baseCurrency));
}

export function formatBp(bp: number): string {
  return `${(bp / 100).toFixed(bp % 100 === 0 ? 0 : 2)}%`;
}
