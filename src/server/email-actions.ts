"use server";

import { revalidatePath } from "next/cache";
import {
  errorState,
  isFrameworkError,
  successState,
  toActionState,
  type ActionState,
} from "@/lib/action-state";
import { ACTIVITY_KINDS, recordActivityTx } from "@/lib/activity";
import { prisma } from "@/lib/db";
import { isEmailConfigured } from "@/lib/env";
import { NotConfiguredError, NotFoundError } from "@/lib/errors";
import { scheduleAutoFollowUp } from "@/lib/follow-ups";
import { text } from "@/lib/form";
import { issuePortalLink } from "@/lib/portal";
import { sendPortalEmail, sendQuotationEmail } from "@/lib/notifications";
import { enforceRateLimit } from "@/lib/rate-limit";
import { requireSession } from "@/lib/session";
import { enableSharing } from "@/lib/sharing";
import { loadTenantProfile } from "@/lib/tenant";
import {
  fieldErrors,
  sendPortalEmailSchema,
  sendQuotationEmailSchema,
} from "@/lib/validation";

/**
 * Email a quotation to its customer.
 *
 * The order matters. The share link is prepared first, the message is sent
 * second, and the quotation is only moved to `sent` if the provider actually
 * accepted it — so the status never claims something that did not happen. A
 * failed send leaves the quotation exactly as it was.
 */
export async function sendQuotationEmailAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const session = await requireSession();

    if (!isEmailConfigured()) {
      throw new NotConfiguredError(
        "Email is not configured on this deployment. Ask your administrator to set EMAIL_PROVIDER and EMAIL_FROM, or share the link yourself.",
      );
    }

    const parsed = sendQuotationEmailSchema.safeParse({
      quotationId: text(formData, "quotationId"),
      to: text(formData, "to"),
      message: text(formData, "message"),
    });
    if (!parsed.success) {
      return errorState("Please fix the highlighted fields.", fieldErrors(parsed.error));
    }

    await enforceRateLimit("emailSend", `org:${session.organizationId}`);

    const quotation = await prisma.quotation.findFirst({
      where: { id: parsed.data.quotationId, organizationId: session.organizationId },
      select: {
        id: true,
        status: true,
        number: true,
        customerId: true,
        organizationId: true,
        validUntil: true,
        publicToken: true,
        publicEnabled: true,
      },
    });
    if (!quotation) throw new NotFoundError("Quotation not found.");

    const profile = await loadTenantProfile(session.organizationId, session.organization.name);
    if (!profile.publicPagesEnabled) {
      return errorState(
        "Public quote pages are switched off for this workspace, so the customer would have no link to open. Enable them in Business profile first.",
      );
    }

    const actor = { userId: session.userId, label: session.user.name };

    // Mint the link before sending. For a draft it stays unreachable to the
    // public until the status flips below, which only a successful send does.
    if (!quotation.publicToken || !quotation.publicEnabled) {
      await enableSharing(session.organizationId, quotation.id, actor);
    }

    const outcome = await sendQuotationEmail({
      organizationId: session.organizationId,
      organizationName: session.organization.name,
      quotationId: quotation.id,
      to: parsed.data.to,
      message: parsed.data.message ?? null,
      actor,
    });

    if (!outcome.ok) {
      return errorState(
        outcome.error ??
          outcome.reason ??
          "The email could not be sent. Nothing about the quotation was changed.",
      );
    }

    let statusNote = "";
    if (quotation.status === "draft") {
      const now = new Date();
      await prisma.$transaction(async (tx) => {
        await tx.quotation.update({
          where: { id: quotation.id },
          data: { status: "sent", sentAt: now },
        });
        await recordActivityTx(tx, {
          organizationId: session.organizationId,
          category: "quotation",
          kind: ACTIVITY_KINDS.quotationSent,
          summary: `${session.user.name} sent ${quotation.number} by email`,
          actorType: "user",
          actorId: session.userId,
          actorLabel: session.user.name,
          quotationId: quotation.id,
          customerId: quotation.customerId,
          metadata: { channel: "email", to: parsed.data.to },
        });

        const scheduled = await scheduleAutoFollowUp(
          tx,
          {
            id: quotation.id,
            organizationId: quotation.organizationId,
            customerId: quotation.customerId,
            number: quotation.number,
            validUntil: quotation.validUntil,
          },
          {
            enabled: profile.autoFollowUpEnabled,
            days: profile.autoFollowUpDays,
            timezone: profile.timezone,
          },
          now,
        );
        if (scheduled.scheduled) statusNote = " A follow-up was scheduled.";
      });
      statusNote = ` It is now marked as sent.${statusNote}`;
    }

    revalidatePath(`/quotations/${quotation.id}`);
    revalidatePath("/quotations");
    revalidatePath("/dashboard");

    return successState(`Emailed to ${parsed.data.to}.${statusNote}`);
  } catch (error) {
    if (isFrameworkError(error)) throw error;
    return toActionState(error);
  }
}

/**
 * Issue a portal link and email it in one step.
 *
 * The link is minted first because it is the thing being sent; if the email
 * fails the link is still valid, and the message says so rather than leaving
 * the owner guessing.
 */
export async function sendPortalLinkEmailAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const session = await requireSession();

    if (!isEmailConfigured()) {
      throw new NotConfiguredError(
        "Email is not configured on this deployment. Create the link instead and send it yourself.",
      );
    }

    const parsed = sendPortalEmailSchema.safeParse({
      customerId: text(formData, "customerId"),
      to: text(formData, "to"),
      message: text(formData, "message"),
    });
    if (!parsed.success) {
      return errorState("Please fix the highlighted fields.", fieldErrors(parsed.error));
    }

    await enforceRateLimit("emailSend", `org:${session.organizationId}`);

    const actor = { userId: session.userId, label: session.user.name };
    const link = await issuePortalLink(session.organizationId, parsed.data.customerId, actor);

    const outcome = await sendPortalEmail({
      organizationId: session.organizationId,
      organizationName: session.organization.name,
      customerId: parsed.data.customerId,
      to: parsed.data.to,
      portalUrl: link.url,
      expiresAt: link.expiresAt,
      message: parsed.data.message ?? null,
      actor,
    });

    revalidatePath(`/customers/${parsed.data.customerId}`);

    if (!outcome.ok) {
      return errorState(
        `${outcome.error ?? outcome.reason ?? "The email could not be sent."} The link was created and is valid — copy it below and send it yourself.`,
        undefined,
      );
    }

    return successState(`Portal link emailed to ${parsed.data.to}.`, { url: link.url });
  } catch (error) {
    if (isFrameworkError(error)) throw error;
    return toActionState(error);
  }
}
