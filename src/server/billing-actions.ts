"use server";

import { redirect } from "next/navigation";
import { isFrameworkError, toActionState, type ActionState } from "@/lib/action-state";
import { createCheckoutSession, createPortalSession } from "@/lib/billing";
import { isBillingConfigured } from "@/lib/env";
import { ForbiddenError, NotConfiguredError } from "@/lib/errors";
import { can } from "@/lib/roles";
import { requireSession } from "@/lib/session";

/**
 * Hands off to Stripe Checkout. The plan is *not* changed here — it flips only
 * when the signed `checkout.session.completed` webhook arrives, so an abandoned
 * or spoofed redirect never grants Pro.
 */
export async function startCheckoutAction(
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  let url: string;
  try {
    const session = await requireSession();
    if (!can(session.role, "billing:manage")) {
      throw new ForbiddenError("Only the workspace owner can change the plan.");
    }
    if (!isBillingConfigured()) {
      throw new NotConfiguredError(
        "Payments are not configured on this deployment. Set BILLING_PROVIDER=stripe, STRIPE_SECRET_KEY and STRIPE_PRICE_ID_PRO to enable upgrades.",
      );
    }
    url = await createCheckoutSession({
      organizationId: session.organizationId,
      userEmail: session.user.email,
    });
  } catch (error) {
    if (isFrameworkError(error)) throw error;
    return toActionState(error);
  }

  redirect(url);
}

export async function openBillingPortalAction(
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  let url: string;
  try {
    const session = await requireSession();
    if (!can(session.role, "billing:manage")) {
      throw new ForbiddenError("Only the workspace owner can manage billing.");
    }
    url = await createPortalSession(session.organizationId);
  } catch (error) {
    if (isFrameworkError(error)) throw error;
    return toActionState(error);
  }

  redirect(url);
}
