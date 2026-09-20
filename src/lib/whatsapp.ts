import { AppError } from "./errors";
import { formatMoney } from "./money";
import type { QuotationWithRelations } from "./quotations";

/**
 * wa.me accepts digits only, in international format without a leading `+`.
 * Returns null when the input cannot be turned into a usable number — callers
 * must then show the copyable message instead of a broken link.
 */
export function normalizeWhatsAppNumber(input: string | null | undefined): string | null {
  if (!input) return null;
  const digits = input.replace(/[^\d]/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  return digits;
}

export function whatsappLink(number: string | null | undefined, message: string): string | null {
  const normalized = normalizeWhatsAppNumber(number);
  if (!normalized) return null;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
}

export interface MessageBusiness {
  legalName: string;
  locale: string;
  phone?: string | null;
  website?: string | null;
}

export interface MessageOptions {
  /** Public link to the quotation PDF, when the sender wants to include one. */
  documentUrl?: string | null;
  /** Free-text opener; falls back to a neutral default. */
  intro?: string | null;
}

function formatDate(date: Date, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/**
 * Build the plain-text message an owner sends over WhatsApp.
 *
 * QuoteFlow does not send WhatsApp messages itself: it produces the exact text
 * and a click-to-chat link that opens the owner's own WhatsApp.
 */
export function buildQuotationMessage(
  quotation: QuotationWithRelations,
  business: MessageBusiness,
  options: MessageOptions = {},
): string {
  const { locale } = business;
  const money = (cents: number) => formatMoney(cents, quotation.currency, locale);

  const lines: string[] = [];

  lines.push(options.intro?.trim() || `Hi ${quotation.customer.name.split(" ")[0] ?? "there"},`);
  lines.push("");
  lines.push(`Here is your quotation *${quotation.number}* — ${quotation.title}.`);
  lines.push("");

  for (const item of quotation.items) {
    const qty = Number.isInteger(item.quantity) ? String(item.quantity) : item.quantity.toFixed(2);
    lines.push(`• ${item.description} — ${qty} ${item.unit} × ${money(item.unitPriceCents)} = ${money(item.lineTotalCents)}`);
  }

  lines.push("");
  lines.push(`Subtotal: ${money(quotation.subtotalCents)}`);
  if (quotation.discountCents > 0) lines.push(`Discount: -${money(quotation.discountCents)}`);
  if (quotation.taxCents > 0) lines.push(`Tax: ${money(quotation.taxCents)}`);
  lines.push(`*Total: ${money(quotation.totalCents)}*`);

  if (quotation.validUntil) {
    lines.push("");
    lines.push(`Valid until ${formatDate(quotation.validUntil, locale)}.`);
  }

  if (quotation.notes?.trim()) {
    lines.push("");
    lines.push(quotation.notes.trim());
  }

  if (options.documentUrl) {
    lines.push("");
    lines.push(`Full quotation: ${options.documentUrl}`);
  }

  lines.push("");
  lines.push(`Happy to adjust anything — just reply here.`);
  lines.push(business.legalName);
  if (business.phone) lines.push(business.phone);
  if (business.website) lines.push(business.website);

  return lines.join("\n");
}

/** WhatsApp truncates extremely long messages; warn before the owner sends one. */
export const WHATSAPP_SOFT_LIMIT = 4096;

export function assertSendable(message: string): void {
  if (message.trim().length === 0) {
    throw new AppError("The WhatsApp message is empty.");
  }
}
