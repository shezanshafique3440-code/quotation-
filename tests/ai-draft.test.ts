import { describe, expect, it } from "vitest";
import type { AiDraft } from "@/lib/ai";
import { mapDraftToQuotationInput, type MappingContext } from "@/lib/ai-draft";
import { AppError } from "@/lib/errors";

const catalog: MappingContext["catalog"] = [
  {
    id: "prod_oak",
    name: "Oak shelving",
    description: "Solid oak",
    sku: "OAK",
    unit: "metre",
    unitPriceCents: 18_500,
    taxRateBp: 2000,
  },
];

const ctx: MappingContext = {
  customerId: "cus_1",
  inquiryId: "inq_1",
  currency: "GBP",
  defaultTaxRateBp: 2000,
  defaultValidityDays: 21,
  catalog,
  now: new Date("2026-03-01T00:00:00.000Z"),
};

function draft(overrides: Partial<AiDraft> = {}): AiDraft {
  return {
    title: "Alcove shelving",
    summary: "Two alcoves in oak.",
    items: [
      {
        product_id: "prod_oak",
        description: "Oak shelving, two alcoves",
        quantity: 3.6,
        unit: "metre",
        unit_price_cents: 999_999,
      },
    ],
    notes: "Lead time 3 weeks.",
    terms: "50% deposit.",
    validity_days: 30,
    whatsapp_message: "Hi Dana, here is the quote.",
    ...overrides,
  };
}

describe("mapDraftToQuotationInput", () => {
  it("overrides the model's price with the catalog price for catalog lines", () => {
    const mapped = mapDraftToQuotationInput(draft(), ctx);

    expect(mapped.input.items).toHaveLength(1);
    expect(mapped.input.items[0]!.unitPriceCents).toBe(18_500);
    expect(mapped.input.items[0]!.productId).toBe("prod_oak");
    expect(mapped.input.items[0]!.taxRateBp).toBe(2000);
    expect(mapped.rejected).toEqual([]);
  });

  it("keeps the model's price for a genuinely custom line and applies the default tax rate", () => {
    const mapped = mapDraftToQuotationInput(
      draft({
        items: [
          {
            product_id: "",
            description: "Bespoke ladder",
            quantity: 1,
            unit: "unit",
            unit_price_cents: 42_000,
          },
        ],
      }),
      ctx,
    );

    expect(mapped.input.items[0]!.productId).toBeUndefined();
    expect(mapped.input.items[0]!.unitPriceCents).toBe(42_000);
    expect(mapped.input.items[0]!.taxRateBp).toBe(2000);
  });

  it("drops a line referencing a product outside the workspace and says why", () => {
    const mapped = mapDraftToQuotationInput(
      draft({
        items: [
          { product_id: "prod_other", description: "Ghost", quantity: 1, unit: "unit", unit_price_cents: 100 },
          { product_id: "", description: "Real", quantity: 1, unit: "unit", unit_price_cents: 100 },
        ],
      }),
      ctx,
    );

    expect(mapped.input.items).toHaveLength(1);
    expect(mapped.rejected).toEqual([
      { description: "Ghost", reason: "Referenced a product that is not in your catalog." },
    ]);
  });

  it("drops lines with an unusable quantity or price", () => {
    const mapped = mapDraftToQuotationInput(
      draft({
        items: [
          { product_id: "", description: "Zero qty", quantity: 0, unit: "unit", unit_price_cents: 100 },
          { product_id: "", description: "Negative", quantity: 1, unit: "unit", unit_price_cents: -5 },
          { product_id: "", description: "Fine", quantity: 2, unit: "unit", unit_price_cents: 100 },
        ],
      }),
      ctx,
    );

    expect(mapped.input.items.map((i) => i.description)).toEqual(["Fine"]);
    expect(mapped.rejected).toHaveLength(2);
    expect(mapped.rejected[0]!.reason).toBe("Invalid quantity.");
    expect(mapped.rejected[1]!.reason).toBe("Invalid unit price.");
  });

  it("refuses to persist anything when no line survives", () => {
    expect(() =>
      mapDraftToQuotationInput(
        draft({
          items: [
            { product_id: "", description: "Bad", quantity: -1, unit: "unit", unit_price_cents: 10 },
          ],
        }),
        ctx,
      ),
    ).toThrow(AppError);
  });

  it("uses the model's validity when sane and the business default otherwise", () => {
    expect(mapDraftToQuotationInput(draft(), ctx).input.validUntil?.toISOString()).toBe(
      "2026-03-31T00:00:00.000Z",
    );
    expect(
      mapDraftToQuotationInput(draft({ validity_days: 9_000 }), ctx).input.validUntil?.toISOString(),
    ).toBe("2026-03-22T00:00:00.000Z");
  });

  it("rounds a long fractional quantity to three decimals", () => {
    const mapped = mapDraftToQuotationInput(
      draft({
        items: [
          { product_id: "", description: "Thirds", quantity: 1 / 3, unit: "unit", unit_price_cents: 300 },
        ],
      }),
      ctx,
    );
    expect(mapped.input.items[0]!.quantity).toBe(0.333);
  });

  it("always produces a draft tied to the originating inquiry and customer", () => {
    const mapped = mapDraftToQuotationInput(draft(), ctx);
    expect(mapped.input.customerId).toBe("cus_1");
    expect(mapped.input.inquiryId).toBe("inq_1");
    expect(mapped.input.currency).toBe("GBP");
    expect(mapped.input.discountCents).toBe(0);
    expect(mapped.whatsappMessage).toBe("Hi Dana, here is the quote.");
  });
});
