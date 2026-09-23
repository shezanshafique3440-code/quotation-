import { ACTIVITY_KINDS, recordActivity } from "./activity";
import { prisma } from "./db";
import { sendEmail, bareAddress, isValidEmailAddress, type EmailMessage } from "./email";
import {
  renderDecisionEmail,
  renderFollowUpDigest,
  renderInvitationEmail,
  renderPasswordResetEmail,
  renderPortalEmail,
  renderQuotationEmail,
  renderVerifyEmail,
  renderViewedEmail,
  type EmailBranding,
  type RenderedEmail,
} from "./email-templates";
import { getEnv, isEmailConfigured } from "./env";
import { createFormatter } from "./format";
import { shareUrl } from "./sharing";

export type EmailKind =
  | "quotation"
  | "accepted"
  | "declined"
  | "viewed"
  | "follow_up_digest"
  | "portal_link"
  | "password_reset"
  | "verify_email"
  | "invitation";

export interface DeliveryOutcome {
  ok: boolean;
  /** Set when the message really was accepted by the provider. */
  deliveryId?: string;
  providerMessageId?: string;
  /** Set when it was not. Safe to show to the sender. */
  error?: string;
  /** True when sending was skipped because nothing is configured. */
  skipped?: boolean;
  reason?: string;
}

interface DeliverInput {
  organizationId: string;
  kind: EmailKind;
  to: string;
  rendered: RenderedEmail;
  replyTo?: string | undefined;
  quotationId?: string | undefined;
  customerId?: string | undefined;
}

/**
 * Send one message and record exactly what happened.
 *
 * A `queued` row is written before the attempt, then moved to `sent` with the
 * provider's id or to `failed` with its error. Nothing reports success unless
 * a provider returned an id, so "emailed" in the UI is always a fact.
 */
export async function deliver(input: DeliverInput): Promise<DeliveryOutcome> {
  if (!isEmailConfigured()) {
    return {
      ok: false,
      skipped: true,
      reason:
        "No email provider is configured on this deployment, so nothing was sent.",
    };
  }
  if (!isValidEmailAddress(input.to)) {
    return { ok: false, error: `"${input.to}" is not a valid email address.` };
  }

  const env = getEnv();
  const delivery = await prisma.emailDelivery.create({
    data: {
      organizationId: input.organizationId,
      kind: input.kind,
      status: "queued",
      provider: env.EMAIL_PROVIDER,
      toEmail: input.to.trim(),
      subject: input.rendered.subject.slice(0, 300),
      quotationId: input.quotationId ?? null,
      customerId: input.customerId ?? null,
      attempts: 1,
    },
  });

  const message: EmailMessage = {
    to: input.to.trim(),
    subject: input.rendered.subject,
    html: input.rendered.html,
    text: input.rendered.text,
    replyTo: input.replyTo ?? env.EMAIL_REPLY_TO,
  };

  const result = await sendEmail(message);

  await prisma.emailDelivery.update({
    where: { id: delivery.id },
    data: result.ok
      ? {
          status: "sent",
          sentAt: new Date(),
          providerMessageId: result.providerMessageId ?? null,
          error: null,
        }
      : { status: "failed", error: (result.error ?? "Unknown error").slice(0, 1000) },
  });

  return result.ok
    ? {
        ok: true,
        deliveryId: delivery.id,
        ...(result.providerMessageId ? { providerMessageId: result.providerMessageId } : {}),
      }
    : { ok: false, deliveryId: delivery.id, ...(result.error ? { error: result.error } : {}) };
}

interface TenantEmailContext {
  branding: EmailBranding;
  notifyEmail: string | null;
  notifyOnView: boolean;
  notifyOnDecision: boolean;
  notifyFollowUpsDue: boolean;
  locale: string;
  timezone: string;
  currency: string;
}

/** Branding plus notification preferences, from the workspace profile. */
export async function emailContext(
  organizationId: string,
  organizationName: string,
): Promise<TenantEmailContext> {
  const profile = await prisma.businessProfile.findUnique({ where: { organizationId } });

  return {
    branding: {
      businessName: profile?.legalName ?? organizationName,
      brandColor: profile?.brandColor ?? null,
      locale: profile?.locale ?? "en-US",
      website: profile?.website ?? null,
      phone: profile?.phone ?? null,
      replyTo: profile?.email ?? null,
    },
    notifyEmail: profile?.notifyEmail ?? profile?.email ?? null,
    notifyOnView: profile?.notifyOnView ?? false,
    notifyOnDecision: profile?.notifyOnDecision ?? true,
    notifyFollowUpsDue: profile?.notifyFollowUpsDue ?? true,
    locale: profile?.locale ?? "en-US",
    timezone: profile?.timezone ?? "UTC",
    currency: profile?.currency ?? "USD",
  };
}

function appUrl(path: string): string {
  return `${getEnv().APP_URL.replace(/\/$/, "")}${path}`;
}

export interface SendQuotationInput {
  organizationId: string;
  organizationName: string;
  quotationId: string;
  to: string;
  message?: string | null;
  actor: { userId: string; label: string };
}

/**
 * Email a quotation to its customer.
 *
 * The caller is responsible for the share link existing; this reports failure
 * rather than silently sending a link that goes nowhere.
 */
export async function sendQuotationEmail(
  input: SendQuotationInput,
): Promise<DeliveryOutcome> {
  const quotation = await prisma.quotation.findFirst({
    where: { id: input.quotationId, organizationId: input.organizationId },
    include: { customer: true },
  });
  if (!quotation) return { ok: false, error: "Quotation not found." };

  if (!quotation.publicToken || !quotation.publicEnabled) {
    return {
      ok: false,
      error:
        "This quotation has no live share link, so there would be nothing for the customer to open. Create the link first.",
    };
  }

  const context = await emailContext(input.organizationId, input.organizationName);
  const fmt = createFormatter({
    locale: context.locale,
    timezone: context.timezone,
    currency: quotation.currency,
  });

  const rendered = renderQuotationEmail({
    branding: context.branding,
    customerName: quotation.customer.name,
    quotation: {
      number: quotation.number,
      title: quotation.title,
      totalCents: quotation.totalCents,
      currency: quotation.currency,
      validUntilLabel: quotation.validUntil ? fmt.date(quotation.validUntil) : null,
      notes: quotation.notes,
    },
    shareUrl: shareUrl(quotation.publicToken),
    message: input.message ?? null,
    requireSignature: quotation.requireSignature,
  });

  const outcome = await deliver({
    organizationId: input.organizationId,
    kind: "quotation",
    to: input.to,
    rendered,
    replyTo: context.branding.replyTo ? bareAddress(context.branding.replyTo) : undefined,
    quotationId: quotation.id,
    customerId: quotation.customerId,
  });

  await recordActivity({
    organizationId: input.organizationId,
    category: "quotation",
    kind: outcome.ok ? ACTIVITY_KINDS.emailSent : ACTIVITY_KINDS.emailFailed,
    summary: outcome.ok
      ? `${input.actor.label} emailed ${quotation.number} to ${input.to}`
      : `Emailing ${quotation.number} to ${input.to} failed`,
    actorType: "user",
    actorId: input.actor.userId,
    actorLabel: input.actor.label,
    quotationId: quotation.id,
    customerId: quotation.customerId,
    metadata: outcome.ok
      ? { to: input.to, providerMessageId: outcome.providerMessageId }
      : { to: input.to, error: outcome.error ?? outcome.reason },
  });

  return outcome;
}

export interface DecisionNotificationInput {
  organizationId: string;
  organizationName: string;
  quotationId: string;
  decision: "accepted" | "declined";
  respondedByName: string;
  signatureName?: string | null;
  rejectionReason?: string | null;
  respondedAt: Date;
}

/**
 * Tell the business their customer responded.
 *
 * Never throws: a notification failing must not undo the customer's decision,
 * which is already committed by the time this runs.
 */
export async function notifyDecision(
  input: DecisionNotificationInput,
): Promise<DeliveryOutcome> {
  try {
    const context = await emailContext(input.organizationId, input.organizationName);
    if (!context.notifyOnDecision) {
      return { ok: false, skipped: true, reason: "Decision notifications are turned off." };
    }
    if (!context.notifyEmail) {
      return { ok: false, skipped: true, reason: "No notification address is set." };
    }

    const quotation = await prisma.quotation.findFirst({
      where: { id: input.quotationId, organizationId: input.organizationId },
      include: { customer: true },
    });
    if (!quotation) return { ok: false, error: "Quotation not found." };

    const fmt = createFormatter({
      locale: context.locale,
      timezone: context.timezone,
      currency: quotation.currency,
    });

    const rendered = renderDecisionEmail({
      branding: context.branding,
      decision: input.decision,
      customerName: quotation.customer.name,
      respondedByName: input.respondedByName,
      signatureName: input.signatureName ?? null,
      rejectionReason: input.rejectionReason ?? null,
      quotation: {
        number: quotation.number,
        title: quotation.title,
        totalCents: quotation.totalCents,
        currency: quotation.currency,
      },
      quotationUrl: appUrl(`/quotations/${quotation.id}`),
      respondedAtLabel: fmt.dateTime(input.respondedAt),
    });

    return await deliver({
      organizationId: input.organizationId,
      kind: input.decision === "accepted" ? "accepted" : "declined",
      to: context.notifyEmail,
      rendered,
      quotationId: quotation.id,
      customerId: quotation.customerId,
    });
  } catch (error) {
    console.error("[notifications] decision notice failed", error);
    return { ok: false, error: "The notification could not be sent." };
  }
}

export interface ViewNotificationInput {
  organizationId: string;
  organizationName: string;
  quotationId: string;
  customerName: string;
  firstView: boolean;
}

export async function notifyView(input: ViewNotificationInput): Promise<DeliveryOutcome> {
  try {
    const context = await emailContext(input.organizationId, input.organizationName);
    if (!context.notifyOnView) {
      return { ok: false, skipped: true, reason: "Open notifications are turned off." };
    }
    if (!context.notifyEmail) {
      return { ok: false, skipped: true, reason: "No notification address is set." };
    }

    const quotation = await prisma.quotation.findFirst({
      where: { id: input.quotationId, organizationId: input.organizationId },
      select: { id: true, number: true, title: true, customerId: true },
    });
    if (!quotation) return { ok: false, error: "Quotation not found." };

    const rendered = renderViewedEmail({
      branding: context.branding,
      customerName: input.customerName,
      quotation: { number: quotation.number, title: quotation.title },
      quotationUrl: appUrl(`/quotations/${quotation.id}`),
      firstView: input.firstView,
    });

    return await deliver({
      organizationId: input.organizationId,
      kind: "viewed",
      to: context.notifyEmail,
      rendered,
      quotationId: quotation.id,
      customerId: quotation.customerId,
    });
  } catch (error) {
    console.error("[notifications] view notice failed", error);
    return { ok: false, error: "The notification could not be sent." };
  }
}

export interface PortalEmailSendInput {
  organizationId: string;
  organizationName: string;
  customerId: string;
  to: string;
  portalUrl: string;
  expiresAt: Date;
  message?: string | null;
  actor: { userId: string; label: string };
}

export async function sendPortalEmail(input: PortalEmailSendInput): Promise<DeliveryOutcome> {
  const customer = await prisma.customer.findFirst({
    where: { id: input.customerId, organizationId: input.organizationId },
    select: { id: true, name: true },
  });
  if (!customer) return { ok: false, error: "Customer not found." };

  const context = await emailContext(input.organizationId, input.organizationName);
  const fmt = createFormatter({
    locale: context.locale,
    timezone: context.timezone,
    currency: context.currency,
  });

  const rendered = renderPortalEmail({
    branding: context.branding,
    customerName: customer.name,
    portalUrl: input.portalUrl,
    expiresLabel: fmt.date(input.expiresAt),
    message: input.message ?? null,
  });

  const outcome = await deliver({
    organizationId: input.organizationId,
    kind: "portal_link",
    to: input.to,
    rendered,
    replyTo: context.branding.replyTo ? bareAddress(context.branding.replyTo) : undefined,
    customerId: customer.id,
  });

  await recordActivity({
    organizationId: input.organizationId,
    category: "customer",
    kind: ACTIVITY_KINDS.portalEmailSent,
    summary: outcome.ok
      ? `${input.actor.label} emailed the portal link to ${input.to}`
      : `Emailing the portal link to ${input.to} failed`,
    actorType: "user",
    actorId: input.actor.userId,
    actorLabel: input.actor.label,
    customerId: customer.id,
    metadata: outcome.ok ? { to: input.to } : { to: input.to, error: outcome.error },
  });

  return outcome;
}

export interface DigestResult {
  organizationId: string;
  sent: boolean;
  itemCount: number;
  reason?: string;
  error?: string;
}

/**
 * One digest per workspace with follow-ups now due.
 *
 * Called by the scheduled endpoint. Workspaces with nothing due get no email
 * at all — an empty "nothing to do" message is noise, not a notification.
 */
export async function sendFollowUpDigests(now: Date = new Date()): Promise<DigestResult[]> {
  if (!isEmailConfigured()) return [];

  // A reminder stays pending until the owner works it, so without this window
  // an hourly scheduler would mail the same item every hour. Re-nudging after
  // 20h keeps a daily cadence for anything still unworked.
  const renudgeBefore = new Date(now.getTime() - 20 * 60 * 60_000);

  const due = await prisma.reminder.findMany({
    where: {
      status: "pending",
      dueAt: { lte: now },
      OR: [{ digestedAt: null }, { digestedAt: { lt: renudgeBefore } }],
    },
    orderBy: { dueAt: "asc" },
    take: 500,
    include: {
      organization: { select: { id: true, name: true } },
      quotation: {
        select: {
          id: true,
          number: true,
          title: true,
          totalCents: true,
          currency: true,
          status: true,
          customer: { select: { name: true } },
        },
      },
    },
  });

  const byOrg = new Map<string, typeof due>();
  for (const reminder of due) {
    // A decided quotation no longer needs chasing, even if the row lingered.
    if (reminder.quotation.status !== "sent") continue;
    const list = byOrg.get(reminder.organizationId) ?? [];
    list.push(reminder);
    byOrg.set(reminder.organizationId, list);
  }

  const results: DigestResult[] = [];

  for (const [organizationId, reminders] of byOrg) {
    const organizationName = reminders[0]!.organization.name;
    const context = await emailContext(organizationId, organizationName);

    if (!context.notifyFollowUpsDue) {
      results.push({
        organizationId,
        sent: false,
        itemCount: reminders.length,
        reason: "Follow-up digests are turned off for this workspace.",
      });
      continue;
    }
    if (!context.notifyEmail) {
      results.push({
        organizationId,
        sent: false,
        itemCount: reminders.length,
        reason: "No notification address is set for this workspace.",
      });
      continue;
    }

    const fmt = createFormatter({
      locale: context.locale,
      timezone: context.timezone,
      currency: context.currency,
    });

    const rendered = renderFollowUpDigest({
      branding: context.branding,
      items: reminders.map((reminder) => ({
        quotationNumber: reminder.quotation.number,
        customerName: reminder.quotation.customer.name,
        title: reminder.quotation.title,
        totalCents: reminder.quotation.totalCents,
        currency: reminder.quotation.currency,
        dueLabel: fmt.date(reminder.dueAt),
        quotationUrl: appUrl(`/quotations/${reminder.quotation.id}`),
        note: reminder.note,
      })),
    });

    const outcome = await deliver({
      organizationId,
      kind: "follow_up_digest",
      to: context.notifyEmail,
      rendered,
    });

    // Only stamp what actually went out: a failed digest is retried next run.
    if (outcome.ok) {
      await prisma.reminder.updateMany({
        where: { id: { in: reminders.map((reminder) => reminder.id) } },
        data: { digestedAt: now },
      });
    }

    results.push({
      organizationId,
      sent: outcome.ok,
      itemCount: reminders.length,
      ...(outcome.error ? { error: outcome.error } : {}),
      ...(outcome.reason ? { reason: outcome.reason } : {}),
    });
  }

  return results;
}

interface AccountEmailInput {
  organizationId: string;
  userId: string;
  to: string;
  name: string;
  url: string;
  expiresAt: Date;
}

/**
 * Email a password-reset link.
 *
 * Deliberately product-branded rather than workspace-branded: this is a
 * QuoteFlow account action, and wearing a tenant's logo would misattribute it.
 */
export async function sendPasswordResetEmail(
  input: AccountEmailInput,
): Promise<DeliveryOutcome> {
  const fmt = createFormatter({ locale: "en-US", timezone: "UTC", currency: "USD" });
  const rendered = renderPasswordResetEmail({
    name: input.name,
    resetUrl: input.url,
    expiresLabel: `at ${fmt.dateTime(input.expiresAt)}`,
  });

  return deliver({
    organizationId: input.organizationId,
    kind: "password_reset",
    to: input.to,
    rendered,
  });
}

/** Email an address-verification link. Same product branding, same reasons. */
export async function sendVerificationEmail(
  input: AccountEmailInput,
): Promise<DeliveryOutcome> {
  const fmt = createFormatter({ locale: "en-US", timezone: "UTC", currency: "USD" });
  const rendered = renderVerifyEmail({
    name: input.name,
    verifyUrl: input.url,
    expiresLabel: fmt.dateTime(input.expiresAt),
  });

  return deliver({
    organizationId: input.organizationId,
    kind: "verify_email",
    to: input.to,
    rendered,
  });
}

export interface InvitationEmailSendInput {
  organizationId: string;
  organizationName: string;
  to: string;
  invitedByName: string;
  roleLabel: string;
  roleDescription: string;
  inviteUrl: string;
  expiresAt: Date;
  hasAccount: boolean;
}

/**
 * Email a workspace invitation.
 *
 * This one *is* workspace-branded: the recipient is being asked to join that
 * business, and recognising it is the point.
 */
export async function sendInvitationEmail(
  input: InvitationEmailSendInput,
): Promise<DeliveryOutcome> {
  const context = await emailContext(input.organizationId, input.organizationName);
  const fmt = createFormatter({
    locale: context.locale,
    timezone: context.timezone,
    currency: context.currency,
  });

  const rendered = renderInvitationEmail({
    branding: context.branding,
    workspaceName: context.branding.businessName,
    invitedByName: input.invitedByName,
    roleLabel: input.roleLabel,
    roleDescription: input.roleDescription,
    inviteUrl: input.inviteUrl,
    expiresLabel: fmt.date(input.expiresAt),
    hasAccount: input.hasAccount,
  });

  return deliver({
    organizationId: input.organizationId,
    kind: "invitation",
    to: input.to,
    rendered,
    replyTo: context.branding.replyTo ? bareAddress(context.branding.replyTo) : undefined,
  });
}
