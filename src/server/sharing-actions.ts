"use server";

import {
  isFrameworkError,
  successState,
  toActionState,
  type ActionState,
} from "@/lib/action-state";
import { prisma } from "@/lib/db";
import { AppError, NotFoundError } from "@/lib/errors";
import { text } from "@/lib/form";
import { requireSession } from "@/lib/session";
import { disableSharing, enableSharing, rotateShareToken, shareUrl } from "@/lib/sharing";
import { loadTenantProfile } from "@/lib/tenant";
import { shareSettingsSchema } from "@/lib/validation";

/**
 * Turn the customer-facing link on, off, or replace it.
 *
 * A draft is never shareable: the number and totals are still moving, and a
 * customer must not be able to respond to something the owner has not issued.
 */
export async function updateSharingAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const session = await requireSession();
    const parsed = shareSettingsSchema.safeParse({
      quotationId: text(formData, "quotationId"),
      action: text(formData, "action"),
    });
    if (!parsed.success) return toActionState(parsed.error);

    const { quotationId, action } = parsed.data;

    const quotation = await prisma.quotation.findFirst({
      where: { id: quotationId, organizationId: session.organizationId },
      select: { id: true, status: true },
    });
    if (!quotation) throw new NotFoundError("Quotation not found.");

    if (action !== "disable" && quotation.status === "draft") {
      throw new AppError(
        "Mark the quotation as sent before sharing it — a draft cannot be accepted.",
        { status: 409, code: "draft_not_shareable" },
      );
    }

    const profile = await loadTenantProfile(session.organizationId, session.organization.name);
    if (action !== "disable" && !profile.publicPagesEnabled) {
      throw new AppError(
        "Public quote pages are switched off for this workspace. Enable them in Business profile first.",
        { status: 409, code: "public_pages_disabled" },
      );
    }

    const actor = { userId: session.userId, label: session.user.name };
    let message: string;
    let url: string | null = null;

    if (action === "enable") {
      url = shareUrl(await enableSharing(session.organizationId, quotationId, actor));
      message = "Share link is live.";
    } else if (action === "rotate") {
      url = shareUrl(await rotateShareToken(session.organizationId, quotationId, actor));
      message = "New link created. The previous link no longer works.";
    } else {
      await disableSharing(session.organizationId, quotationId, actor);
      message = "Share link disabled. The page now shows as unavailable.";
    }

    // No revalidatePath: re-rendering the server tree mid-action can race with
    // this result, and the panel needs the returned link to show it. The page
    // is dynamic, so the next navigation reads the new state from the database.
    return successState(message, url ? { url } : undefined);
  } catch (error) {
    if (isFrameworkError(error)) throw error;
    return toActionState(error);
  }
}
