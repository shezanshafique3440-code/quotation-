import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { applyStripeEvent, constructWebhookEvent } from "@/lib/billing";
import { AppError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The only place a workspace is granted or loses Pro. Every request must carry
 * a valid Stripe signature over the exact raw body.
 */
export async function POST(request: Request) {
  try {
    const signature = request.headers.get("stripe-signature");
    if (!signature) {
      throw new AppError("Missing stripe-signature header.", {
        status: 400,
        code: "missing_signature",
      });
    }

    const rawBody = await request.text();
    const event = constructWebhookEvent(rawBody, signature);
    const { handled } = await applyStripeEvent(event);

    return NextResponse.json({ received: true, handled, type: event.type });
  } catch (error) {
    return jsonError(error);
  }
}
