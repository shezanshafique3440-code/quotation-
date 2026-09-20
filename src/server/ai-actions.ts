"use server";

import { revalidatePath } from "next/cache";
import {
  errorState,
  isFrameworkError,
  successState,
  toActionState,
  type ActionState,
} from "@/lib/action-state";
import { generateQuotationDraft } from "@/lib/ai";
import { mapDraftToQuotationInput } from "@/lib/ai-draft";
import { prisma } from "@/lib/db";
import { isAiConfigured } from "@/lib/env";
import { NotConfiguredError, NotFoundError } from "@/lib/errors";
import { text } from "@/lib/form";
import { createQuotation } from "@/lib/quotations";
import { requireSession } from "@/lib/session";
import { assertWithinLimit, recordUsage } from "@/lib/usage";
import { aiDraftSchema, fieldErrors } from "@/lib/validation";

/**
 * Turn an inquiry into an editable draft quotation.
 *
 * Nothing is persisted unless the model returns at least one usable line, and
 * the quotation is created in `draft` status — it is never treated as sent.
 */
export async function generateDraftAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const session = await requireSession();

    if (!isAiConfigured()) {
      throw new NotConfiguredError(
        "AI drafting is not enabled on this deployment. Ask your administrator to set AI_PROVIDER and ANTHROPIC_API_KEY, or build the quotation manually.",
      );
    }

    const parsed = aiDraftSchema.safeParse({
      inquiryId: text(formData, "inquiryId"),
      instructions: text(formData, "instructions"),
    });
    if (!parsed.success) {
      return errorState("Please fix the highlighted fields.", fieldErrors(parsed.error));
    }

    // Both meters are checked up front so we never spend a model call we
    // cannot turn into a saved quotation.
    await assertWithinLimit(session.organizationId, "aiDraftsPerMonth");
    await assertWithinLimit(session.organizationId, "quotationsPerMonth");

    const inquiry = await prisma.inquiry.findFirst({
      where: { id: parsed.data.inquiryId, organizationId: session.organizationId },
      include: { customer: true },
    });
    if (!inquiry) throw new NotFoundError("Inquiry not found.");

    const profile = await prisma.businessProfile.findUnique({
      where: { organizationId: session.organizationId },
    });
    if (!profile) {
      throw new NotFoundError("Complete your business profile before generating quotations.");
    }

    const catalog = await prisma.product.findMany({
      where: { organizationId: session.organizationId, active: true },
      orderBy: { name: "asc" },
      take: 200,
    });

    const result = await generateQuotationDraft({
      business: {
        legalName: profile.legalName,
        currency: profile.currency,
        defaultValidityDays: profile.defaultValidityDays,
        defaultTerms: profile.defaultTerms,
        defaultNotes: profile.defaultNotes,
      },
      customer: { name: inquiry.customer.name, company: inquiry.customer.company },
      inquiry: { subject: inquiry.subject, message: inquiry.message, channel: inquiry.channel },
      catalog: catalog.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        sku: p.sku,
        unit: p.unit,
        unitPriceCents: p.unitPriceCents,
      })),
      instructions: parsed.data.instructions,
    });

    const mapped = mapDraftToQuotationInput(result.draft, {
      customerId: inquiry.customerId,
      inquiryId: inquiry.id,
      currency: profile.currency,
      defaultTaxRateBp: profile.taxRateBp,
      defaultValidityDays: profile.defaultValidityDays,
      catalog: catalog.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        sku: p.sku,
        unit: p.unit,
        unitPriceCents: p.unitPriceCents,
        taxRateBp: p.taxRateBp,
      })),
    });

    const quotation = await createQuotation({
      organizationId: session.organizationId,
      userId: session.userId,
      input: mapped.input,
      numberPrefix: profile.quoteNumberPrefix,
      ai: { model: result.model },
    });

    await recordUsage(session.organizationId, "ai_draft");
    await recordUsage(session.organizationId, "quotation_created");
    await prisma.inquiry.updateMany({
      where: { id: inquiry.id, organizationId: session.organizationId, status: "new" },
      data: { status: "quoted" },
    });

    revalidatePath("/quotations");
    revalidatePath("/inquiries");
    revalidatePath(`/inquiries/${inquiry.id}`);
    revalidatePath("/dashboard");

    return successState(`Draft ${quotation.number} created from this inquiry.`, {
      quotationId: quotation.id,
      quotationNumber: quotation.number,
      summary: mapped.summary,
      rejected: mapped.rejected,
      model: result.model,
    });
  } catch (error) {
    if (isFrameworkError(error)) throw error;
    return toActionState(error);
  }
}
