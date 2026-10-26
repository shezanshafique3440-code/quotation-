import { describe, expect, it } from "vitest";
import { catalogLineFields, clearForeignCatalogPrice } from "@/lib/catalog-line";

const product = {
  id: "catalog-product",
  name: "Fitting",
  description: null,
  unit: "hour",
  unitPriceCents: 12345,
  taxRateBp: 1250,
};

describe("catalog prices in quotation and template editors", () => {
  it.each([
    ["USD", "123.45"],
    ["JPY", "12345"],
    ["KWD", "12.345"],
  ])("formats %s prices at their own minor-unit scale", (currency, amount) => {
    expect(catalogLineFields(product, currency, currency)).toMatchObject({
      productId: product.id,
      description: "Fitting",
      unitPrice: amount,
      taxRate: "12.5",
      catalogPriceCurrency: currency,
    });
  });

  it("requires manual foreign-currency pricing instead of inventing a conversion", () => {
    expect(catalogLineFields(product, "USD", "JPY")).toMatchObject({
      productId: product.id,
      unitPrice: "",
      catalogPriceCurrency: undefined,
    });
  });

  it("clears only a catalog-derived amount when changing currency", () => {
    const derived = catalogLineFields(product, "USD", "USD");
    expect(clearForeignCatalogPrice(derived, "JPY").unitPrice).toBe("");
    expect(clearForeignCatalogPrice(derived, "USD")).toBe(derived);
    const manual = { ...derived, unitPrice: "2000", catalogPriceCurrency: undefined };
    expect(clearForeignCatalogPrice(manual, "JPY")).toBe(manual);
  });
});
