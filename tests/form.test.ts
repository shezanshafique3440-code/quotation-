import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { checkbox, lineItems, moneyCents, optionalDate, percentBp, text } from "@/lib/form";
import { slugify } from "@/lib/slug";

function form(entries: [string, string][]): FormData {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  return data;
}

describe("scalar field parsing", () => {
  it("reads text and distinguishes absent from empty", () => {
    const data = form([["a", "hello"], ["b", ""]]);
    expect(text(data, "a")).toBe("hello");
    expect(text(data, "b")).toBe("");
    expect(text(data, "missing")).toBeUndefined();
  });

  it("converts money input to cents and leaves blanks undefined", () => {
    expect(moneyCents(form([["price", "1,234.50"]]), "price")).toBe(123_450);
    expect(moneyCents(form([["price", "  "]]), "price")).toBeUndefined();
    expect(() => moneyCents(form([["price", "lots"]]), "price")).toThrow(AppError);
  });

  it("converts a percentage to basis points", () => {
    expect(percentBp(form([["tax", "12.5"]]), "tax")).toBe(1250);
    expect(percentBp(form([["tax", "0"]]), "tax")).toBe(0);
    expect(percentBp(form([["tax", ""]]), "tax")).toBeUndefined();
    expect(Number.isNaN(percentBp(form([["tax", "abc"]]), "tax")!)).toBe(true);
  });

  it("reads checkbox states", () => {
    expect(checkbox(form([["active", "on"]]), "active")).toBe(true);
    expect(checkbox(form([]), "active")).toBe(false);
  });

  it("parses dates and ignores unparseable ones", () => {
    expect(optionalDate(form([["d", "2026-04-01"]]), "d")?.toISOString()).toBe(
      "2026-04-01T00:00:00.000Z",
    );
    expect(optionalDate(form([["d", ""]]), "d")).toBeUndefined();
    expect(optionalDate(form([["d", "not a date"]]), "d")).toBeUndefined();
  });
});

describe("lineItems", () => {
  it("zips the parallel repeated fields back into rows", () => {
    const rows = lineItems(
      form([
        ["item-description", "First"],
        ["item-description", "Second"],
        ["item-product-id", "prod_1"],
        ["item-product-id", ""],
        ["item-quantity", "2"],
        ["item-quantity", "1.5"],
        ["item-unit", "unit"],
        ["item-unit", "hour"],
        ["item-unit-price", "100.00"],
        ["item-unit-price", "80"],
        ["item-tax-rate", "20"],
        ["item-tax-rate", "0"],
      ]),
    );

    expect(rows).toEqual([
      {
        productId: "prod_1",
        description: "First",
        quantity: "2",
        unit: "unit",
        unitPriceCents: 10_000,
        taxRateBp: 2000,
      },
      {
        productId: undefined,
        description: "Second",
        quantity: "1.5",
        unit: "hour",
        unitPriceCents: 8_000,
        taxRateBp: 0,
      },
    ]);
  });

  it("drops a row the user left entirely blank", () => {
    const rows = lineItems(
      form([
        ["item-description", "Real"],
        ["item-description", ""],
        ["item-quantity", "1"],
        ["item-quantity", ""],
        ["item-unit-price", "10"],
        ["item-unit-price", ""],
      ]),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.description).toBe("Real");
  });

  it("returns no rows for an empty form", () => {
    expect(lineItems(form([]))).toEqual([]);
  });
});

describe("slugify", () => {
  it("produces url-safe slugs", () => {
    expect(slugify("Northline Joinery Ltd.")).toBe("northline-joinery-ltd");
    expect(slugify("  Café  Déjà Vu  ")).toBe("cafe-deja-vu");
    expect(slugify("A&B // C")).toBe("a-b-c");
  });

  it("falls back when nothing survives, and truncates long names", () => {
    expect(slugify("***")).toBe("workspace");
    expect(slugify("")).toBe("workspace");
    expect(slugify("x".repeat(120)).length).toBeLessThanOrEqual(48);
  });
});
