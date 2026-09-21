import { z } from "zod";
import { isValidHexColor } from "./branding";
import { isKnownCurrency } from "./currency";
import { isValidTimeZone } from "./timezone";
import {
  INQUIRY_CHANNELS,
  INQUIRY_STATUSES,
  MIN_PASSWORD_LENGTH,
  QUOTATION_STATUSES,
  REMINDER_CHANNELS,
} from "./constants";


const trimmed = (max: number) => z.string().trim().max(max);
const requiredText = (max: number, label: string) =>
  trimmed(max).min(1, `${label} is required.`);

/** Empty strings from HTML forms become `undefined` rather than "" in the DB. */
const optionalText = (max: number) =>
  trimmed(max)
    .transform((v) => (v === "" ? undefined : v))
    .optional();

const optionalEmail = z
  .string()
  .trim()
  .transform((v) => (v === "" ? undefined : v))
  .optional()
  .refine((v) => v === undefined || z.string().email().safeParse(v).success, {
    message: "Enter a valid email address.",
  });

const optionalUrl = z
  .string()
  .trim()
  .transform((v) => (v === "" ? undefined : v))
  .optional()
  .refine((v) => v === undefined || z.string().url().safeParse(v).success, {
    message: "Enter a valid URL including https://",
  });

export const currencyCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "Use a 3-letter ISO currency code such as USD.");

/** Restricted to the registry, where the minor-unit scale is known. */
export const supportedCurrencyCode = currencyCode.refine(isKnownCurrency, {
  message: "That currency is not supported yet. Pick one from the list.",
});

export const timeZone = z
  .string()
  .trim()
  .min(1, "Choose a timezone.")
  .refine(isValidTimeZone, { message: "That is not a recognised IANA timezone." });

export const hexColor = z
  .string()
  .trim()
  .refine(isValidHexColor, { message: "Use a hex colour such as #4B3DDB." });

/** Digits with an optional leading +, as WhatsApp requires an E.164-style number. */
export const phoneNumber = trimmed(32).regex(
  /^\+?[0-9][0-9\s().-]{5,}$/,
  "Enter a valid phone number with country code, e.g. +15551234567.",
);

const optionalPhone = z
  .string()
  .trim()
  .transform((v) => (v === "" ? undefined : v))
  .optional()
  .refine((v) => v === undefined || phoneNumber.safeParse(v).success, {
    message: "Enter a valid phone number with country code, e.g. +15551234567.",
  });

export const signUpSchema = z.object({
  name: requiredText(120, "Your name"),
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z
    .string()
    .min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
    .max(200, "Password must be at most 200 characters."),
  businessName: requiredText(120, "Business name"),
});
export type SignUpInput = z.infer<typeof signUpSchema>;

export const signInSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z.string().min(1, "Password is required."),
});
export type SignInInput = z.infer<typeof signInSchema>;

export const businessProfileSchema = z.object({
  legalName: requiredText(160, "Business name"),
  currency: supportedCurrencyCode,
  locale: trimmed(20).default("en-US"),
  email: optionalEmail,
  phone: optionalPhone,
  whatsappNumber: optionalPhone,
  website: optionalUrl,
  addressLine1: optionalText(160),
  addressLine2: optionalText(160),
  city: optionalText(80),
  postalCode: optionalText(24),
  country: optionalText(80),
  taxId: optionalText(60),
  taxRateBp: z.coerce
    .number()
    .int("Tax rate must be a whole number of basis points.")
    .min(0)
    .max(100_000, "Tax rate cannot exceed 1000%."),
  logoUrl: optionalUrl,
  quoteNumberPrefix: trimmed(8)
    .regex(/^[A-Za-z0-9-]{1,8}$/, "Use 1-8 letters, digits or hyphens.")
    .default("QT"),
  defaultValidityDays: z.coerce.number().int().min(1).max(365),
  defaultTerms: optionalText(4000),
  defaultNotes: optionalText(4000),

  timezone: timeZone.default("UTC"),
  brandColor: hexColor.default("#4B3DDB"),
  portalHeadline: optionalText(120),
  portalMessage: optionalText(2000),

  notifyEmail: optionalEmail,
  notifyOnView: z.coerce.boolean().default(false),
  notifyOnDecision: z.coerce.boolean().default(true),
  notifyFollowUpsDue: z.coerce.boolean().default(true),

  publicPagesEnabled: z.coerce.boolean().default(true),
  requireSignature: z.coerce.boolean().default(false),
  autoFollowUpEnabled: z.coerce.boolean().default(true),
  autoFollowUpDays: z.coerce
    .number()
    .int("Use a whole number of days.")
    .min(1, "Follow up at least one day after sending.")
    .max(60, "Sixty days is the longest automatic follow-up delay.")
    .default(3),
});
export type BusinessProfileInput = z.infer<typeof businessProfileSchema>;

export const customerSchema = z.object({
  name: requiredText(120, "Customer name"),
  company: optionalText(120),
  email: optionalEmail,
  phone: optionalPhone,
  whatsapp: optionalPhone,
  notes: optionalText(2000),
});
export type CustomerInput = z.infer<typeof customerSchema>;

export const productSchema = z.object({
  name: requiredText(160, "Product name"),
  sku: optionalText(64),
  description: optionalText(2000),
  unitPriceCents: z.coerce
    .number()
    .int("Price must be a whole number of cents.")
    .min(0, "Price cannot be negative.")
    .max(1_000_000_000_00),
  unit: trimmed(24).default("unit"),
  taxRateBp: z.coerce.number().int().min(0).max(100_000),
  active: z.coerce.boolean().default(true),
});
export type ProductInput = z.infer<typeof productSchema>;

export const inquirySchema = z.object({
  customerId: requiredText(40, "Customer"),
  channel: z.enum(INQUIRY_CHANNELS),
  subject: requiredText(160, "Subject"),
  message: requiredText(8000, "Inquiry details"),
  receivedAt: z.coerce.date().optional(),
});
export type InquiryInput = z.infer<typeof inquirySchema>;

export const inquiryStatusSchema = z.object({ status: z.enum(INQUIRY_STATUSES) });

export const quotationItemSchema = z.object({
  productId: optionalText(40),
  description: requiredText(400, "Item description"),
  quantity: z.coerce
    .number()
    .positive("Quantity must be greater than zero.")
    .max(1_000_000, "Quantity is unrealistically large."),
  unit: trimmed(24).default("unit"),
  unitPriceCents: z.coerce.number().int().min(0).max(1_000_000_000_00),
  taxRateBp: z.coerce.number().int().min(0).max(100_000),
});
export type QuotationItemInput = z.infer<typeof quotationItemSchema>;

export const quotationSchema = z.object({
  customerId: requiredText(40, "Customer"),
  inquiryId: optionalText(40),
  templateId: optionalText(40),
  title: requiredText(160, "Quotation title"),
  currency: supportedCurrencyCode,
  items: z
    .array(quotationItemSchema)
    .min(1, "Add at least one line item.")
    .max(100, "A quotation can hold at most 100 line items."),
  discountCents: z.coerce.number().int().min(0).max(1_000_000_000_00).default(0),
  notes: optionalText(4000),
  terms: optionalText(4000),
  validUntil: z.coerce.date().optional(),
  requireSignature: z.coerce.boolean().optional(),
  /**
   * Rate into the workspace's reporting currency. Left blank rather than
   * guessed — analytics exclude unconverted quotes instead of inventing a
   * number.
   */
  exchangeRateToBase: z.coerce
    .number()
    .positive("An exchange rate must be greater than zero.")
    .max(1_000_000)
    .optional(),
});
export type QuotationInput = z.infer<typeof quotationSchema>;

export const quotationStatusSchema = z.object({ status: z.enum(QUOTATION_STATUSES) });

export const reminderSchema = z.object({
  quotationId: requiredText(40, "Quotation"),
  channel: z.enum(REMINDER_CHANNELS),
  dueAt: z.coerce.date(),
  note: optionalText(1000),
});
export type ReminderInput = z.infer<typeof reminderSchema>;

export const aiDraftSchema = z.object({
  inquiryId: requiredText(40, "Inquiry"),
  /** Optional free-text steer, e.g. "include installation and a 10% discount". */
  instructions: optionalText(2000),
});
export type AiDraftInput = z.infer<typeof aiDraftSchema>;

export const templateItemSchema = z.object({
  productId: optionalText(40),
  description: requiredText(400, "Item description"),
  quantity: z.coerce.number().positive("Quantity must be greater than zero.").max(1_000_000),
  unit: trimmed(24).default("unit"),
  unitPriceCents: z.coerce.number().int().min(0).max(1_000_000_000_00),
  taxRateBp: z.coerce.number().int().min(0).max(100_000),
});

export const templateSchema = z.object({
  name: requiredText(80, "Template name"),
  description: optionalText(400),
  titlePattern: optionalText(160),
  notes: optionalText(4000),
  terms: optionalText(4000),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .transform((v) => (v === "" ? undefined : v))
    .optional()
    .refine((v) => v === undefined || isKnownCurrency(v), {
      message: "That currency is not supported yet.",
    }),
  validityDays: z.coerce.number().int().min(1).max(365),
  requireSignature: z.coerce.boolean().default(false),
  isDefault: z.coerce.boolean().default(false),
  items: z
    .array(templateItemSchema)
    .min(1, "A template needs at least one line.")
    .max(100, "A template can hold at most 100 lines."),
});
export type TemplateFormInput = z.infer<typeof templateSchema>;

/**
 * The customer-facing response form. Deliberately strict about the typed
 * signature: it is the only evidence the acceptance was deliberate.
 */
export const publicResponseSchema = z
  .object({
    decision: z.enum(["accept", "reject"]),
    respondedByName: requiredText(160, "Your name"),
    signatureName: optionalText(160),
    signatureEmail: optionalEmail,
    rejectionReason: optionalText(1000),
    agreed: z.coerce.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.decision !== "accept") return;
    if (value.signatureName && value.signatureName.trim().length < 2) {
      ctx.addIssue({
        code: "custom",
        path: ["signatureName"],
        message: "Type your full name as your signature.",
      });
    }
  });
export type PublicResponseInput = z.infer<typeof publicResponseSchema>;

export const shareSettingsSchema = z.object({
  quotationId: requiredText(40, "Quotation"),
  action: z.enum(["enable", "disable", "rotate"]),
});

export const sendQuotationEmailSchema = z.object({
  quotationId: requiredText(40, "Quotation"),
  to: z.string().trim().toLowerCase().email("Enter a valid email address."),
  message: optionalText(2000),
});
export type SendQuotationEmailInput = z.infer<typeof sendQuotationEmailSchema>;

export const sendPortalEmailSchema = z.object({
  customerId: requiredText(40, "Customer"),
  to: z.string().trim().toLowerCase().email("Enter a valid email address."),
  message: optionalText(2000),
});

export const followUpDraftSchema = z.object({
  quotationId: requiredText(40, "Quotation"),
  reminderId: optionalText(40),
  instructions: optionalText(1000),
});
export type FollowUpDraftInput = z.infer<typeof followUpDraftSchema>;

/** Flatten a ZodError into `{ field: message }` for form rendering. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}
