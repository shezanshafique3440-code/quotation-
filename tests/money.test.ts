import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import {
  computeTotals,
  formatBp,
  formatDecimal,
  formatMoney,
  parseAmountToCents,
} from "@/lib/money";

describe("computeTotals", () => {
  it("prices lines, applies tax per line and sums the document", () => {
    const totals = computeTotals([
      { quantity: 2, unitPriceCents: 10_000, taxRateBp: 2000 },
      { quantity: 1, unitPriceCents: 5_000, taxRateBp: 0 },
    ]);

    expect(totals.lines[0]!.lineTotalCents).toBe(20_000);
    expect(totals.lines[0]!.taxCents).toBe(4_000);
    expect(totals.lines[1]!.taxCents).toBe(0);
    expect(totals.subtotalCents).toBe(25_000);
    expect(totals.taxCents).toBe(4_000);
    expect(totals.totalCents).toBe(29_000);
  });

  it("rounds fractional quantities to whole cents, half away from zero", () => {
    const totals = computeTotals([{ quantity: 0.335, unitPriceCents: 1_000, taxRateBp: 0 }]);
    expect(totals.lines[0]!.lineTotalCents).toBe(335);
  });

  it("spreads a document discount across lines before tax", () => {
    const totals = computeTotals(
      [
        { quantity: 1, unitPriceCents: 10_000, taxRateBp: 2000 },
        { quantity: 1, unitPriceCents: 10_000, taxRateBp: 0 },
      ],
      10_000,
    );

    // Half the discount lands on each line, so only the taxed line's base drops.
    expect(totals.subtotalCents).toBe(20_000);
    expect(totals.discountCents).toBe(10_000);
    expect(totals.lines[0]!.taxCents).toBe(1_000);
    expect(totals.totalCents).toBe(11_000);
  });

  it("never discounts below zero", () => {
    const totals = computeTotals([{ quantity: 1, unitPriceCents: 5_000, taxRateBp: 0 }], 99_999);
    expect(totals.discountCents).toBe(5_000);
    expect(totals.totalCents).toBe(0);
  });

  it("keeps the printed lines adding up to the printed total", () => {
    const totals = computeTotals(
      [
        { quantity: 3, unitPriceCents: 3_333, taxRateBp: 1750 },
        { quantity: 7, unitPriceCents: 1_111, taxRateBp: 1750 },
        { quantity: 1.5, unitPriceCents: 999, taxRateBp: 500 },
      ],
      1_234,
    );

    const lineSum = totals.lines.reduce((sum, l) => sum + l.lineTotalCents, 0);
    const taxSum = totals.lines.reduce((sum, l) => sum + l.taxCents, 0);
    expect(lineSum).toBe(totals.subtotalCents);
    expect(taxSum).toBe(totals.taxCents);
    expect(totals.totalCents).toBe(totals.subtotalCents - totals.discountCents + totals.taxCents);
  });

  it("rejects non-positive quantities and negative prices", () => {
    expect(() => computeTotals([{ quantity: 0, unitPriceCents: 100, taxRateBp: 0 }])).toThrow(AppError);
    expect(() => computeTotals([{ quantity: 1, unitPriceCents: -1, taxRateBp: 0 }])).toThrow(AppError);
    expect(() => computeTotals([{ quantity: 1, unitPriceCents: 1.5, taxRateBp: 0 }])).toThrow(AppError);
    expect(() => computeTotals([{ quantity: 1, unitPriceCents: 100, taxRateBp: 0 }], -1)).toThrow(
      AppError,
    );
  });
});

describe("parseAmountToCents", () => {
  it("accepts grouped and plain decimal input", () => {
    expect(parseAmountToCents("1,234.50")).toBe(123_450);
    expect(parseAmountToCents("0.05")).toBe(5);
    expect(parseAmountToCents(12)).toBe(1_200);
  });

  it("rounds to the nearest cent rather than truncating", () => {
    expect(parseAmountToCents("0.005")).toBe(1);
    expect(parseAmountToCents("19.999")).toBe(2_000);
  });

  it("rejects anything that is not a number", () => {
    for (const bad of ["", "abc", "1.2.3", "$5", "1e5"]) {
      expect(() => parseAmountToCents(bad)).toThrow(AppError);
    }
  });
});

describe("formatting", () => {
  it("formats a known currency", () => {
    expect(formatMoney(123_456, "USD", "en-US")).toBe("$1,234.56");
  });

  it("renders an unrecognised but well-formed currency code with its code as the symbol", () => {
    // Intl handles these; the space it inserts is non-breaking.
    expect(formatMoney(1_000, "ZZZ", "en-US").replace(/\u00A0/g, " ")).toBe("ZZZ 10.00");
  });

  it("falls back to a plain rendering when Intl rejects the currency code", () => {
    expect(formatMoney(1_000, "BAD-CODE", "en-US")).toBe("BAD-CODE 10.00");
  });

  it("renders decimals and basis points for the PDF", () => {
    expect(formatDecimal(123_456)).toBe("1234.56");
    expect(formatBp(2000)).toBe("20%");
    expect(formatBp(1750)).toBe("17.50%");
  });
});
