"use server";

import {
  isFrameworkError,
  successState,
  toActionState,
  type ActionState,
} from "@/lib/action-state";
import { NotFoundError } from "@/lib/errors";
import { text } from "@/lib/form";
import { issuePortalLink, revokePortalLinks } from "@/lib/portal";
import { requireSession } from "@/lib/session";

/**
 * Create a portal link for a customer.
 *
 * The raw link is returned once and never stored, so it is shown to the owner
 * here and nowhere else. Issuing a new one revokes the previous link.
 */
export async function issuePortalLinkAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const session = await requireSession();
    const customerId = text(formData, "customerId");
    if (!customerId) throw new NotFoundError("Customer not found.");

    const link = await issuePortalLink(session.organizationId, customerId, {
      userId: session.userId,
      label: session.user.name,
    });

    // Deliberately no revalidatePath. The page is dynamic, so there is no
    // cache to bust, and re-rendering the server tree here can race with the
    // action result — which holds the only copy of the link that will ever
    // exist. The panel derives its own state from this result instead.
    return successState(
      "Portal link created. Copy it now — for security it is not stored and cannot be shown again.",
      { url: link.url, expiresAt: link.expiresAt.toISOString() },
    );
  } catch (error) {
    if (isFrameworkError(error)) throw error;
    return toActionState(error);
  }
}

export async function revokePortalLinkAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const session = await requireSession();
    const customerId = text(formData, "customerId");
    if (!customerId) throw new NotFoundError("Customer not found.");

    const revoked = await revokePortalLinks(session.organizationId, customerId, {
      userId: session.userId,
      label: session.user.name,
    });

    return successState(
      revoked === 0 ? "There was no active portal link." : "Portal access revoked.",
    );
  } catch (error) {
    if (isFrameworkError(error)) throw error;
    return toActionState(error);
  }
}
