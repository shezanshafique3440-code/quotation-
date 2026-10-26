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
import { AppError, ForbiddenError } from "@/lib/errors";
import { percentBp, text } from "@/lib/form";
import { limitsFor } from "@/lib/plans";
import { can } from "@/lib/roles";
import { requireSession } from "@/lib/session";
import { businessProfileSchema, fieldErrors } from "@/lib/validation";

export async function updateBusinessProfileAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const session = await requireSession();
    if (!can(session.role, "settings:manage")) {
      throw new ForbiddenError("Only an owner or admin can change the business profile.");
    }

    const parsed = businessProfileSchema.safeParse({
      legalName: text(formData, "legalName"),
      currency: text(formData, "currency"),
      locale: text(formData, "locale"),
      email: text(formData, "email"),
      phone: text(formData, "phone"),
      whatsappNumber: text(formData, "whatsappNumber"),
      website: text(formData, "website"),
      addressLine1: text(formData, "addressLine1"),
      addressLine2: text(formData, "addressLine2"),
      city: text(formData, "city"),
      postalCode: text(formData, "postalCode"),
      country: text(formData, "country"),
      taxId: text(formData, "taxId"),
      taxRateBp: percentBp(formData, "taxRate") ?? 0,
      logoUrl: text(formData, "logoUrl"),
      quoteNumberPrefix: text(formData, "quoteNumberPrefix"),
      defaultValidityDays: text(formData, "defaultValidityDays"),
      defaultTerms: text(formData, "defaultTerms"),
      defaultNotes: text(formData, "defaultNotes"),
      timezone: text(formData, "timezone"),
      brandColor: text(formData, "brandColor"),
      portalHeadline: text(formData, "portalHeadline"),
      portalMessage: text(formData, "portalMessage"),
      notifyEmail: text(formData, "notifyEmail"),
      notifyOnView: formData.get("notifyOnView") === "on",
      notifyOnDecision: formData.get("notifyOnDecision") === "on",
      notifyFollowUpsDue: formData.get("notifyFollowUpsDue") === "on",
      publicPagesEnabled: formData.get("publicPagesEnabled") === "on",
      requireSignature: formData.get("requireSignature") === "on",
      autoFollowUpEnabled: formData.get("autoFollowUpEnabled") === "on",
      autoFollowUpDays: text(formData, "autoFollowUpDays"),
    });
    if (!parsed.success) {
      return errorState("Please fix the highlighted fields.", fieldErrors(parsed.error));
    }

    const data = {
      ...parsed.data,
      email: parsed.data.email ?? null,
      phone: parsed.data.phone ?? null,
      whatsappNumber: parsed.data.whatsappNumber ?? null,
      website: parsed.data.website ?? null,
      addressLine1: parsed.data.addressLine1 ?? null,
      addressLine2: parsed.data.addressLine2 ?? null,
      city: parsed.data.city ?? null,
      postalCode: parsed.data.postalCode ?? null,
      country: parsed.data.country ?? null,
      taxId: parsed.data.taxId ?? null,
      logoUrl: parsed.data.logoUrl ?? null,
      defaultTerms: parsed.data.defaultTerms ?? null,
      defaultNotes: parsed.data.defaultNotes ?? null,
      portalHeadline: parsed.data.portalHeadline ?? null,
      portalMessage: parsed.data.portalMessage ?? null,
      notifyEmail: parsed.data.notifyEmail ?? null,
    };

    await prisma.$transaction(async (tx) => {
      const organization = await tx.organization.findUniqueOrThrow({
        where: { id: session.organizationId },
        select: { plan: true },
      });
      const current = await tx.businessProfile.findUnique({ where: { organizationId: session.organizationId } });
      const branding = {
        logoUrl: current?.logoUrl ?? null,
        brandColor: current?.brandColor ?? "#4B3DDB",
        portalHeadline: current?.portalHeadline ?? null,
        portalMessage: current?.portalMessage ?? null,
      };
      const brandingFields = Object.keys(branding) as (keyof typeof branding)[];
      // Disabled controls are absent from FormData. Keep existing branding so
      // downgrading never makes an unrelated profile save erase it.
      for (const field of brandingFields) {
        if (!formData.has(field)) Object.assign(data, { [field]: branding[field] });
      }
      const changesBranding = brandingFields.some((field) => field === "brandColor"
        ? data.brandColor.toLowerCase() !== branding.brandColor.toLowerCase()
        : data[field] !== branding[field]);
      if (changesBranding && !limitsFor(organization.plan).customBranding) {
        throw new ForbiddenError("Custom branding is included with Pro. Upgrade to change your logo, brand colour or portal copy.");
      }
      if (data.currency !== (current?.currency ?? "USD") &&
          await tx.product.count({ where: { organizationId: session.organizationId } }) > 0) {
        throw new AppError("Your catalog prices use the current currency. Remove the catalog products before changing currency, then recreate them with prices in the new currency.", {
          status: 409,
          code: "catalog_currency_conflict",
        });
      }

      await tx.businessProfile.upsert({
        where: { organizationId: session.organizationId },
        create: { organizationId: session.organizationId, ...data },
        update: data,
      });
      await tx.organization.update({
        where: { id: session.organizationId },
        data: { name: parsed.data.legalName },
      });
    });

    await recordActivity({
      organizationId: session.organizationId,
      category: "settings",
      kind: ACTIVITY_KINDS.profileUpdated,
      summary: `${session.user.name} updated the business profile`,
      actorType: "user",
      actorId: session.userId,
      actorLabel: session.user.name,
      metadata: {
        currency: parsed.data.currency,
        timezone: parsed.data.timezone,
        publicPagesEnabled: parsed.data.publicPagesEnabled,
      },
    });

    revalidatePath("/settings/business");
    revalidatePath("/dashboard");
    revalidatePath("/quotations");
    return successState("Business profile saved.");
  } catch (error) {
    if (isFrameworkError(error)) throw error;
    return toActionState(error);
  }
}
