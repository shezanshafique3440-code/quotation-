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
import { checkbox, moneyCents, percentBp, text } from "@/lib/form";
import { requireSession } from "@/lib/session";
import { assertWithinLimit } from "@/lib/usage";
import { fieldErrors, productSchema } from "@/lib/validation";

function readForm(formData: FormData) {
  return productSchema.safeParse({
    name: text(formData, "name"),
    sku: text(formData, "sku"),
    description: text(formData, "description"),
    unitPriceCents: moneyCents(formData, "unitPrice"),
    unit: text(formData, "unit"),
    taxRateBp: percentBp(formData, "taxRate") ?? 0,
    active: checkbox(formData, "active"),
  });
}

function duplicateSku(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
}

export async function createProductAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const session = await requireSession();
    const parsed = readForm(formData);
    if (!parsed.success) {
      return errorState("Please fix the highlighted fields.", fieldErrors(parsed.error));
    }

    if (parsed.data.active) {
      await assertWithinLimit(session.organizationId, "products");
    }

    try {
      await prisma.product.create({
        data: { organizationId: session.organizationId, ...parsed.data, sku: parsed.data.sku ?? null },
      });
    } catch (error) {
      if (duplicateSku(error)) {
        return errorState("Please fix the highlighted fields.", {
          sku: "Another product already uses that SKU.",
        });
      }
      throw error;
    }

    revalidatePath("/products");
    return successState(`${parsed.data.name} added to your catalog.`);
  } catch (error) {
    if (isFrameworkError(error)) throw error;
    return toActionState(error);
  }
}

export async function updateProductAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const session = await requireSession();
    const id = text(formData, "id");
    if (!id) throw new NotFoundError("Product not found.");

    const parsed = readForm(formData);
    if (!parsed.success) {
      return errorState("Please fix the highlighted fields.", fieldErrors(parsed.error));
    }

    const existing = await prisma.product.findFirst({
      where: { id, organizationId: session.organizationId },
      select: { active: true },
    });
    if (!existing) throw new NotFoundError("Product not found.");

    // Re-activating consumes a catalog slot, so it is metered like a create.
    if (parsed.data.active && !existing.active) {
      await assertWithinLimit(session.organizationId, "products");
    }

    try {
      await prisma.product.update({
        where: { id },
        data: { ...parsed.data, sku: parsed.data.sku ?? null },
      });
    } catch (error) {
      if (duplicateSku(error)) {
        return errorState("Please fix the highlighted fields.", {
          sku: "Another product already uses that SKU.",
        });
      }
      throw error;
    }

    revalidatePath("/products");
    return successState("Product updated.");
  } catch (error) {
    if (isFrameworkError(error)) throw error;
    return toActionState(error);
  }
}

export async function deleteProductAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const session = await requireSession();
    const id = text(formData, "id");
    if (!id) throw new NotFoundError("Product not found.");

    const result = await prisma.product.deleteMany({
      where: { id, organizationId: session.organizationId },
    });
    if (result.count === 0) throw new NotFoundError("Product not found.");

    revalidatePath("/products");
    return successState("Product removed. Existing quotations keep their prices.");
  } catch (error) {
    if (isFrameworkError(error)) throw error;
    if (error instanceof AppError) return errorState(error.message);
    return toActionState(error);
  }
}
