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
import { NotFoundError } from "@/lib/errors";
import { lineItems, text } from "@/lib/form";
import { requireSession } from "@/lib/session";
import { loadTenantProfile } from "@/lib/tenant";
import { createTemplate, deleteTemplate, updateTemplate } from "@/lib/templates";
import { fieldErrors, templateSchema } from "@/lib/validation";

function parseTemplateForm(formData: FormData, fallbackCurrency: string) {
  const currency = (text(formData, "currency") ?? "").trim().toUpperCase();
  const scale = currency === "" ? fallbackCurrency : currency;

  return templateSchema.safeParse({
    name: text(formData, "name"),
    description: text(formData, "description"),
    titlePattern: text(formData, "titlePattern"),
    notes: text(formData, "notes"),
    terms: text(formData, "terms"),
    currency,
    validityDays: text(formData, "validityDays"),
    requireSignature: formData.get("requireSignature") === "on",
    isDefault: formData.get("isDefault") === "on",
    items: lineItems(formData, scale),
  });
}

export async function createTemplateAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const session = await requireSession();
    const profile = await loadTenantProfile(session.organizationId, session.organization.name);

    const parsed = parseTemplateForm(formData, profile.currency);
    if (!parsed.success) {
      return errorState("Please fix the highlighted fields.", fieldErrors(parsed.error));
    }

    const template = await createTemplate(session.organizationId, parsed.data);

    await recordActivity({
      organizationId: session.organizationId,
      category: "settings",
      kind: ACTIVITY_KINDS.templateCreated,
      summary: `${session.user.name} created the "${template.name}" template`,
      actorType: "user",
      actorId: session.userId,
      actorLabel: session.user.name,
      metadata: { templateId: template.id, lines: template.items.length },
    });

    revalidatePath("/templates");
    revalidatePath("/quotations/new");
    return successState(`Template "${template.name}" saved.`);
  } catch (error) {
    if (isFrameworkError(error)) throw error;
    return toActionState(error);
  }
}

export async function updateTemplateAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const session = await requireSession();
    const id = text(formData, "id");
    if (!id) throw new NotFoundError("Template not found.");

    const profile = await loadTenantProfile(session.organizationId, session.organization.name);
    const parsed = parseTemplateForm(formData, profile.currency);
    if (!parsed.success) {
      return errorState("Please fix the highlighted fields.", fieldErrors(parsed.error));
    }

    const template = await updateTemplate(session.organizationId, id, parsed.data);

    await recordActivity({
      organizationId: session.organizationId,
      category: "settings",
      kind: ACTIVITY_KINDS.templateUpdated,
      summary: `${session.user.name} updated the "${template.name}" template`,
      actorType: "user",
      actorId: session.userId,
      actorLabel: session.user.name,
      metadata: { templateId: template.id },
    });

    revalidatePath("/templates");
    revalidatePath("/quotations/new");
    return successState("Template updated.");
  } catch (error) {
    if (isFrameworkError(error)) throw error;
    return toActionState(error);
  }
}

export async function deleteTemplateAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const session = await requireSession();
    const id = text(formData, "id");
    if (!id) throw new NotFoundError("Template not found.");

    await deleteTemplate(session.organizationId, id);

    await recordActivity({
      organizationId: session.organizationId,
      category: "settings",
      kind: ACTIVITY_KINDS.templateDeleted,
      summary: `${session.user.name} deleted a template`,
      actorType: "user",
      actorId: session.userId,
      actorLabel: session.user.name,
      metadata: { templateId: id },
    });

    revalidatePath("/templates");
    revalidatePath("/quotations/new");
    return successState("Template deleted. Quotations already created from it are unchanged.");
  } catch (error) {
    if (isFrameworkError(error)) throw error;
    return toActionState(error);
  }
}
