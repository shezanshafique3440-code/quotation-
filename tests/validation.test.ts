import { describe, expect, it } from "vitest";
import { canTransition } from "@/lib/constants";
import {
  businessProfileSchema,
  customerSchema,
  fieldErrors,
  productSchema,
  publicResponseSchema,
  quotationSchema,
  signUpSchema,
  templateSchema,
} from "@/lib/validation";

describe("signUpSchema", () => {
  it("normalises the email and requires a long password", () => {
    const ok = signUpSchema.safeParse({
      name: " Sam ",
      email: " SAM@Example.COM ",
      password: "correct-horse-battery",
      businessName: "Northline",
    });
    expect(ok.success).toBe(true);
    expect(ok.success && ok.data.email).toBe("sam@example.com");
    expect(ok.success && ok.data.name).toBe("Sam");

    const short = signUpSchema.safeParse({
      name: "Sam",
      email: "sam@example.com",
      password: "short",
      businessName: "Northline",
    });
    expect(short.success).toBe(false);
    expect(short.success === false && fieldErrors(short.error).password).toMatch(/at least/i);
  });
});

describe("customerSchema", () => {
  it("turns blank optional fields into undefined rather than empty strings", () => {
    const parsed = customerSchema.parse({ name: "Dana", company: "", email: "", phone: "" });
    expect(parsed.company).toBeUndefined();
    expect(parsed.email).toBeUndefined();
  });

  it("rejects a malformed email and a phone without enough digits", () => {
    expect(customerSchema.safeParse({ name: "Dana", email: "nope" }).success).toBe(false);
    expect(customerSchema.safeParse({ name: "Dana", phone: "123" }).success).toBe(false);
    expect(customerSchema.safeParse({ name: "Dana", phone: "+15551234567" }).success).toBe(true);
  });

  it("requires a name", () => {
    const result = customerSchema.safeParse({ name: "   " });
    expect(result.success).toBe(false);
    expect(result.success === false && fieldErrors(result.error).name).toMatch(/required/i);
  });
});

describe("productSchema", () => {
  it("rejects a negative or fractional price in cents", () => {
    expect(
      productSchema.safeParse({ name: "X", unitPriceCents: -1, taxRateBp: 0 }).success,
    ).toBe(false);
    expect(
      productSchema.safeParse({ name: "X", unitPriceCents: 10.5, taxRateBp: 0 }).success,
    ).toBe(false);
    expect(
      productSchema.safeParse({ name: "X", unitPriceCents: 1050, taxRateBp: 0 }).success,
    ).toBe(true);
  });
});

describe("quotationSchema", () => {
  const base = {
    customerId: "cus_1",
    title: "Work",
    currency: "usd",
    items: [{ description: "Line", quantity: 1, unitPriceCents: 100, taxRateBp: 0 }],
  };

  it("upper-cases the currency and defaults the discount", () => {
    const parsed = quotationSchema.parse(base);
    expect(parsed.currency).toBe("USD");
    expect(parsed.discountCents).toBe(0);
  });

  it("requires at least one line item", () => {
    const result = quotationSchema.safeParse({ ...base, items: [] });
    expect(result.success).toBe(false);
    expect(result.success === false && fieldErrors(result.error).items).toMatch(/at least one/i);
  });

  it("rejects a zero quantity with a path pointing at the row", () => {
    const result = quotationSchema.safeParse({
      ...base,
      items: [{ description: "Line", quantity: 0, unitPriceCents: 100, taxRateBp: 0 }],
    });
    expect(result.success).toBe(false);
    expect(result.success === false && fieldErrors(result.error)["items.0.quantity"]).toBeDefined();
  });

  it("rejects a currency that is not three letters", () => {
    expect(quotationSchema.safeParse({ ...base, currency: "DOLLARS" }).success).toBe(false);
  });
});

describe("businessProfileSchema", () => {
  it("rejects a quote prefix with punctuation", () => {
    const result = businessProfileSchema.safeParse({
      legalName: "Northline",
      currency: "GBP",
      taxRateBp: 2000,
      quoteNumberPrefix: "N/J",
      defaultValidityDays: 14,
    });
    expect(result.success).toBe(false);
  });

  it("accepts a minimal profile", () => {
    const result = businessProfileSchema.safeParse({
      legalName: "Northline",
      currency: "gbp",
      taxRateBp: 0,
      defaultValidityDays: 30,
    });
    expect(result.success).toBe(true);
    expect(result.success && result.data.currency).toBe("GBP");
  });
});

describe("quotation status transitions", () => {
  it("allows the forward path and blocks reopening a decided quotation", () => {
    expect(canTransition("draft", "sent")).toBe(true);
    expect(canTransition("sent", "accepted")).toBe(true);
    expect(canTransition("accepted", "draft")).toBe(false);
    expect(canTransition("accepted", "sent")).toBe(false);
    expect(canTransition("draft", "accepted")).toBe(false);
    expect(canTransition("nonsense", "sent")).toBe(false);
  });
});

describe("businessProfileSchema — regional and quote-to-close settings", () => {
  const base = {
    legalName: "Northline",
    currency: "GBP",
    taxRateBp: 2000,
    defaultValidityDays: 14,
  };

  it("rejects an invented timezone and accepts a real one", () => {
    expect(businessProfileSchema.safeParse({ ...base, timezone: "Mars/Olympus" }).success).toBe(false);
    const ok = businessProfileSchema.safeParse({ ...base, timezone: "Pacific/Auckland" });
    expect(ok.success).toBe(true);
    expect(ok.success && ok.data.timezone).toBe("Pacific/Auckland");
  });

  it("defaults the timezone to UTC rather than the server's zone", () => {
    const parsed = businessProfileSchema.parse(base);
    expect(parsed.timezone).toBe("UTC");
  });

  it("rejects a currency outside the supported registry", () => {
    expect(businessProfileSchema.safeParse({ ...base, currency: "XYZ" }).success).toBe(false);
    expect(businessProfileSchema.safeParse({ ...base, currency: "jpy" }).success).toBe(true);
  });

  it("validates the brand colour as hex", () => {
    expect(businessProfileSchema.safeParse({ ...base, brandColor: "#4B3DDB" }).success).toBe(true);
    expect(businessProfileSchema.safeParse({ ...base, brandColor: "rebeccapurple" }).success).toBe(false);
  });

  it("bounds the automatic follow-up delay", () => {
    expect(businessProfileSchema.safeParse({ ...base, autoFollowUpDays: 0 }).success).toBe(false);
    expect(businessProfileSchema.safeParse({ ...base, autoFollowUpDays: 61 }).success).toBe(false);
    expect(businessProfileSchema.safeParse({ ...base, autoFollowUpDays: 3 }).success).toBe(true);
  });
});

describe("quotationSchema — currency and rate", () => {
  const base = {
    customerId: "cus_1",
    title: "Work",
    currency: "USD",
    items: [{ description: "Line", quantity: 1, unitPriceCents: 100, taxRateBp: 0 }],
  };

  it("only accepts currencies whose minor-unit scale is known", () => {
    expect(quotationSchema.safeParse({ ...base, currency: "JPY" }).success).toBe(true);
    const unknown = quotationSchema.safeParse({ ...base, currency: "XYZ" });
    expect(unknown.success).toBe(false);
    expect(unknown.success === false && fieldErrors(unknown.error).currency).toMatch(/not supported/i);
  });

  it("rejects a non-positive exchange rate rather than storing it", () => {
    expect(quotationSchema.safeParse({ ...base, exchangeRateToBase: 0 }).success).toBe(false);
    expect(quotationSchema.safeParse({ ...base, exchangeRateToBase: -1 }).success).toBe(false);
    expect(quotationSchema.safeParse({ ...base, exchangeRateToBase: 1.08 }).success).toBe(true);
  });

  it("treats an absent rate as absent, not as one", () => {
    const parsed = quotationSchema.parse(base);
    expect(parsed.exchangeRateToBase).toBeUndefined();
  });
});

describe("publicResponseSchema", () => {
  it("requires a name from the responder", () => {
    const result = publicResponseSchema.safeParse({ decision: "accept", respondedByName: "  " });
    expect(result.success).toBe(false);
    expect(result.success === false && fieldErrors(result.error).respondedByName).toMatch(/required/i);
  });

  it("rejects an unknown decision", () => {
    expect(
      publicResponseSchema.safeParse({ decision: "maybe", respondedByName: "Dana" }).success,
    ).toBe(false);
  });

  it("rejects a one-character signature as a typo rather than a signature", () => {
    const result = publicResponseSchema.safeParse({
      decision: "accept",
      respondedByName: "Dana Whitfield",
      signatureName: "D",
    });
    expect(result.success).toBe(false);
    expect(result.success === false && fieldErrors(result.error).signatureName).toMatch(/full name/i);
  });

  it("accepts a decline with a reason and no signature", () => {
    const result = publicResponseSchema.safeParse({
      decision: "reject",
      respondedByName: "Dana Whitfield",
      rejectionReason: "Too expensive",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a malformed signer email", () => {
    expect(
      publicResponseSchema.safeParse({
        decision: "accept",
        respondedByName: "Dana",
        signatureName: "Dana Whitfield",
        signatureEmail: "not-an-email",
      }).success,
    ).toBe(false);
  });
});

describe("templateSchema", () => {
  const base = {
    name: "Standard",
    validityDays: 14,
    items: [{ description: "Line", quantity: 1, unitPriceCents: 100, taxRateBp: 0 }],
  };

  it("requires at least one line", () => {
    const result = templateSchema.safeParse({ ...base, items: [] });
    expect(result.success).toBe(false);
    expect(result.success === false && fieldErrors(result.error).items).toMatch(/at least one/i);
  });

  it("treats a blank currency as “use the workspace default”", () => {
    const parsed = templateSchema.parse({ ...base, currency: "" });
    expect(parsed.currency).toBeUndefined();
  });

  it("rejects an unsupported template currency", () => {
    expect(templateSchema.safeParse({ ...base, currency: "XYZ" }).success).toBe(false);
    expect(templateSchema.safeParse({ ...base, currency: "eur" }).success).toBe(true);
  });

  it("bounds the validity window", () => {
    expect(templateSchema.safeParse({ ...base, validityDays: 0 }).success).toBe(false);
    expect(templateSchema.safeParse({ ...base, validityDays: 366 }).success).toBe(false);
  });
});
