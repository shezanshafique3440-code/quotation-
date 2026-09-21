import Stripe from "stripe";
import { ACTIVITY_KINDS, recordActivity } from "./activity";
import { prisma } from "./db";
import { getEnv, isBillingConfigured } from "./env";
import { AppError, NotConfiguredError } from "./errors";

let stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!isBillingConfigured()) {
    throw new NotConfiguredError(
      "Billing is not configured on this deployment. Set BILLING_PROVIDER=stripe, STRIPE_SECRET_KEY and STRIPE_PRICE_ID_PRO to enable upgrades.",
    );
  }
  if (!stripe) {
    stripe = new Stripe(getEnv().STRIPE_SECRET_KEY!);
  }
  return stripe;
}

/** Test seam: inject a stub so tests never reach Stripe. */
export function __setStripeForTests(stub: Stripe | null): void {
  stripe = stub;
}

export async function createCheckoutSession(params: {
  organizationId: string;
  userEmail: string;
}): Promise<string> {
  const env = getEnv();
  const client = getStripe();

  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: params.organizationId },
  });

  if (organization.plan === "pro" && organization.planStatus === "active") {
    throw new AppError("This workspace is already on the Pro plan.", { status: 409 });
  }

  const session = await client.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: env.STRIPE_PRICE_ID_PRO!, quantity: 1 }],
    customer: organization.stripeCustomerId ?? undefined,
    customer_email: organization.stripeCustomerId ? undefined : params.userEmail,
    // The webhook is the only thing that flips the plan; this id ties it back.
    client_reference_id: organization.id,
    subscription_data: { metadata: { organizationId: organization.id } },
    metadata: { organizationId: organization.id },
    success_url: `${env.APP_URL}/settings/billing?checkout=complete`,
    cancel_url: `${env.APP_URL}/settings/billing?checkout=cancelled`,
  });

  if (!session.url) {
    throw new AppError("Stripe did not return a checkout URL.", { status: 502 });
  }
  return session.url;
}

export async function createPortalSession(organizationId: string): Promise<string> {
  const env = getEnv();
  const client = getStripe();

  const organization = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
  if (!organization.stripeCustomerId) {
    throw new AppError("This workspace has no billing account yet.", { status: 409 });
  }

  const session = await client.billingPortal.sessions.create({
    customer: organization.stripeCustomerId,
    return_url: `${env.APP_URL}/settings/billing`,
  });
  return session.url;
}

function organizationIdFrom(object: { metadata?: Stripe.Metadata | null; client_reference_id?: string | null }) {
  return object.metadata?.organizationId ?? object.client_reference_id ?? null;
}

/**
 * Apply a verified Stripe event. The plan only ever changes here — never from a
 * browser redirect — so a user who abandons or fakes the success URL stays on Free.
 */
export async function applyStripeEvent(event: Stripe.Event): Promise<{ handled: boolean }> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      const organizationId = organizationIdFrom(session);
      if (!organizationId || session.payment_status === "unpaid") return { handled: false };

      await prisma.organization.update({
        where: { id: organizationId },
        data: {
          plan: "pro",
          planStatus: "active",
          stripeCustomerId: typeof session.customer === "string" ? session.customer : undefined,
          stripeSubscriptionId:
            typeof session.subscription === "string" ? session.subscription : undefined,
        },
      });
      await logPlanChange(organizationId, "pro", "active", event.type);
      return { handled: true };
    }

    case "customer.subscription.updated":
    case "customer.subscription.created": {
      const subscription = event.data.object;
      const organizationId = organizationIdFrom(subscription);
      if (!organizationId) return { handled: false };

      const active = subscription.status === "active" || subscription.status === "trialing";
      const periodEnd = (subscription as unknown as { current_period_end?: number }).current_period_end;

      await prisma.organization.update({
        where: { id: organizationId },
        data: {
          plan: active ? "pro" : "free",
          planStatus: subscription.status,
          stripeSubscriptionId: subscription.id,
          planRenewsAt: active && periodEnd ? new Date(periodEnd * 1000) : null,
        },
      });
      await logPlanChange(organizationId, active ? "pro" : "free", subscription.status, event.type);
      return { handled: true };
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object;
      const organizationId = organizationIdFrom(subscription);
      if (!organizationId) return { handled: false };

      await prisma.organization.update({
        where: { id: organizationId },
        data: { plan: "free", planStatus: "canceled", planRenewsAt: null },
      });
      await logPlanChange(organizationId, "free", "canceled", event.type);
      return { handled: true };
    }

    default:
      return { handled: false };
  }
}

/** Every plan change is attributable to the Stripe event that caused it. */
async function logPlanChange(
  organizationId: string,
  plan: string,
  status: string,
  eventType: string,
): Promise<void> {
  await recordActivity({
    organizationId,
    category: "billing",
    kind: ACTIVITY_KINDS.planChanged,
    summary: `Plan set to ${plan} (${status}) by Stripe`,
    actorType: "system",
    actorLabel: "Stripe webhook",
    metadata: { plan, status, eventType },
  });
}

export function constructWebhookEvent(rawBody: string, signature: string): Stripe.Event {
  const env = getEnv();
  if (!env.STRIPE_WEBHOOK_SECRET) {
    throw new NotConfiguredError("STRIPE_WEBHOOK_SECRET is not set, so webhooks cannot be verified.");
  }
  try {
    return getStripe().webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
  } catch {
    throw new AppError("Invalid Stripe signature.", { status: 400, code: "invalid_signature" });
  }
}
