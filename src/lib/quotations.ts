import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { AppError, NotFoundError } from "./errors";
import { computeTotals } from "./money";
import type { QuotationInput } from "./validation";

/** Full quotation shape used by detail views, the PDF and WhatsApp rendering. */
export const quotationInclude = {
  customer: true,
  inquiry: { select: { id: true, subject: true } },
  items: { orderBy: { position: "asc" } },
  reminders: { orderBy: { dueAt: "asc" } },
  template: { select: { id: true, name: true } },
} satisfies Prisma.QuotationInclude;

export type QuotationWithRelations = Prisma.QuotationGetPayload<{
  include: typeof quotationInclude;
}>;

/**
 * Allocate the next document number for an organization, e.g. `QT-2026-0007`.
 *
 * The sequence is derived from the highest existing number for the year rather
 * than a counter column, and the caller retries on the unique constraint, so two
 * concurrent creates can never share a number.
 */
export async function nextQuotationNumber(
  client: Prisma.TransactionClient | typeof prisma,
  organizationId: string,
  prefix: string,
  now: Date = new Date(),
): Promise<string> {
  const year = now.getUTCFullYear();
  const scope = `${prefix}-${year}-`;

  const latest = await client.quotation.findFirst({
    where: { organizationId, number: { startsWith: scope } },
    orderBy: { number: "desc" },
    select: { number: true },
  });

  const lastSeq = latest ? Number.parseInt(latest.number.slice(scope.length), 10) : 0;
  const nextSeq = Number.isFinite(lastSeq) ? lastSeq + 1 : 1;

  return `${scope}${String(nextSeq).padStart(4, "0")}`;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "P2002"
  );
}

interface CreateArgs {
  organizationId: string;
  userId: string;
  input: QuotationInput;
  numberPrefix: string;
  /** Reporting currency, stored alongside the rate for later analytics. */
  baseCurrency?: string;
  /** Workspace default, used when the form did not state a preference. */
  defaultRequireSignature?: boolean;
  ai?: { model: string } | null;
}

/**
 * Resolve the FX rate to store.
 *
 * Same currency is always exactly 1. A different currency keeps whatever the
 * user typed, or null — analytics exclude a null rather than guessing one.
 */
function resolveRate(
  currency: string,
  baseCurrency: string,
  supplied: number | undefined,
): number | null {
  if (currency.toUpperCase() === baseCurrency.toUpperCase()) return 1;
  return supplied !== undefined && Number.isFinite(supplied) && supplied > 0 ? supplied : null;
}

/** Validate tenant ownership of every referenced record, then persist atomically. */
export async function createQuotation({
  organizationId,
  userId,
  input,
  numberPrefix,
  baseCurrency = input.currency,
  defaultRequireSignature = false,
  ai = null,
}: CreateArgs): Promise<QuotationWithRelations> {
  const customer = await prisma.customer.findFirst({
    where: { id: input.customerId, organizationId },
    select: { id: true },
  });
  if (!customer) throw new NotFoundError("That customer does not exist in your workspace.");

  if (input.inquiryId) {
    const inquiry = await prisma.inquiry.findFirst({
      where: { id: input.inquiryId, organizationId },
      select: { id: true },
    });
    if (!inquiry) throw new NotFoundError("That inquiry does not exist in your workspace.");
  }

  const productIds = [...new Set(input.items.map((i) => i.productId).filter(Boolean))] as string[];
  if (productIds.length > 0) {
    const owned = await prisma.product.count({
      where: { id: { in: productIds }, organizationId },
    });
    if (owned !== productIds.length) {
      throw new NotFoundError("One or more line items reference a product outside your workspace.");
    }
  }

  if (input.templateId) {
    const template = await prisma.quotationTemplate.findFirst({
      where: { id: input.templateId, organizationId },
      select: { id: true },
    });
    if (!template) throw new NotFoundError("That template does not exist in your workspace.");
  }

  const totals = computeTotals(input.items, input.discountCents);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const number = await nextQuotationNumber(prisma, organizationId, numberPrefix);
    try {
      return await prisma.quotation.create({
        data: {
          organizationId,
          number,
          customerId: input.customerId,
          inquiryId: input.inquiryId ?? null,
          createdById: userId,
          status: "draft",
          title: input.title,
          currency: input.currency,
          subtotalCents: totals.subtotalCents,
          discountCents: totals.discountCents,
          taxCents: totals.taxCents,
          totalCents: totals.totalCents,
          notes: input.notes ?? null,
          terms: input.terms ?? null,
          validUntil: input.validUntil ?? null,
          requireSignature: input.requireSignature ?? defaultRequireSignature,
          templateId: input.templateId ?? null,
          baseCurrency,
          exchangeRateToBase: resolveRate(input.currency, baseCurrency, input.exchangeRateToBase),
          aiGenerated: Boolean(ai),
          aiModel: ai?.model ?? null,
          items: {
            create: input.items.map((item, index) => ({
              productId: item.productId ?? null,
              position: index,
              description: item.description,
              quantity: item.quantity,
              unit: item.unit,
              unitPriceCents: item.unitPriceCents,
              taxRateBp: item.taxRateBp,
              lineTotalCents: totals.lines[index]!.lineTotalCents,
            })),
          },
        },
        include: quotationInclude,
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // Another request took this number; recompute and try again.
    }
  }

  throw new AppError("Could not allocate a quotation number. Please try again.", { status: 503 });
}

/** Replace the editable fields and line items of a draft quotation. */
export async function updateQuotation(
  organizationId: string,
  quotationId: string,
  input: QuotationInput,
  options: { baseCurrency?: string } = {},
): Promise<QuotationWithRelations> {
  const existing = await prisma.quotation.findFirst({
    where: { id: quotationId, organizationId },
    select: { id: true, status: true },
  });
  if (!existing) throw new NotFoundError("Quotation not found.");
  if (existing.status !== "draft") {
    throw new AppError(
      "Only draft quotations can be edited. Move it back to draft first.",
      { status: 409, code: "not_editable" },
    );
  }

  const customer = await prisma.customer.findFirst({
    where: { id: input.customerId, organizationId },
    select: { id: true },
  });
  if (!customer) throw new NotFoundError("That customer does not exist in your workspace.");

  const productIds = [...new Set(input.items.map((i) => i.productId).filter(Boolean))] as string[];
  if (productIds.length > 0) {
    const owned = await prisma.product.count({
      where: { id: { in: productIds }, organizationId },
    });
    if (owned !== productIds.length) {
      throw new NotFoundError("One or more line items reference a product outside your workspace.");
    }
  }

  const baseCurrency = options.baseCurrency ?? input.currency;
  const totals = computeTotals(input.items, input.discountCents);

  return prisma.$transaction(async (tx) => {
    await tx.quotationItem.deleteMany({ where: { quotationId } });
    return tx.quotation.update({
      where: { id: quotationId },
      data: {
        customerId: input.customerId,
        inquiryId: input.inquiryId ?? null,
        title: input.title,
        currency: input.currency,
        subtotalCents: totals.subtotalCents,
        discountCents: totals.discountCents,
        taxCents: totals.taxCents,
        totalCents: totals.totalCents,
        notes: input.notes ?? null,
        terms: input.terms ?? null,
        validUntil: input.validUntil ?? null,
        requireSignature: input.requireSignature ?? false,
        baseCurrency,
        exchangeRateToBase: resolveRate(input.currency, baseCurrency, input.exchangeRateToBase),
        items: {
          create: input.items.map((item, index) => ({
            productId: item.productId ?? null,
            position: index,
            description: item.description,
            quantity: item.quantity,
            unit: item.unit,
            unitPriceCents: item.unitPriceCents,
            taxRateBp: item.taxRateBp,
            lineTotalCents: totals.lines[index]!.lineTotalCents,
          })),
        },
      },
      include: quotationInclude,
    });
  });
}

export async function getQuotation(
  organizationId: string,
  quotationId: string,
): Promise<QuotationWithRelations> {
  const quotation = await prisma.quotation.findFirst({
    where: { id: quotationId, organizationId },
    include: quotationInclude,
  });
  if (!quotation) throw new NotFoundError("Quotation not found.");
  return quotation;
}
