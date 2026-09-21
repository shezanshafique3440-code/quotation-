import { describe, expect, it } from "vitest";
import {
  CURRENCIES,
  currencyInfo,
  isKnownCurrency,
  minorUnitDigits,
  minorUnitFactor,
} from "@/lib/currency";
import { convertToBase, formatDecimal, formatMoney, parseAmountToCents } from "@/lib/money";

describe("currency registry", () => {
  it("knows the currencies that do not use two decimals", () => {
    expect(minorUnitDigits("JPY")).toBe(0);
    expect(minorUnitDigits("KRW")).toBe(0);
    expect(minorUnitDigits("KWD")).toBe(3);
    expect(minorUnitDigits("BHD")).toBe(3);
    expect(minorUnitDigits("USD")).toBe(2);
    expect(minorUnitFactor("JPY")).toBe(1);
    expect(minorUnitFactor("KWD")).toBe(1000);
  });

  it("is case-insensitive and falls back to two digits for an unlisted code", () => {
    expect(minorUnitDigits("jpy")).toBe(0);
    expect(isKnownCurrency("ZZZ")).toBe(false);
    expect(currencyInfo("ZZZ")).toEqual({ code: "ZZZ", name: "ZZZ", digits: 2 });
  });

  it("offers a list with unique codes for the picker", () => {
    const codes = CURRENCIES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).toContain("USD");
    expect(codes).toContain("JPY");
  });
});

describe("parsing at the currency's scale", () => {
  it("scales by the minor unit, so a yen quote is not multiplied by 100", () => {
    expect(parseAmountToCents("1200", "JPY")).toBe(1200);
    expect(parseAmountToCents("12.50", "USD")).toBe(1250);
    expect(parseAmountToCents("12.505", "KWD")).toBe(12505);
  });

  it("rounds to the currency's smallest unit", () => {
    expect(parseAmountToCents("1200.6", "JPY")).toBe(1201);
    expect(parseAmountToCents("0.005", "USD")).toBe(1);
  });

  it("defaults to two digits when no currency is given", () => {
    expect(parseAmountToCents("12.50")).toBe(1250);
  });
});

describe("rendering at the currency's scale", () => {
  it("renders zero-decimal currencies without a fraction", () => {
    expect(formatMoney(1200, "JPY", "en-US").replace(/ /g, " ")).toMatch(/1,200$/);
    expect(formatDecimal(1200, "JPY")).toBe("1200");
  });

  it("renders three-decimal currencies with three places", () => {
    expect(formatDecimal(12505, "KWD")).toBe("12.505");
  });

  it("still renders two-decimal currencies as before", () => {
    expect(formatMoney(123_456, "USD", "en-US")).toBe("$1,234.56");
    expect(formatDecimal(123_456)).toBe("1234.56");
  });

  it("round-trips a parse and a render for every listed currency", () => {
    for (const currency of CURRENCIES) {
      const minor = parseAmountToCents("1234", currency.code);
      expect(formatDecimal(minor, currency.code)).toBe(
        (1234).toFixed(currency.digits),
      );
    }
  });
});

describe("convertToBase", () => {
  it("is the identity when the currencies match, whatever the rate", () => {
    expect(convertToBase(12_345, "USD", "USD", null)).toBe(12_345);
    expect(convertToBase(12_345, "usd", "USD", 99)).toBe(12_345);
  });

  it("converts across differing minor-unit scales", () => {
    // 1000 JPY (0 digits) at 0.0064 USD/JPY = 6.40 USD = 640 minor units.
    expect(convertToBase(1000, "JPY", "USD", 0.0064)).toBe(640);
    // 100.00 USD at 0.79 GBP/USD = 79.00 GBP.
    expect(convertToBase(10_000, "USD", "GBP", 0.79)).toBe(7_900);
  });

  it("returns null rather than guessing when no usable rate was recorded", () => {
    expect(convertToBase(10_000, "EUR", "USD", null)).toBeNull();
    expect(convertToBase(10_000, "EUR", "USD", undefined)).toBeNull();
    expect(convertToBase(10_000, "EUR", "USD", 0)).toBeNull();
    expect(convertToBase(10_000, "EUR", "USD", -1)).toBeNull();
    expect(convertToBase(10_000, "EUR", "USD", Number.NaN)).toBeNull();
  });
});
