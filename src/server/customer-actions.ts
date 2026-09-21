"use server";

import { revalidatePath } from "next/cache";
import {
  errorState,
  isFrameworkError,
  successState,
  toActionState,
  type ActionState,
} from "@/lib/action-state";
import { ACTIVITY_KINDS, recordActivity } from "@/lib/activity";
import { prisma } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { text } from "@/lib/form";
import { requireSession } from "@/lib/session";
import { customerSchema, fieldErrors } from "@/lib/validation";

function readForm(formData: FormData) {
  return customerSchema.safeParse({
    name: text(formData, "name"),
    company: text(formData, "company"),
    email: text(formData, "email"),
    phone: text(formData, "phone"),
    whatsapp: text(formData, "whatsapp"),
    notes: text(formData, "notes"),
  });
}

export async function createCustomerAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const session = await requireSession();
    const parsed = readForm(formData);
    if (!parsed.success) {
      return errorState("Please fix the highlighted fields.", fieldErrors(parsed.error));
    }

    const customer = await prisma.customer.create({
      data: { organizationId: session.organizationId, ...parsed.data },
    });

    await recordActivity({
      organizationId: session.organizationId,
      category: "customer",
      kind: ACTIVITY_KINDS.customerCreated,
      summary: `${session.user.name} added ${customer.name}`,
      actorType: "user",
      actorId: session.userId,
      actorLabel: session.user.name,
      customerId: customer.id,
    });

    revalidatePath("/customers");
    revalidatePath("/inquiries");
    return successState(`${customer.name} added.`, { id: customer.id });
  } catch (error) {
    if (isFrameworkError(error)) throw error;
    return toActionState(error);
  }
}

export async function updateCustomerAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const session = await requireSession();
    const id = text(formData, "id");
    if (!id) throw new NotFoundError("Customer not found.");

    const parsed = readForm(formData);
    if (!parsed.success) {
      return errorState("Please fix the highlighted fields.", fieldErrors(parsed.error));
    }

    const result = await prisma.customer.updateMany({
      where: { id, organizationId: session.organizationId },
      data: parsed.data,
    });
    if (result.count === 0) throw new NotFoundError("Customer not found.");

    await recordActivity({
      organizationId: session.organizationId,
      category: "customer",
      kind: ACTIVITY_KINDS.customerUpdated,
      summary: `${session.user.name} updated ${parsed.data.name}`,
      actorType: "user",
      actorId: session.userId,
      actorLabel: session.user.name,
      customerId: id,
    });

    revalidatePath("/customers");
    revalidatePath(`/customers/${id}`);
    return successState("Customer updated.");
  } catch (error) {
    if (isFrameworkError(error)) throw error;
    return toActionState(error);
  }
}

export async function deleteCustomerAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const session = await requireSession();
    const id = text(formData, "id");
    if (!id) throw new NotFoundError("Customer not found.");

    const quotations = await prisma.quotation.count({
      where: { customerId: id, organizationId: session.organizationId },
    });
    if (quotations > 0) {
      return errorState(
        `This customer has ${quotations} quotation${quotations === 1 ? "" : "s"}. Deleting them would delete that history too, so removal is blocked.`,
      );
    }

    const result = await prisma.customer.deleteMany({
      where: { id, organizationId: session.organizationId },
    });
    if (result.count === 0) throw new NotFoundError("Customer not found.");

    revalidatePath("/customers");
    return successState("Customer deleted.");
  } catch (error) {
    if (isFrameworkError(error)) throw error;
    return toActionState(error);
  }
}
