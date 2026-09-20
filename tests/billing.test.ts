import type Stripe from "stripe";
import { beforeEach, describe, expect, it } from "vitest";
import { applyStripeEvent } from "@/lib/billing";
import { prisma } from "@/lib/db";
import { createWorkspace, resetDatabase } from "./helpers";

beforeEach(resetDatabase);

function event(type: string, object: unknown): Stripe.Event {
  return { id: "evt_1", type, data: { object } } as unknown as Stripe.Event;
}

describe("applyStripeEvent", () => {
  it("grants Pro on a completed, paid checkout session", async () => {
    const workspace = await createWorkspace({ plan: "free" });

    const result = await applyStripeEvent(
      event("checkout.session.completed", {
        client_reference_id: workspace.organizationId,
        payment_status: "paid",
        customer: "cus_stripe_1",
        subscription: "sub_stripe_1",
        metadata: { organizationId: workspace.organizationId },
      }),
    );

    expect(result.handled).toBe(true);
    const organization = await prisma.organization.findUniqueOrThrow({
      where: { id: workspace.organizationId },
    });
    expect(organization.plan).toBe("pro");
    expect(organization.planStatus).toBe("active");
    expect(organization.stripeCustomerId).toBe("cus_stripe_1");
  });

  it("does not grant Pro for an unpaid session", async () => {
    const workspace = await createWorkspace({ plan: "free" });

    const result = await applyStripeEvent(
      event("checkout.session.completed", {
        payment_status: "unpaid",
        metadata: { organizationId: workspace.organizationId },
      }),
    );

    expect(result.handled).toBe(false);
    const organization = await prisma.organization.findUniqueOrThrow({
      where: { id: workspace.organizationId },
    });
    expect(organization.plan).toBe("free");
  });

  it("ignores an event with no organization reference", async () => {
    const workspace = await createWorkspace({ plan: "free" });
    const result = await applyStripeEvent(
      event("checkout.session.completed", { payment_status: "paid", metadata: {} }),
    );

    expect(result.handled).toBe(false);
    expect(
      (await prisma.organization.findUniqueOrThrow({ where: { id: workspace.organizationId } })).plan,
    ).toBe("free");
  });

  it("downgrades when a subscription goes past due and records the renewal date when active", async () => {
    const workspace = await createWorkspace({ plan: "pro" });

    await applyStripeEvent(
      event("customer.subscription.updated", {
        id: "sub_1",
        status: "past_due",
        metadata: { organizationId: workspace.organizationId },
      }),
    );
    let organization = await prisma.organization.findUniqueOrThrow({
      where: { id: workspace.organizationId },
    });
    expect(organization.plan).toBe("free");
    expect(organization.planStatus).toBe("past_due");

    await applyStripeEvent(
      event("customer.subscription.updated", {
        id: "sub_1",
        status: "active",
        current_period_end: 1_800_000_000,
        metadata: { organizationId: workspace.organizationId },
      }),
    );
    organization = await prisma.organization.findUniqueOrThrow({
      where: { id: workspace.organizationId },
    });
    expect(organization.plan).toBe("pro");
    expect(organization.planRenewsAt?.getTime()).toBe(1_800_000_000_000);
  });

  it("drops back to Free when the subscription is deleted", async () => {
    const workspace = await createWorkspace({ plan: "pro" });

    await applyStripeEvent(
      event("customer.subscription.deleted", {
        id: "sub_1",
        status: "canceled",
        metadata: { organizationId: workspace.organizationId },
      }),
    );

    const organization = await prisma.organization.findUniqueOrThrow({
      where: { id: workspace.organizationId },
    });
    expect(organization.plan).toBe("free");
    expect(organization.planStatus).toBe("canceled");
    expect(organization.planRenewsAt).toBeNull();
  });

  it("ignores event types it does not handle", async () => {
    await expect(applyStripeEvent(event("invoice.created", {}))).resolves.toEqual({
      handled: false,
    });
  });
});
