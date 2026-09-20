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
import { canTransition, QUOTATION_STATUS_LABELS, type QuotationStatus } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { AppError, NotFoundError } from "@/lib/errors";
import { lineItems, moneyCents, optionalDate, text } from "@/lib/form";
import { requireSession } from "@/lib/session";
import { assertWithinLimit, recordUsage } from "@/lib/usage";
import { createQuotation, updateQuotation } from "@/lib/quotations";
import { fieldErrors, quotationSchema, quotationStatusSchema } from "@/lib/validation";

function parseQuotationForm(formData: FormData) {
  return quotationSchema.safeParse({
    customerId: text(formData, "customerId"),
    inquiryId: text(formData, "inquiryId"),
    title: text(formData, "title"),
    currency: text(formData, "currency"),
    discountCents: moneyCents(formData, "discount") ?? 0,
    notes: text(formData, "notes"),
    terms: text(formData, "terms"),
    validUntil: optionalDate(formData, "validUntil"),
    items: lineItems(formData),
  });
}

export async function createQuotationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let createdId: string | null = null;

  try {
    const session = await requireSession();
    const parsed = parseQuotationForm(formData);
    if (!parsed.success) {
      return errorState("Please fix the highlighted fields.", fieldErrors(parsed.error));
    }

    await assertWithinLimit(session.organizationId, "quotationsPerMonth");

    const profile = await prisma.businessProfile.findUnique({
      where: { organizationId: session.organizationId },
      select: { quoteNumberPrefix: true },
    });

    const quotation = await createQuotation({
      organizationId: session.organizationId,
      userId: session.userId,
      input: parsed.data,
      numberPrefix: profile?.quoteNumberPrefix ?? "QT",
    });

    await recordUsage(session.organizationId, "quotation_created");
    if (parsed.data.inquiryId) {
      await prisma.inquiry.updateMany({
        where: { id: parsed.data.inquiryId, organizationId: session.organizationId, status: "new" },
        data: { status: "quoted" },
      });
    }

    createdId = quotation.id;
    revalidatePath("/quotations");
    revalidatePath("/dashboard");
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

    const parsed = parseQuotationForm(formData);
    if (!parsed.success) {
      return errorState("Please fix the highlighted fields.", fieldErrors(parsed.error));
    }

    await updateQuotation(session.organizationId, id, parsed.data);

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
      select: { status: true, inquiryId: true },
    });
    if (!quotation) throw new NotFoundError("Quotation not found.");

    const from = quotation.status as QuotationStatus;
    const to = parsed.data.status;
    if (from === to) return successState("No change — already " + QUOTATION_STATUS_LABELS[to] + ".");
    if (!canTransition(from, to)) {
      throw new AppError(
        `A ${QUOTATION_STATUS_LABELS[from].toLowerCase()} quotation cannot be moved to ${QUOTATION_STATUS_LABELS[to].toLowerCase()}.`,
        { status: 409, code: "invalid_transition" },
      );
    }

    const now = new Date();
    await prisma.quotation.update({
      where: { id },
      data: {
        status: to,
        sentAt: to === "sent" ? now : undefined,
        decidedAt: to === "accepted" || to === "rejected" ? now : to === "draft" ? null : undefined,
      },
    });

    if (to === "accepted" && quotation.inquiryId) {
      await prisma.inquiry.updateMany({
        where: { id: quotation.inquiryId, organizationId: session.organizationId },
        data: { status: "won" },
      });
    }

    // A decided quotation no longer needs chasing.
    if (to === "accepted" || to === "rejected") {
      await prisma.reminder.updateMany({
        where: { quotationId: id, organizationId: session.organizationId, status: "pending" },
        data: { status: "cancelled" },
      });
    }

    revalidatePath("/quotations");
    revalidatePath(`/quotations/${id}`);
    revalidatePath("/dashboard");
    revalidatePath("/reminders");
    return successState(`Marked as ${QUOTATION_STATUS_LABELS[to].toLowerCase()}.`);
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
      select: { status: true },
    });
    if (!quotation) throw new NotFoundError("Quotation not found.");
    if (quotation.status !== "draft") {
      return errorState(
        "Only drafts can be deleted. Sent quotations are kept so your history stays accurate.",
      );
    }

    await prisma.quotation.delete({ where: { id } });
    revalidatePath("/quotations");
    revalidatePath("/dashboard");
  } catch (error) {
    if (isFrameworkError(error)) throw error;
    return toActionState(error);
  }

  redirect("/quotations");
}
