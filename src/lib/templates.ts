import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { AppError, NotFoundError } from "./errors";
import { defaultValidUntil } from "./follow-ups";
import type { QuotationInput } from "./validation";

export const templateInclude = {
  items: { orderBy: { position: "asc" } },
} satisfies Prisma.QuotationTemplateInclude;

export type TemplateWithItems = Prisma.QuotationTemplateGetPayload<{
  include: typeof templateInclude;
}>;

export interface TemplateInput {
  name: string;
  description?: string | undefined;
  titlePattern?: string | undefined;
  notes?: string | undefined;
  terms?: string | undefined;
  validityDays: number;
  requireSignature: boolean;
  currency?: string | undefined;
  isDefault: boolean;
  items: {
    productId?: string | undefined;
    description: string;
    quantity: number;
    unit: string;
    unitPriceCents: number;
    taxRateBp: number;
  }[];
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
}

async function assertProductsOwned(organizationId: string, input: TemplateInput): Promise<void> {
  const ids = [...new Set(input.items.map((i) => i.productId).filter(Boolean))] as string[];
  if (ids.length === 0) return;

  const owned = await prisma.product.count({ where: { id: { in: ids }, organizationId } });
  if (owned !== ids.length) {
    throw new NotFoundError("A template line references a product outside your workspace.");
  }
}

export async function createTemplate(
  organizationId: string,
  input: TemplateInput,
): Promise<TemplateWithItems> {
  await assertProductsOwned(organizationId, input);

  try {
    return await prisma.$transaction(async (tx) => {
      if (input.isDefault) {
        await tx.quotationTemplate.updateMany({
          where: { organizationId, isDefault: true },
          data: { isDefault: false },
        });
      }
      return tx.quotationTemplate.create({
        data: {
          organizationId,
          name: input.name,
          description: input.description ?? null,
          titlePattern: input.titlePattern ?? null,
          notes: input.notes ?? null,
          terms: input.terms ?? null,
          validityDays: input.validityDays,
          requireSignature: input.requireSignature,
          currency: input.currency ?? null,
          isDefault: input.isDefault,
          items: {
            create: input.items.map((item, index) => ({
              productId: item.productId ?? null,
              position: index,
              description: item.description,
              quantity: item.quantity,
              unit: item.unit,
              unitPriceCents: item.unitPriceCents,
              taxRateBp: item.taxRateBp,
            })),
          },
        },
        include: templateInclude,
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError("You already have a template with that name.", {
        status: 409,
        code: "duplicate_name",
      });
    }
    throw error;
  }
}

export async function updateTemplate(
  organizationId: string,
  templateId: string,
  input: TemplateInput,
): Promise<TemplateWithItems> {
  const existing = await prisma.quotationTemplate.findFirst({
    where: { id: templateId, organizationId },
    select: { id: true },
  });
  if (!existing) throw new NotFoundError("Template not found.");

  await assertProductsOwned(organizationId, input);

  try {
    return await prisma.$transaction(async (tx) => {
      if (input.isDefault) {
        await tx.quotationTemplate.updateMany({
          where: { organizationId, isDefault: true, NOT: { id: templateId } },
          data: { isDefault: false },
        });
      }
      await tx.quotationTemplateItem.deleteMany({ where: { templateId } });
      return tx.quotationTemplate.update({
        where: { id: templateId },
        data: {
          name: input.name,
          description: input.description ?? null,
          titlePattern: input.titlePattern ?? null,
          notes: input.notes ?? null,
          terms: input.terms ?? null,
          validityDays: input.validityDays,
          requireSignature: input.requireSignature,
          currency: input.currency ?? null,
          isDefault: input.isDefault,
          items: {
            create: input.items.map((item, index) => ({
              productId: item.productId ?? null,
              position: index,
              description: item.description,
              quantity: item.quantity,
              unit: item.unit,
              unitPriceCents: item.unitPriceCents,
              taxRateBp: item.taxRateBp,
            })),
          },
        },
        include: templateInclude,
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError("You already have a template with that name.", {
        status: 409,
        code: "duplicate_name",
      });
    }
    throw error;
  }
}

export async function deleteTemplate(organizationId: string, templateId: string): Promise<void> {
  const { count } = await prisma.quotationTemplate.deleteMany({
    where: { id: templateId, organizationId },
  });
  if (count === 0) throw new NotFoundError("Template not found.");
}

export async function getTemplate(
  organizationId: string,
  templateId: string,
): Promise<TemplateWithItems> {
  const template = await prisma.quotationTemplate.findFirst({
    where: { id: templateId, organizationId },
    include: templateInclude,
  });
  if (!template) throw new NotFoundError("Template not found.");
  return template;
}

export interface ApplyContext {
  customerId: string;
  customerName: string;
  inquiryId?: string | undefined;
  inquirySubject?: string | undefined;
  fallbackCurrency: string;
  timezone: string;
  now?: Date;
}

/**
 * Turn a template into quotation input, ready for the editor.
 *
 * `titlePattern` supports `{customer}`, `{subject}` and `{date}`; an unknown
 * placeholder is left as written rather than replaced with "undefined".
 */
export function applyTemplate(
  template: TemplateWithItems,
  context: ApplyContext,
): QuotationInput {
  const now = context.now ?? new Date();
  const currency = template.currency ?? context.fallbackCurrency;

  const title = (template.titlePattern ?? "{subject}")
    .replace(/\{customer\}/g, context.customerName)
    .replace(/\{subject\}/g, context.inquirySubject ?? template.name)
    .replace(/\{date\}/g, now.toISOString().slice(0, 10))
    .trim();

  return {
    customerId: context.customerId,
    inquiryId: context.inquiryId,
    title: (title || template.name).slice(0, 160),
    currency,
    discountCents: 0,
    notes: template.notes ?? undefined,
    terms: template.terms ?? undefined,
    validUntil: defaultValidUntil(now, template.validityDays, context.timezone),
    items: template.items.map((item) => ({
      productId: item.productId ?? undefined,
      description: item.description,
      quantity: item.quantity,
      unit: item.unit,
      unitPriceCents: item.unitPriceCents,
      taxRateBp: item.taxRateBp,
    })),
  };
}
