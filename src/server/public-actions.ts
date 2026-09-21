"use server";

import { headers } from "next/headers";
import {
  errorState,
  isFrameworkError,
  successState,
  toActionState,
  type ActionState,
} from "@/lib/action-state";
import { text } from "@/lib/form";
import { enforceRateLimit } from "@/lib/rate-limit";
import { clientIp, clientIpHash, userAgent } from "@/lib/request";
import { notifyDecision } from "@/lib/notifications";
import { loadPublicQuotation, respondToQuotation } from "@/lib/sharing";
import { fieldErrors, publicResponseSchema } from "@/lib/validation";

/**
 * The customer's accept/decline, submitted from the public share page.
 *
 * Unauthenticated, so it is rate limited per address and re-validates the
 * token on every call — the earlier page render grants nothing.
 */
export async function respondToQuotationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const token = text(formData, "token");
    if (!token) return errorState("This link is no longer valid.");

    const headerBag = await headers();
    await enforceRateLimit("publicRespond", clientIp(headerBag));

    const parsed = publicResponseSchema.safeParse({
      decision: text(formData, "decision"),
      respondedByName: text(formData, "respondedByName"),
      signatureName: text(formData, "signatureName"),
      signatureEmail: text(formData, "signatureEmail"),
      rejectionReason: text(formData, "rejectionReason"),
      agreed: formData.get("agreed") === "on",
    });
    if (!parsed.success) {
      return errorState("Please fix the highlighted fields.", fieldErrors(parsed.error));
    }

    const record = await loadPublicQuotation(token);
    if (!record) {
      return errorState("This quotation is no longer available. Please contact the sender.");
    }

    const result = await respondToQuotation(
      record,
      {
        decision: parsed.data.decision,
        respondedByName: parsed.data.respondedByName,
        signatureName: parsed.data.signatureName,
        signatureEmail: parsed.data.signatureEmail,
        rejectionReason: parsed.data.rejectionReason,
        ipHash: clientIpHash(headerBag),
        userAgent: userAgent(headerBag),
      },
    );

    // Deliberately no revalidatePath here. The page is force-dynamic, so
    // nothing is cached to invalidate, and revalidating would re-render the
    // server tree mid-action — unmounting this form before the customer ever
    // sees the confirmation that their response was recorded.
    // Tell the business. A notification failure must never change what the
    // customer is told — their decision is already committed.
    if (!result.alreadyDecided) {
      await notifyDecision({
        organizationId: record.organizationId,
        organizationName: record.organization.name,
        quotationId: record.id,
        decision: result.status === "accepted" ? "accepted" : "declined",
        respondedByName: parsed.data.respondedByName,
        signatureName: parsed.data.signatureName ?? null,
        rejectionReason: parsed.data.rejectionReason ?? null,
        respondedAt: new Date(),
      });
    }

    if (result.alreadyDecided) {
      return successState(
        result.status === "accepted"
          ? "This quotation was already accepted."
          : "This quotation was already declined.",
      );
    }

    return successState(
      result.status === "accepted"
        ? "Thank you — your acceptance has been recorded and the sender can see it."
        : "Thank you — your response has been recorded and the sender can see it.",
    );
  } catch (error) {
    if (isFrameworkError(error)) throw error;
    return toActionState(error);
  }
}
