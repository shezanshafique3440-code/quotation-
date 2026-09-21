"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  errorState,
  isFrameworkError,
  successState,
  toActionState,
  type ActionState,
} from "@/lib/action-state";
import { ACTIVITY_KINDS, recordActivity, recordActivityTx } from "@/lib/activity";
import { canTransition, QUOTATION_STATUS_LABELS, type QuotationStatus } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { AppError, NotFoundError } from "@/lib/errors";
import { expiryDate, lineItems, moneyCents, optionalNumber, text } from "@/lib/form";
import { scheduleAutoFollowUp } from "@/lib/follow-ups";
import { createQuotation, updateQuotation } from "@/lib/quotations";
import { requireSession } from "@/lib/session";
import { loadTenantProfile } from "@/lib/tenant";
import { assertWithinLimit, recordUsage } from "@/lib/usage";
import { fieldErrors, quotationSchema, quotationStatusSchema } from "@/lib/validation";

/**
 * Parse the editor form.
 *
 * Money is scaled by the currency the form was rendered in, and the validity
 * date is resolved to the end of that day in the business's own timezone.
 */
function parseQuotationForm(formData: FormData, timezone: string) {
  const currency = (text(formData, "currency") ?? "USD").trim().toUpperCase();

  return quotationSchema.safeParse({
    customerId: text(formData, "customerId"),
    inquiryId: text(formData, "inquiryId"),
    templateId: text(formData, "templateId"),
    title: text(formData, "title"),
    currency,
    discountCents: moneyCents(formData, "discount", currency) ?? 0,
    notes: text(formData, "notes"),
    terms: text(formData, "terms"),
    validUntil: expiryDate(formData, "validUntil", timezone),
    requireSignature: formData.get("requireSignature") === "on",
    exchangeRateToBase: optionalNumber(formData, "exchangeRateToBase"),
    items: lineItems(formData, currency),
  });
}

export async function createQuotationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let createdId: string | null = null;

  try {
    const session = await requireSession();
    const profile = await loadTenantProfile(session.organizationId, session.organization.name);

    const parsed = parseQuotationForm(formData, profile.timezone);
    if (!parsed.success) {
      return errorState("Please fix the highlighted fields.", fieldErrors(parsed.error));
    }

    await assertWithinLimit(session.organizationId, "quotationsPerMonth");

    const quotation = await createQuotation({
      organizationId: session.organizationId,
      userId: session.userId,
      input: parsed.data,
      numberPrefix: profile.quoteNumberPrefix,
      baseCurrency: profile.currency,
      defaultRequireSignature: profile.requireSignature,
    });

    await recordUsage(session.organizationId, "quotation_created");
    if (parsed.data.inquiryId) {
      await prisma.inquiry.updateMany({
        where: { id: parsed.data.inquiryId, organizationId: session.organizationId, status: "new" },
        data: { status: "quoted" },
      });
    }

    await recordActivity({
      organizationId: session.organizationId,
      category: "quotation",
      kind: ACTIVITY_KINDS.quotationCreated,
      summary: `${session.user.name} created ${quotation.number}`,
      actorType: "user",
      actorId: session.userId,
      actorLabel: session.user.name,
      quotationId: quotation.id,
      customerId: quotation.customerId,
      metadata: { totalCents: quotation.totalCents, currency: quotation.currency },
    });

    createdId = quotation.id;
    revalidatePath("/quotations");
    revalidatePath("/dashboard");
    revalidatePath("/analytics");
  } catch (error) {
    if (isFrameworkError(error)) throw error;
    return toActionState(error);
  }

  redirect(`/quotations/${createdId}`);
}

export async function updateQuotationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const session = await requireSession();
    const id = text(formData, "id");
    if (!id) throw new NotFoundError("Quotation not found.");

    const profile = await loadTenantProfile(session.organizationId, session.organization.name);
    const parsed = parseQuotationForm(formData, profile.timezone);
    if (!parsed.success) {
      return errorState("Please fix the highlighted fields.", fieldErrors(parsed.error));
    }

    const quotation = await updateQuotation(session.organizationId, id, parsed.data, {
      baseCurrency: profile.currency,
    });

    await recordActivity({
      organizationId: session.organizationId,
      category: "quotation",
      kind: ACTIVITY_KINDS.quotationUpdated,
      summary: `${session.user.name} edited ${quotation.number}`,
      actorType: "user",
      actorId: session.userId,
      actorLabel: session.user.name,
      quotationId: quotation.id,
      customerId: quotation.customerId,
      metadata: { totalCents: quotation.totalCents, currency: quotation.currency },
    });

    revalidatePath("/quotations");
    revalidatePath(`/quotations/${id}`);
    revalidatePath("/dashboard");
    return successState("Quotation saved.");
  } catch (error) {
    if (isFrameworkError(error)) throw error;
    return toActionState(error);
  }
}

export async function updateQuotationStatusAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const session = await requireSession();
    const id = text(formData, "id");
    if (!id) throw new NotFoundError("Quotation not found.");

    const parsed = quotationStatusSchema.safeParse({ status: text(formData, "status") });
    if (!parsed.success) return errorState("That is not a valid quotation status.");

    const quotation = await prisma.quotation.findFirst({
      where: { id, organizationId: session.organizationId },
      select: {
        id: true,
        status: true,
        number: true,
        customerId: true,
        inquiryId: true,
        validUntil: true,
        organizationId: true,
      },
    });
    if (!quotation) throw new NotFoundError("Quotation not found.");

    const from = quotation.status as QuotationStatus;
    const to = parsed.data.status;
    if (from === to) return successState(`No change — already ${QUOTATION_STATUS_LABELS[to]}.`);
    if (!canTransition(from, to)) {
      throw new AppError(
        `A ${QUOTATION_STATUS_LABELS[from].toLowerCase()} quotation cannot be moved to ${QUOTATION_STATUS_LABELS[to].toLowerCase()}.`,
        { status: 409, code: "invalid_transition" },
      );
    }

    const profile = await loadTenantProfile(session.organizationId, session.organization.name);
    const now = new Date();
    let followUpNote = "";

    await prisma.$transaction(async (tx) => {
      await tx.quotation.update({
        where: { id },
        data: {
          status: to,
          sentAt: to === "sent" ? now : undefined,
          decidedAt:
            to === "accepted" || to === "rejected" ? now : to === "draft" ? null : undefined,
          decisionSource: to === "accepted" || to === "rejected" ? "internal" : undefined,
        },
      });

      if (to === "accepted" && quotation.inquiryId) {
        await tx.inquiry.updateMany({
          where: { id: quotation.inquiryId, organizationId: session.organizationId },
          data: { status: "won" },
        });
      }

      // A decided quotation no longer needs chasing.
      if (to === "accepted" || to === "rejected") {
        await tx.reminder.updateMany({
          where: { quotationId: id, organizationId: session.organizationId, status: "pending" },
          data: { status: "cancelled" },
        });
      }

      await recordActivityTx(tx, {
        organizationId: session.organizationId,
        category: "quotation",
        kind:
          to === "sent"
            ? ACTIVITY_KINDS.quotationSent
            : to === "accepted"
              ? ACTIVITY_KINDS.quotationAccepted
              : to === "rejected"
                ? ACTIVITY_KINDS.quotationRejected
                : to === "expired"
                  ? ACTIVITY_KINDS.quotationExpired
                  : ACTIVITY_KINDS.quotationReopened,
        summary: `${session.user.name} marked ${quotation.number} as ${QUOTATION_STATUS_LABELS[to].toLowerCase()}`,
        actorType: "user",
        actorId: session.userId,
        actorLabel: session.user.name,
        quotationId: id,
        customerId: quotation.customerId,
        metadata: { from, to, source: "internal" },
      });

      if (to === "sent") {
        const scheduled = await scheduleAutoFollowUp(
          tx,
          {
            id: quotation.id,
            organizationId: quotation.organizationId,
            customerId: quotation.customerId,
            number: quotation.number,
            validUntil: quotation.validUntil,
          },
          {
            enabled: profile.autoFollowUpEnabled,
            days: profile.autoFollowUpDays,
            timezone: profile.timezone,
          },
          now,
        );
        if (scheduled.scheduled) {
          followUpNote = ` A follow-up was scheduled for ${scheduled.dueAt!.toISOString().slice(0, 10)}.`;
        }
      }
    });

    revalidatePath("/quotations");
    revalidatePath(`/quotations/${id}`);
    revalidatePath("/dashboard");
    revalidatePath("/reminders");
    revalidatePath("/analytics");
    return successState(`Marked as ${QUOTATION_STATUS_LABELS[to].toLowerCase()}.${followUpNote}`);
  } catch (error) {
    if (isFrameworkError(error)) throw error;
    return toActionState(error);
  }
}

export async function deleteQuotationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const session = await requireSession();
    const id = text(formData, "id");
    if (!id) throw new NotFoundError("Quotation not found.");

    const quotation = await prisma.quotation.findFirst({
      where: { id, organizationId: session.organizationId },
      select: { status: true, number: true, customerId: true },
    });
    if (!quotation) throw new NotFoundError("Quotation not found.");
    if (quotation.status !== "draft") {
      return errorState(
        "Only drafts can be deleted. Sent quotations are kept so your history stays accurate.",
      );
    }

    await prisma.quotation.delete({ where: { id } });

    // The quotation row is gone, so this event keeps only the customer link.
    await recordActivity({
      organizationId: session.organizationId,
      category: "quotation",
      kind: ACTIVITY_KINDS.quotationDeleted,
      summary: `${session.user.name} deleted draft ${quotation.number}`,
      actorType: "user",
      actorId: session.userId,
      actorLabel: session.user.name,
      customerId: quotation.customerId,
      metadata: { number: quotation.number },
    });

    revalidatePath("/quotations");
    revalidatePath("/dashboard");
  } catch (error) {
    if (isFrameworkError(error)) throw error;
    return toActionState(error);
  }

  redirect("/quotations");
}
