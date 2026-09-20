import { describe, expect, it } from "vitest";
import {
  buildQuotationMessage,
  normalizeWhatsAppNumber,
  whatsappLink,
} from "@/lib/whatsapp";
import type { QuotationWithRelations } from "@/lib/quotations";

function quotation(overrides: Partial<QuotationWithRelations> = {}): QuotationWithRelations {
  return {
    id: "q1",
    organizationId: "org1",
    number: "QT-2026-0001",
    customerId: "c1",
    inquiryId: null,
    createdById: null,
    status: "draft",
    title: "Alcove shelving",
    currency: "GBP",
    subtotalCents: 50_000,
    discountCents: 5_000,
    taxCents: 9_000,
    totalCents: 54_000,
    notes: "Lead time is 3 weeks.",
    terms: null,
    validUntil: new Date("2026-04-01T00:00:00.000Z"),
    sentAt: null,
    decidedAt: null,
    aiModel: null,
    aiGenerated: false,
    createdAt: new Date("2026-03-01T00:00:00.000Z"),
    updatedAt: new Date("2026-03-01T00:00:00.000Z"),
    customer: {
      id: "c1",
      organizationId: "org1",
      name: "Dana Whitfield",
      company: null,
      email: null,
      phone: null,
      whatsapp: "+44 7700 900123",
      notes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    inquiry: null,
    items: [
      {
        id: "i1",
        quotationId: "q1",
        productId: null,
        position: 0,
        description: "Oak shelving",
        quantity: 2,
        unit: "metre",
        unitPriceCents: 25_000,
        taxRateBp: 2000,
        lineTotalCents: 50_000,
      },
    ],
    reminders: [],
    ...overrides,
  } as QuotationWithRelations;
}

const business = { legalName: "Northline Joinery", locale: "en-GB", phone: "+441132960000", website: null };

describe("normalizeWhatsAppNumber", () => {
  it("strips formatting and drops the plus", () => {
    expect(normalizeWhatsAppNumber("+44 7700 900123")).toBe("447700900123");
    expect(normalizeWhatsAppNumber("(555) 123-4567")).toBe("5551234567");
  });

  it("returns null for anything that cannot be dialled", () => {
    expect(normalizeWhatsAppNumber(null)).toBeNull();
    expect(normalizeWhatsAppNumber("")).toBeNull();
    expect(normalizeWhatsAppNumber("12345")).toBeNull();
    expect(normalizeWhatsAppNumber("1234567890123456789")).toBeNull();
  });
});

describe("whatsappLink", () => {
  it("builds a wa.me link with the message URL-encoded", () => {
    const link = whatsappLink("+15551234567", "Hi there & welcome");
    expect(link).toBe("https://wa.me/15551234567?text=Hi%20there%20%26%20welcome");
  });

  it("returns null rather than a broken link when the number is unusable", () => {
    expect(whatsappLink("123", "Hi")).toBeNull();
  });
});

describe("buildQuotationMessage", () => {
  it("includes the number, every line, the totals and the business name", () => {
    const message = buildQuotationMessage(quotation(), business);

    expect(message).toContain("QT-2026-0001");
    expect(message).toContain("Oak shelving");
    expect(message).toContain("Northline Joinery");
    expect(message).toContain("Dana");
    expect(message).toMatch(/Subtotal: £500\.00/);
    expect(message).toMatch(/Discount: -£50\.00/);
    expect(message).toMatch(/Tax: £90\.00/);
    expect(message).toMatch(/\*Total: £540\.00\*/);
    expect(message).toContain("Lead time is 3 weeks.");
  });

  it("omits discount and tax rows when they are zero", () => {
    const message = buildQuotationMessage(
      quotation({ discountCents: 0, taxCents: 0, totalCents: 50_000 }),
      business,
    );
    expect(message).not.toContain("Discount:");
    expect(message).not.toContain("Tax:");
  });

  it("appends a document link only when one is supplied", () => {
    const withLink = buildQuotationMessage(quotation(), business, {
      documentUrl: "https://example.test/q.pdf",
    });
    expect(withLink).toContain("https://example.test/q.pdf");
    expect(buildQuotationMessage(quotation(), business)).not.toContain("Full quotation:");
  });

  it("stays inside WhatsApp's practical message length for a normal quotation", () => {
    expect(buildQuotationMessage(quotation(), business).length).toBeLessThan(1000);
  });
});
