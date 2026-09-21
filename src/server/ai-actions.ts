"use server";

import { revalidatePath } from "next/cache";
import {
  errorState,
  isFrameworkError,
  successState,
  toActionState,
  type ActionState,
} from "@/lib/action-state";
import { generateFollowUpMessage, generateQuotationDraft } from "@/lib/ai";
import { mapDraftToQuotationInput } from "@/lib/ai-draft";
import { prisma } from "@/lib/db";
import { isAiConfigured } from "@/lib/env";
import { NotConfiguredError, NotFoundError } from "@/lib/errors";
import { text } from "@/lib/form";
import { createQuotation } from "@/lib/quotations";
import { requireSession } from "@/lib/session";
import { assertWithinLimit, recordUsage } from "@/lib/usage";
import { ACTIVITY_KINDS, recordActivity } from "@/lib/activity";
import { enforceRateLimit } from "@/lib/rate-limit";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { loadTenantProfile } from "@/lib/tenant";
import { aiDraftSchema, fieldErrors, followUpDraftSchema } from "@/lib/validation";

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
    await enforceRateLimit("aiGenerate", `org:${session.organizationId}`);
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
      baseCurrency: profile.currency,
      defaultRequireSignature: profile.requireSignature,
      ai: { model: result.model },
    });

    await recordUsage(session.organizationId, "ai_draft");
    await recordUsage(session.organizationId, "quotation_created");
    await prisma.inquiry.updateMany({
      where: { id: inquiry.id, organizationId: session.organizationId, status: "new" },
      data: { status: "quoted" },
    });

    await recordActivity({
      organizationId: session.organizationId,
      category: "quotation",
      kind: ACTIVITY_KINDS.aiDrafted,
      summary: `AI drafted ${quotation.number} from the inquiry "${inquiry.subject}"`,
      actorType: "user",
      actorId: session.userId,
      actorLabel: session.user.name,
      quotationId: quotation.id,
      customerId: inquiry.customerId,
      metadata: {
        model: result.model,
        droppedLines: mapped.rejected.length,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
      },
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


/**
 * Draft a follow-up message for a quotation that has gone quiet.
 *
 * The draft is saved against the reminder so the owner can find it again, and
 * nothing is sent. Follow-up drafts are never delivered by QuoteFlow — the
 * owner copies the text and sends it themselves, and the UI says so.
 */
export async function draftFollowUpAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const session = await requireSession();

    if (!isAiConfigured()) {
      throw new NotConfiguredError(
        "AI drafting is not enabled on this deployment. Ask your administrator to set AI_PROVIDER and ANTHROPIC_API_KEY, or write the follow-up yourself.",
      );
    }

    const parsed = followUpDraftSchema.safeParse({
      quotationId: text(formData, "quotationId"),
      reminderId: text(formData, "reminderId"),
      instructions: text(formData, "instructions"),
    });
    if (!parsed.success) {
      return errorState("Please fix the highlighted fields.", fieldErrors(parsed.error));
    }

    await enforceRateLimit("aiGenerate", `org:${session.organizationId}`);
    await assertWithinLimit(session.organizationId, "aiDraftsPerMonth");

    const quotation = await prisma.quotation.findFirst({
      where: { id: parsed.data.quotationId, organizationId: session.organizationId },
      include: { customer: true },
    });
    if (!quotation) throw new NotFoundError("Quotation not found.");

    const profile = await loadTenantProfile(session.organizationId, session.organization.name);

    const previousFollowUps = await prisma.reminder.count({
      where: { quotationId: quotation.id, status: "done" },
    });

    const sentAgoDays = quotation.sentAt
      ? Math.max(0, Math.round((Date.now() - quotation.sentAt.getTime()) / 86_400_000))
      : null;

    const result = await generateFollowUpMessage({
      business: { legalName: profile.legalName, senderName: session.user.name },
      customer: { name: quotation.customer.name, company: quotation.customer.company },
      quotation: {
        number: quotation.number,
        title: quotation.title,
        totalFormatted: formatMoney(quotation.totalCents, quotation.currency, profile.locale),
        status: quotation.status,
        sentAgoDays,
        validUntilFormatted: quotation.validUntil
          ? formatDate(quotation.validUntil, profile.locale, profile.timezone)
          : null,
        viewCount: quotation.viewCount,
        everViewed: quotation.firstViewedAt !== null,
        notes: quotation.notes,
      },
      previousFollowUps,
      instructions: parsed.data.instructions,
    });

    await recordUsage(session.organizationId, "ai_draft");

    if (parsed.data.reminderId) {
      await prisma.reminder.updateMany({
        where: {
          id: parsed.data.reminderId,
          organizationId: session.organizationId,
          quotationId: quotation.id,
        },
        data: { messageDraft: result.draft.whatsapp_message.slice(0, 4000) },
      });
    }

    await recordActivity({
      organizationId: session.organizationId,
      category: "quotation",
      kind: ACTIVITY_KINDS.aiFollowUpDrafted,
      summary: `AI drafted a follow-up for ${quotation.number}`,
      actorType: "user",
      actorId: session.userId,
      actorLabel: session.user.name,
      quotationId: quotation.id,
      customerId: quotation.customerId,
      metadata: { model: result.model },
    });

    revalidatePath(`/quotations/${quotation.id}`);
    revalidatePath("/reminders");

    return successState("Follow-up drafted. Review it, then send it yourself.", {
      whatsappMessage: result.draft.whatsapp_message,
      emailSubject: result.draft.email_subject,
      emailBody: result.draft.email_body,
      model: result.model,
    });
  } catch (error) {
    if (isFrameworkError(error)) throw error;
    return toActionState(error);
  }
}
