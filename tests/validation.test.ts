import { describe, expect, it } from "vitest";
import { canTransition } from "@/lib/constants";
import {
  businessProfileSchema,
  customerSchema,
  fieldErrors,
  productSchema,
  quotationSchema,
  signUpSchema,
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
