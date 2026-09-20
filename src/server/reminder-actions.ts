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
import { AppError, NotFoundError } from "@/lib/errors";
import { optionalDate, text } from "@/lib/form";
import { requireSession } from "@/lib/session";
import { fieldErrors, reminderSchema } from "@/lib/validation";

export async function createReminderAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const session = await requireSession();
    const parsed = reminderSchema.safeParse({
      quotationId: text(formData, "quotationId"),
      channel: text(formData, "channel"),
      dueAt: optionalDate(formData, "dueAt"),
      note: text(formData, "note"),
    });
    if (!parsed.success) {
      return errorState("Please fix the highlighted fields.", fieldErrors(parsed.error));
    }

    const quotation = await prisma.quotation.findFirst({
      where: { id: parsed.data.quotationId, organizationId: session.organizationId },
      select: { id: true },
    });
    if (!quotation) throw new NotFoundError("Quotation not found.");

    await prisma.reminder.create({
      data: {
        organizationId: session.organizationId,
        quotationId: parsed.data.quotationId,
        channel: parsed.data.channel,
        dueAt: parsed.data.dueAt,
        note: parsed.data.note ?? null,
      },
    });

    revalidatePath("/reminders");
    revalidatePath(`/quotations/${parsed.data.quotationId}`);
    revalidatePath("/dashboard");
    return successState("Follow-up scheduled.");
  } catch (error) {
    if (isFrameworkError(error)) throw error;
    return toActionState(error);
  }
}

async function setReminderStatus(
  formData: FormData,
  status: "done" | "cancelled",
  message: string,
): Promise<ActionState> {
  const session = await requireSession();
  const id = text(formData, "id");
  if (!id) throw new NotFoundError("Reminder not found.");

  const reminder = await prisma.reminder.findFirst({
    where: { id, organizationId: session.organizationId },
    select: { id: true, status: true, quotationId: true },
  });
  if (!reminder) throw new NotFoundError("Reminder not found.");
  if (reminder.status !== "pending") {
    throw new AppError("That follow-up has already been closed.", { status: 409 });
  }

  await prisma.reminder.update({
    where: { id },
    data: { status, completedAt: status === "done" ? new Date() : null },
  });

  revalidatePath("/reminders");
  revalidatePath(`/quotations/${reminder.quotationId}`);
  revalidatePath("/dashboard");
  return successState(message);
}

export async function completeReminderAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    return await setReminderStatus(formData, "done", "Follow-up marked done.");
  } catch (error) {
    if (isFrameworkError(error)) throw error;
    return toActionState(error);
  }
}

export async function cancelReminderAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    return await setReminderStatus(formData, "cancelled", "Follow-up cancelled.");
  } catch (error) {
    if (isFrameworkError(error)) throw error;
    return toActionState(error);
  }
}

export async function snoozeReminderAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const session = await requireSession();
    const id = text(formData, "id");
    const days = Number(text(formData, "days") ?? "3");
    if (!id) throw new NotFoundError("Reminder not found.");
    if (!Number.isFinite(days) || days < 1 || days > 90) {
      throw new AppError("Choose between 1 and 90 days.");
    }

    const reminder = await prisma.reminder.findFirst({
      where: { id, organizationId: session.organizationId, status: "pending" },
      select: { id: true, dueAt: true, quotationId: true },
    });
    if (!reminder) throw new NotFoundError("Pending follow-up not found.");

    // Snooze from now, not from the original due date, so an overdue item
    // does not immediately come back as overdue.
    const base = reminder.dueAt.getTime() > Date.now() ? reminder.dueAt : new Date();
    await prisma.reminder.update({
      where: { id },
      data: { dueAt: new Date(base.getTime() + days * 24 * 60 * 60 * 1000) },
    });

    revalidatePath("/reminders");
    revalidatePath(`/quotations/${reminder.quotationId}`);
    revalidatePath("/dashboard");
    return successState(`Snoozed for ${days} day${days === 1 ? "" : "s"}.`);
  } catch (error) {
    if (isFrameworkError(error)) throw error;
    return toActionState(error);
  }
}
