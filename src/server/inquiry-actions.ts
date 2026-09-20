"use server";

import { revalidatePath } from "next/cache";
import {
  errorState,
  isFrameworkError,
  successState,
  toActionState,
  type ActionState,
} from "@/lib/action-state";
import { prisma } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { optionalDate, text } from "@/lib/form";
import { requireSession } from "@/lib/session";
import { fieldErrors, inquirySchema, inquiryStatusSchema } from "@/lib/validation";

export async function createInquiryAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const session = await requireSession();
    const parsed = inquirySchema.safeParse({
      customerId: text(formData, "customerId"),
      channel: text(formData, "channel"),
      subject: text(formData, "subject"),
      message: text(formData, "message"),
      receivedAt: optionalDate(formData, "receivedAt"),
    });
    if (!parsed.success) {
      return errorState("Please fix the highlighted fields.", fieldErrors(parsed.error));
    }

    const customer = await prisma.customer.findFirst({
      where: { id: parsed.data.customerId, organizationId: session.organizationId },
      select: { id: true },
    });
    if (!customer) throw new NotFoundError("That customer does not exist in your workspace.");

    const inquiry = await prisma.inquiry.create({
      data: {
        organizationId: session.organizationId,
        customerId: parsed.data.customerId,
        channel: parsed.data.channel,
        subject: parsed.data.subject,
        message: parsed.data.message,
        receivedAt: parsed.data.receivedAt ?? new Date(),
      },
    });

    revalidatePath("/inquiries");
    revalidatePath("/dashboard");
    return successState("Inquiry logged.", { id: inquiry.id });
  } catch (error) {
    if (isFrameworkError(error)) throw error;
    return toActionState(error);
  }
}

export async function updateInquiryStatusAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const session = await requireSession();
    const id = text(formData, "id");
    if (!id) throw new NotFoundError("Inquiry not found.");

    const parsed = inquiryStatusSchema.safeParse({ status: text(formData, "status") });
    if (!parsed.success) return errorState("That is not a valid inquiry status.");

    const result = await prisma.inquiry.updateMany({
      where: { id, organizationId: session.organizationId },
      data: { status: parsed.data.status },
    });
    if (result.count === 0) throw new NotFoundError("Inquiry not found.");

    revalidatePath("/inquiries");
    revalidatePath(`/inquiries/${id}`);
    revalidatePath("/dashboard");
    return successState("Inquiry updated.");
  } catch (error) {
    if (isFrameworkError(error)) throw error;
    return toActionState(error);
  }
}

export async function deleteInquiryAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const session = await requireSession();
    const id = text(formData, "id");
    if (!id) throw new NotFoundError("Inquiry not found.");

    const result = await prisma.inquiry.deleteMany({
      where: { id, organizationId: session.organizationId },
    });
    if (result.count === 0) throw new NotFoundError("Inquiry not found.");

    revalidatePath("/inquiries");
    revalidatePath("/dashboard");
    return successState("Inquiry deleted.");
  } catch (error) {
    if (isFrameworkError(error)) throw error;
    return toActionState(error);
  }
}
