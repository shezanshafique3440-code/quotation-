import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { __setEmailTransportForTests, type EmailMessage, type EmailTransport } from "@/lib/email";
import { resetEnvCache } from "@/lib/env";
import {
  deliver,
  notifyDecision,
  notifyView,
  sendFollowUpDigests,
  sendInvitationEmail,
  sendPasswordResetEmail,
  sendPortalEmail,
  sendQuotationEmail,
  sendVerificationEmail,
} from "@/lib/notifications";
import { createSharedQuotation, createWorkspace, resetDatabase, type Workspace } from "./helpers";

const ORIGINAL = { ...process.env };
const sent: { message: EmailMessage; from: string }[] = [];

function enableEmail() {
  process.env.EMAIL_PROVIDER = "resend";
  process.env.EMAIL_FROM = "QuoteFlow <quotes@example.com>";
  process.env.RESEND_API_KEY = "re_test";
  resetEnvCache();
}

function disableEmail() {
  process.env.EMAIL_PROVIDER = "none";
  delete process.env.EMAIL_FROM;
  delete process.env.RESEND_API_KEY;
  resetEnvCache();
}

function okTransport(id = "msg_ok"): EmailTransport {
  return {
    name: "resend",
    async send(message, from) {
      sent.push({ message, from });
      return id;
    },
  };
}

function failingTransport(reason: string): EmailTransport {
  return {
    name: "resend",
    async send() {
      throw new Error(reason);
    },
  };
}

async function setProfile(workspace: Workspace, data: Record<string, unknown>) {
  await prisma.businessProfile.update({
    where: { organizationId: workspace.organizationId },
    data,
  });
}

beforeEach(async () => {
  await resetDatabase();
  sent.length = 0;
  enableEmail();
  __setEmailTransportForTests(okTransport());
});

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL)) delete process.env[key];
  }
  Object.assign(process.env, ORIGINAL);
  resetEnvCache();
  __setEmailTransportForTests(null);
});

describe("deliver", () => {
  const rendered = { subject: "Hello", html: "<p>Hi</p>", text: "Hi" };

  it("records a sent row carrying the provider's id", async () => {
    const workspace = await createWorkspace();
    const outcome = await deliver({
      organizationId: workspace.organizationId,
      kind: "quotation",
      to: "dana@example.test",
      rendered,
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.providerMessageId).toBe("msg_ok");

    const row = await prisma.emailDelivery.findFirstOrThrow();
    expect(row.status).toBe("sent");
    expect(row.providerMessageId).toBe("msg_ok");
    expect(row.toEmail).toBe("dana@example.test");
    expect(row.sentAt).not.toBeNull();
    expect(row.error).toBeNull();
  });

  it("records a failed row with the provider's reason, and never reports success", async () => {
    const workspace = await createWorkspace();
    __setEmailTransportForTests(failingTransport("domain not verified"));

    const outcome = await deliver({
      organizationId: workspace.organizationId,
      kind: "quotation",
      to: "dana@example.test",
      rendered,
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatch(/domain not verified/);

    const row = await prisma.emailDelivery.findFirstOrThrow();
    expect(row.status).toBe("failed");
    expect(row.sentAt).toBeNull();
    expect(row.providerMessageId).toBeNull();
    expect(row.error).toMatch(/domain not verified/);
  });

  it("skips cleanly, and writes no row, when nothing is configured", async () => {
    const workspace = await createWorkspace();
    disableEmail();

    const outcome = await deliver({
      organizationId: workspace.organizationId,
      kind: "quotation",
      to: "dana@example.test",
      rendered,
    });

    expect(outcome).toMatchObject({ ok: false, skipped: true });
    expect(outcome.reason).toMatch(/no email provider/i);
    expect(await prisma.emailDelivery.count()).toBe(0);
  });

  it("refuses an invalid recipient without contacting the provider", async () => {
    const workspace = await createWorkspace();
    const outcome = await deliver({
      organizationId: workspace.organizationId,
      kind: "quotation",
      to: "not-an-address",
      rendered,
    });

    expect(outcome.ok).toBe(false);
    expect(sent).toHaveLength(0);
    expect(await prisma.emailDelivery.count()).toBe(0);
  });
});

describe("sendQuotationEmail", () => {
  it("sends the share link and records it against the quotation", async () => {
    const workspace = await createWorkspace();
    const quotation = await createSharedQuotation(workspace);

    const outcome = await sendQuotationEmail({
      organizationId: workspace.organizationId,
      organizationName: "Northline",
      quotationId: quotation.id,
      to: "dana@example.test",
      actor: { userId: workspace.userId, label: "Sam" },
    });

    expect(outcome.ok).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.message.text).toContain(quotation.publicToken!);
    expect(sent[0]!.from).toBe("QuoteFlow <quotes@example.com>");

    const row = await prisma.emailDelivery.findFirstOrThrow();
    expect(row.quotationId).toBe(quotation.id);
    expect(row.kind).toBe("quotation");

    const event = await prisma.activityEvent.findFirst({
      where: { quotationId: quotation.id, kind: "quotation.email_sent" },
    });
    expect(event).not.toBeNull();
  });

  it("refuses when there is no live link, rather than sending a dead one", async () => {
    const workspace = await createWorkspace();
    const quotation = await createSharedQuotation(workspace, { publicEnabled: false });

    const outcome = await sendQuotationEmail({
      organizationId: workspace.organizationId,
      organizationName: "Northline",
      quotationId: quotation.id,
      to: "dana@example.test",
      actor: { userId: workspace.userId, label: "Sam" },
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatch(/no live share link/i);
    expect(sent).toHaveLength(0);
  });

  it("records a failure on the timeline too", async () => {
    const workspace = await createWorkspace();
    const quotation = await createSharedQuotation(workspace);
    __setEmailTransportForTests(failingTransport("mailbox full"));

    const outcome = await sendQuotationEmail({
      organizationId: workspace.organizationId,
      organizationName: "Northline",
      quotationId: quotation.id,
      to: "dana@example.test",
      actor: { userId: workspace.userId, label: "Sam" },
    });

    expect(outcome.ok).toBe(false);
    const event = await prisma.activityEvent.findFirstOrThrow({
      where: { quotationId: quotation.id, kind: "quotation.email_failed" },
    });
    expect(event.summary).toMatch(/failed/i);
  });

  it("never touches another workspace's quotation", async () => {
    const mine = await createWorkspace();
    const theirs = await createWorkspace();
    const quotation = await createSharedQuotation(theirs);

    const outcome = await sendQuotationEmail({
      organizationId: mine.organizationId,
      organizationName: "Mine",
      quotationId: quotation.id,
      to: "dana@example.test",
      actor: { userId: mine.userId, label: "Sam" },
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatch(/not found/i);
    expect(sent).toHaveLength(0);
  });
});

describe("notifyDecision", () => {
  it("emails the workspace notification address", async () => {
    const workspace = await createWorkspace();
    await setProfile(workspace, { notifyEmail: "sales@northline.test" });
    const quotation = await createSharedQuotation(workspace);

    const outcome = await notifyDecision({
      organizationId: workspace.organizationId,
      organizationName: "Northline",
      quotationId: quotation.id,
      decision: "accepted",
      respondedByName: "Dana Whitfield",
      signatureName: "Dana Whitfield",
      respondedAt: new Date("2026-09-22T12:00:00Z"),
    });

    expect(outcome.ok).toBe(true);
    expect(sent[0]!.message.to).toBe("sales@northline.test");
    expect(sent[0]!.message.subject).toMatch(/^Accepted: /);
    expect(sent[0]!.message.text).toContain("Dana Whitfield");
  });

  it("falls back to the business email when no notification address is set", async () => {
    const workspace = await createWorkspace();
    await setProfile(workspace, { email: "hello@northline.test", notifyEmail: null });
    const quotation = await createSharedQuotation(workspace);

    await notifyDecision({
      organizationId: workspace.organizationId,
      organizationName: "Northline",
      quotationId: quotation.id,
      decision: "declined",
      respondedByName: "Dana",
      respondedAt: new Date(),
    });

    expect(sent[0]!.message.to).toBe("hello@northline.test");
  });

  it("stays silent when the workspace turned decision notices off", async () => {
    const workspace = await createWorkspace();
    await setProfile(workspace, { notifyEmail: "sales@northline.test", notifyOnDecision: false });
    const quotation = await createSharedQuotation(workspace);

    const outcome = await notifyDecision({
      organizationId: workspace.organizationId,
      organizationName: "Northline",
      quotationId: quotation.id,
      decision: "accepted",
      respondedByName: "Dana",
      respondedAt: new Date(),
    });

    expect(outcome).toMatchObject({ ok: false, skipped: true });
    expect(sent).toHaveLength(0);
  });

  it("stays silent when there is no address to notify", async () => {
    const workspace = await createWorkspace();
    await setProfile(workspace, { email: null, notifyEmail: null });
    const quotation = await createSharedQuotation(workspace);

    const outcome = await notifyDecision({
      organizationId: workspace.organizationId,
      organizationName: "Northline",
      quotationId: quotation.id,
      decision: "accepted",
      respondedByName: "Dana",
      respondedAt: new Date(),
    });

    expect(outcome.skipped).toBe(true);
    expect(sent).toHaveLength(0);
  });

  it("never throws, so a notification failure cannot undo the decision", async () => {
    const workspace = await createWorkspace();
    await setProfile(workspace, { notifyEmail: "sales@northline.test" });
    const quotation = await createSharedQuotation(workspace);
    __setEmailTransportForTests(failingTransport("smtp timeout"));

    await expect(
      notifyDecision({
        organizationId: workspace.organizationId,
        organizationName: "Northline",
        quotationId: quotation.id,
        decision: "accepted",
        respondedByName: "Dana",
        respondedAt: new Date(),
      }),
    ).resolves.toMatchObject({ ok: false });
  });
});

describe("notifyView", () => {
  it("is off by default and on when the workspace asks for it", async () => {
    const workspace = await createWorkspace();
    await setProfile(workspace, { notifyEmail: "sales@northline.test" });
    const quotation = await createSharedQuotation(workspace);

    const input = {
      organizationId: workspace.organizationId,
      organizationName: "Northline",
      quotationId: quotation.id,
      customerName: "Dana",
      firstView: true,
    };

    expect((await notifyView(input)).skipped).toBe(true);
    expect(sent).toHaveLength(0);

    await setProfile(workspace, { notifyOnView: true });
    expect((await notifyView(input)).ok).toBe(true);
    expect(sent[0]!.message.subject).toMatch(/opened/);
  });
});

describe("sendPortalEmail", () => {
  it("sends the portal link and records it against the customer", async () => {
    const workspace = await createWorkspace();

    const outcome = await sendPortalEmail({
      organizationId: workspace.organizationId,
      organizationName: "Northline",
      customerId: workspace.customerId,
      to: "dana@example.test",
      portalUrl: "https://app.example.com/portal/tok",
      expiresAt: new Date("2027-03-20T00:00:00Z"),
      actor: { userId: workspace.userId, label: "Sam" },
    });

    expect(outcome.ok).toBe(true);
    expect(sent[0]!.message.text).toContain("https://app.example.com/portal/tok");

    const row = await prisma.emailDelivery.findFirstOrThrow();
    expect(row.kind).toBe("portal_link");
    expect(row.customerId).toBe(workspace.customerId);
  });

  it("refuses a customer from another workspace", async () => {
    const mine = await createWorkspace();
    const theirs = await createWorkspace();

    const outcome = await sendPortalEmail({
      organizationId: mine.organizationId,
      organizationName: "Mine",
      customerId: theirs.customerId,
      to: "dana@example.test",
      portalUrl: "https://app.example.com/portal/tok",
      expiresAt: new Date(),
      actor: { userId: mine.userId, label: "Sam" },
    });

    expect(outcome.ok).toBe(false);
    expect(sent).toHaveLength(0);
  });
});

describe("sendFollowUpDigests", () => {
  const now = new Date("2026-09-22T09:00:00Z");

  async function dueReminder(workspace: Workspace, quotationId: string, dueAt: Date) {
    return prisma.reminder.create({
      data: {
        organizationId: workspace.organizationId,
        quotationId,
        channel: "whatsapp",
        dueAt,
        note: "Chase the oak option",
      },
    });
  }

  it("sends one digest per workspace listing everything due", async () => {
    const workspace = await createWorkspace();
    await setProfile(workspace, { notifyEmail: "sales@northline.test" });
    const a = await createSharedQuotation(workspace);
    const b = await createSharedQuotation(workspace);
    await dueReminder(workspace, a.id, new Date("2026-09-21T09:00:00Z"));
    await dueReminder(workspace, b.id, new Date("2026-09-22T08:00:00Z"));

    const results = await sendFollowUpDigests(now);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ sent: true, itemCount: 2 });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.message.subject).toBe("2 follow-ups due");
    expect(sent[0]!.message.text).toContain(a.number);
    expect(sent[0]!.message.text).toContain(b.number);
  });

  it("does not mail the same reminder again on the next run", async () => {
    const workspace = await createWorkspace();
    await setProfile(workspace, { notifyEmail: "sales@northline.test" });
    const quotation = await createSharedQuotation(workspace);
    const reminder = await dueReminder(workspace, quotation.id, new Date("2026-09-21T09:00:00Z"));

    expect(await sendFollowUpDigests(now)).toHaveLength(1);
    expect(sent).toHaveLength(1);

    // An hourly scheduler firing again an hour later must stay quiet.
    expect(await sendFollowUpDigests(new Date("2026-09-22T10:00:00Z"))).toEqual([]);
    expect(sent).toHaveLength(1);

    const stamped = await prisma.reminder.findUniqueOrThrow({ where: { id: reminder.id } });
    expect(stamped.digestedAt).not.toBeNull();
  });

  it("nudges again the next day while the reminder is still unworked", async () => {
    const workspace = await createWorkspace();
    await setProfile(workspace, { notifyEmail: "sales@northline.test" });
    const quotation = await createSharedQuotation(workspace);
    await dueReminder(workspace, quotation.id, new Date("2026-09-21T09:00:00Z"));

    await sendFollowUpDigests(now);
    await sendFollowUpDigests(new Date("2026-09-23T09:00:00Z"));

    expect(sent).toHaveLength(2);
  });

  it("retries on the next run when the provider rejected the digest", async () => {
    const workspace = await createWorkspace();
    await setProfile(workspace, { notifyEmail: "sales@northline.test" });
    const quotation = await createSharedQuotation(workspace);
    const reminder = await dueReminder(workspace, quotation.id, new Date("2026-09-21T09:00:00Z"));

    __setEmailTransportForTests(failingTransport("smtp timeout"));
    expect(await sendFollowUpDigests(now)).toMatchObject([{ sent: false }]);

    const afterFailure = await prisma.reminder.findUniqueOrThrow({ where: { id: reminder.id } });
    expect(afterFailure.digestedAt).toBeNull();

    __setEmailTransportForTests(okTransport());
    expect(await sendFollowUpDigests(new Date("2026-09-22T10:00:00Z"))).toMatchObject([
      { sent: true },
    ]);
    expect(sent).toHaveLength(1);
  });

  it("sends nothing at all when nothing is due", async () => {
    const workspace = await createWorkspace();
    await setProfile(workspace, { notifyEmail: "sales@northline.test" });
    const quotation = await createSharedQuotation(workspace);
    await dueReminder(workspace, quotation.id, new Date("2026-10-01T09:00:00Z"));

    expect(await sendFollowUpDigests(now)).toEqual([]);
    expect(sent).toHaveLength(0);
  });

  it("keeps each workspace's digest to its own quotations", async () => {
    const a = await createWorkspace();
    const b = await createWorkspace();
    await setProfile(a, { notifyEmail: "a@example.test" });
    await setProfile(b, { notifyEmail: "b@example.test" });
    const qa = await createSharedQuotation(a);
    const qb = await createSharedQuotation(b);
    await dueReminder(a, qa.id, new Date("2026-09-21T09:00:00Z"));
    await dueReminder(b, qb.id, new Date("2026-09-21T09:00:00Z"));

    await sendFollowUpDigests(now);

    expect(sent).toHaveLength(2);
    const toA = sent.find((s) => s.message.to === "a@example.test")!;
    const toB = sent.find((s) => s.message.to === "b@example.test")!;
    // Quotation numbers are per-tenant sequences, so both workspaces produce
    // QT-2026-0001. The quotation id in the link is what actually distinguishes them.
    expect(toA.message.text).toContain(qa.number);
    expect(toA.message.text).toContain(qa.id);
    expect(toA.message.text).not.toContain(qb.id);
    expect(toB.message.text).toContain(qb.id);
    expect(toB.message.text).not.toContain(qa.id);
  });

  it("skips a quotation that is no longer open", async () => {
    const workspace = await createWorkspace();
    await setProfile(workspace, { notifyEmail: "sales@northline.test" });
    const quotation = await createSharedQuotation(workspace, { status: "accepted" });
    await dueReminder(workspace, quotation.id, new Date("2026-09-21T09:00:00Z"));

    expect(await sendFollowUpDigests(now)).toEqual([]);
    expect(sent).toHaveLength(0);
  });

  it("reports, rather than sends, when a workspace opted out or has no address", async () => {
    const optedOut = await createWorkspace();
    await setProfile(optedOut, { notifyEmail: "x@example.test", notifyFollowUpsDue: false });
    const q1 = await createSharedQuotation(optedOut);
    await dueReminder(optedOut, q1.id, new Date("2026-09-21T09:00:00Z"));

    const noAddress = await createWorkspace();
    await setProfile(noAddress, { email: null, notifyEmail: null });
    const q2 = await createSharedQuotation(noAddress);
    await dueReminder(noAddress, q2.id, new Date("2026-09-21T09:00:00Z"));

    const results = await sendFollowUpDigests(now);

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.sent === false)).toBe(true);
    expect(results.map((r) => r.reason).join(" ")).toMatch(/turned off/i);
    expect(results.map((r) => r.reason).join(" ")).toMatch(/no notification address/i);
    expect(sent).toHaveLength(0);
  });

  it("does nothing when no provider is configured", async () => {
    const workspace = await createWorkspace();
    await setProfile(workspace, { notifyEmail: "sales@northline.test" });
    const quotation = await createSharedQuotation(workspace);
    await dueReminder(workspace, quotation.id, new Date("2026-09-21T09:00:00Z"));

    disableEmail();
    expect(await sendFollowUpDigests(now)).toEqual([]);
  });
});

describe("account and invitation emails", () => {
  it("sends a password reset from QuoteFlow rather than the workspace", async () => {
    const workspace = await createWorkspace();
    const outcome = await sendPasswordResetEmail({
      organizationId: workspace.organizationId,
      userId: workspace.userId,
      to: "sam@example.test",
      name: "Sam Rivera",
      url: "https://app.example.com/reset-password/tok",
      expiresAt: new Date("2026-09-22T11:00:00Z"),
    });

    expect(outcome.ok).toBe(true);
    expect(sent[0]!.message.subject).toMatch(/QuoteFlow/);
    expect(sent[0]!.message.text).toContain("https://app.example.com/reset-password/tok");

    const row = await prisma.emailDelivery.findFirstOrThrow();
    expect(row.kind).toBe("password_reset");
    expect(row.status).toBe("sent");
  });

  it("records a verification email against the workspace", async () => {
    const workspace = await createWorkspace();
    await sendVerificationEmail({
      organizationId: workspace.organizationId,
      userId: workspace.userId,
      to: "sam@example.test",
      name: "Sam Rivera",
      url: "https://app.example.com/verify-email/tok",
      expiresAt: new Date("2026-09-24T10:00:00Z"),
    });

    const row = await prisma.emailDelivery.findFirstOrThrow();
    expect(row.kind).toBe("verify_email");
    expect(row.organizationId).toBe(workspace.organizationId);
  });

  it("never reports a reset as sent when the provider refused it", async () => {
    const workspace = await createWorkspace();
    __setEmailTransportForTests(failingTransport("relay denied"));

    const outcome = await sendPasswordResetEmail({
      organizationId: workspace.organizationId,
      userId: workspace.userId,
      to: "sam@example.test",
      name: "Sam Rivera",
      url: "https://app.example.com/reset-password/tok",
      expiresAt: new Date("2026-09-22T11:00:00Z"),
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatch(/relay denied/);
    expect((await prisma.emailDelivery.findFirstOrThrow()).status).toBe("failed");
  });

  it("sends an invitation with the workspace's own branding", async () => {
    const workspace = await createWorkspace();
    await prisma.businessProfile.update({
      where: { organizationId: workspace.organizationId },
      data: { legalName: "Northline Joinery Ltd" },
    });

    const outcome = await sendInvitationEmail({
      organizationId: workspace.organizationId,
      organizationName: "Northline",
      to: "alex@example.test",
      invitedByName: "Sam Rivera",
      roleLabel: "Member",
      roleDescription: "Quotes, customers and follow-ups.",
      inviteUrl: "https://app.example.com/invite/tok",
      expiresAt: new Date("2026-10-06T10:00:00Z"),
      hasAccount: false,
    });

    expect(outcome.ok).toBe(true);
    expect(sent[0]!.message.subject).toContain("Northline Joinery Ltd");
    expect(sent[0]!.message.text).toContain("https://app.example.com/invite/tok");
    expect((await prisma.emailDelivery.findFirstOrThrow()).kind).toBe("invitation");
  });

  it("sends nothing at all when no provider is configured", async () => {
    const workspace = await createWorkspace();
    disableEmail();

    const outcome = await sendPasswordResetEmail({
      organizationId: workspace.organizationId,
      userId: workspace.userId,
      to: "sam@example.test",
      name: "Sam Rivera",
      url: "https://app.example.com/reset-password/tok",
      expiresAt: new Date("2026-09-22T11:00:00Z"),
    });

    expect(outcome).toMatchObject({ ok: false, skipped: true });
    expect(sent).toHaveLength(0);
    expect(await prisma.emailDelivery.count()).toBe(0);
  });
});
