import { brandPalette } from "./branding";
import { formatMoney } from "./money";

export interface EmailBranding {
  businessName: string;
  brandColor: string | null;
  locale: string;
  replyTo?: string | null;
  website?: string | null;
  phone?: string | null;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/** Email clients render raw HTML, so every interpolated value is escaped. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface LayoutOptions {
  branding: EmailBranding;
  heading: string;
  /** Already-escaped HTML fragments. */
  bodyHtml: string;
  cta?: { label: string; url: string } | undefined;
  footerNote?: string | undefined;
}

/**
 * One layout for every message.
 *
 * Deliberately table-free where possible, inline-styled, and narrow — the
 * shapes that survive Outlook, Gmail and Apple Mail without a build step.
 */
function layout({ branding, heading, bodyHtml, cta, footerNote }: LayoutOptions): string {
  const palette = brandPalette(branding.brandColor);
  const name = escapeHtml(branding.businessName);

  const button = cta
    ? `<p style="margin:28px 0 8px">
         <a href="${escapeHtml(cta.url)}"
            style="display:inline-block;background:${palette.base};color:${palette.onBase};
                   text-decoration:none;padding:12px 22px;border-radius:8px;
                   font-weight:600;font-size:15px">${escapeHtml(cta.label)}</a>
       </p>
       <p style="margin:0;font-size:12px;color:#6b7280;word-break:break-all">
         Or paste this into your browser: ${escapeHtml(cta.url)}
       </p>`
    : "";

  const contact = [
    branding.phone ? escapeHtml(branding.phone) : null,
    branding.website ? escapeHtml(branding.website) : null,
  ]
    .filter(Boolean)
    .join(" &middot; ");

  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f6f7f9">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(heading)}</div>
  <div style="max-width:600px;margin:0 auto;padding:24px 16px;
              font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
              color:#1f2937;line-height:1.55">
    <div style="background:${palette.soft};border:1px solid ${palette.border};
                border-radius:12px 12px 0 0;padding:18px 24px">
      <span style="font-size:15px;font-weight:700;color:${palette.strong}">${name}</span>
    </div>
    <div style="background:#ffffff;border:1px solid #e5e7eb;border-top:0;
                border-radius:0 0 12px 12px;padding:24px">
      <h1 style="margin:0 0 14px;font-size:19px;line-height:1.35;color:#111827">${escapeHtml(heading)}</h1>
      ${bodyHtml}
      ${button}
    </div>
    <p style="margin:18px 0 0;font-size:12px;color:#9ca3af;text-align:center">
      ${name}${contact ? ` &middot; ${contact}` : ""}
    </p>
    ${footerNote ? `<p style="margin:8px 0 0;font-size:12px;color:#9ca3af;text-align:center">${escapeHtml(footerNote)}</p>` : ""}
  </div>
</body>
</html>`;
}

function textBlock(lines: (string | null | undefined)[]): string {
  return lines.filter((line) => line !== null && line !== undefined).join("\n");
}

export interface QuotationEmailInput {
  branding: EmailBranding;
  customerName: string;
  quotation: {
    number: string;
    title: string;
    totalCents: number;
    currency: string;
    validUntilLabel: string | null;
    notes: string | null;
  };
  shareUrl: string;
  /** Free-text opener written by the sender. */
  message?: string | null;
  requireSignature: boolean;
}

export function renderQuotationEmail(input: QuotationEmailInput): RenderedEmail {
  const { branding, quotation } = input;
  const total = formatMoney(quotation.totalCents, quotation.currency, branding.locale);
  const firstName = input.customerName.split(" ")[0] ?? input.customerName;

  const intro =
    input.message?.trim() ||
    `Here is the quotation you asked for. You can read it in full and accept or decline it online — no account needed.`;

  const bodyHtml = `
    <p style="margin:0 0 14px">Hi ${escapeHtml(firstName)},</p>
    <p style="margin:0 0 18px;white-space:pre-wrap">${escapeHtml(intro)}</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;
           border:1px solid #e5e7eb;border-radius:8px;margin:0 0 6px">
      <tr><td style="padding:12px 14px;border-bottom:1px solid #f3f4f6;font-size:14px;color:#6b7280">Quotation</td>
          <td style="padding:12px 14px;border-bottom:1px solid #f3f4f6;font-size:14px;text-align:right">${escapeHtml(quotation.number)}</td></tr>
      <tr><td style="padding:12px 14px;border-bottom:1px solid #f3f4f6;font-size:14px;color:#6b7280">For</td>
          <td style="padding:12px 14px;border-bottom:1px solid #f3f4f6;font-size:14px;text-align:right">${escapeHtml(quotation.title)}</td></tr>
      <tr><td style="padding:12px 14px;font-size:15px;font-weight:600">Total</td>
          <td style="padding:12px 14px;font-size:15px;font-weight:600;text-align:right">${escapeHtml(total)}</td></tr>
    </table>
    ${
      quotation.validUntilLabel
        ? `<p style="margin:0 0 6px;font-size:13px;color:#6b7280">Valid until ${escapeHtml(quotation.validUntilLabel)}.</p>`
        : ""
    }
    ${
      input.requireSignature
        ? `<p style="margin:0;font-size:13px;color:#6b7280">Accepting asks you to type your name as an electronic signature.</p>`
        : ""
    }`;

  const text = textBlock([
    `Hi ${firstName},`,
    "",
    intro,
    "",
    `Quotation: ${quotation.number}`,
    `For: ${quotation.title}`,
    `Total: ${total}`,
    quotation.validUntilLabel ? `Valid until: ${quotation.validUntilLabel}` : null,
    "",
    "Read it and respond here:",
    input.shareUrl,
    "",
    `— ${branding.businessName}`,
  ]);

  return {
    subject: `Quotation ${quotation.number} from ${branding.businessName}`,
    html: layout({
      branding,
      heading: `Your quotation from ${branding.businessName}`,
      bodyHtml,
      cta: { label: "View and respond", url: input.shareUrl },
    }),
    text,
  };
}

export interface DecisionEmailInput {
  branding: EmailBranding;
  decision: "accepted" | "declined";
  customerName: string;
  respondedByName: string;
  signatureName?: string | null;
  rejectionReason?: string | null;
  quotation: { number: string; title: string; totalCents: number; currency: string };
  quotationUrl: string;
  respondedAtLabel: string;
}

/** Sent to the business when a customer responds on the share page. */
export function renderDecisionEmail(input: DecisionEmailInput): RenderedEmail {
  const { branding, quotation } = input;
  const total = formatMoney(quotation.totalCents, quotation.currency, branding.locale);
  const accepted = input.decision === "accepted";
  const verb = accepted ? "accepted" : "declined";

  const bodyHtml = `
    <p style="margin:0 0 18px">
      <strong>${escapeHtml(input.respondedByName)}</strong> ${verb}
      <strong>${escapeHtml(quotation.number)}</strong> on the online quotation page.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;
           border:1px solid #e5e7eb;border-radius:8px">
      <tr><td style="padding:12px 14px;border-bottom:1px solid #f3f4f6;font-size:14px;color:#6b7280">Customer</td>
          <td style="padding:12px 14px;border-bottom:1px solid #f3f4f6;font-size:14px;text-align:right">${escapeHtml(input.customerName)}</td></tr>
      <tr><td style="padding:12px 14px;border-bottom:1px solid #f3f4f6;font-size:14px;color:#6b7280">For</td>
          <td style="padding:12px 14px;border-bottom:1px solid #f3f4f6;font-size:14px;text-align:right">${escapeHtml(quotation.title)}</td></tr>
      <tr><td style="padding:12px 14px;border-bottom:1px solid #f3f4f6;font-size:15px;font-weight:600">Value</td>
          <td style="padding:12px 14px;border-bottom:1px solid #f3f4f6;font-size:15px;font-weight:600;text-align:right">${escapeHtml(total)}</td></tr>
      <tr><td style="padding:12px 14px;font-size:14px;color:#6b7280">When</td>
          <td style="padding:12px 14px;font-size:14px;text-align:right">${escapeHtml(input.respondedAtLabel)}</td></tr>
    </table>
    ${
      input.signatureName
        ? `<p style="margin:16px 0 0;font-size:14px">Signed as <strong>${escapeHtml(input.signatureName)}</strong>.</p>`
        : ""
    }
    ${
      input.rejectionReason
        ? `<p style="margin:16px 0 0;font-size:14px;color:#6b7280">Reason given: ${escapeHtml(input.rejectionReason)}</p>`
        : ""
    }`;

  const text = textBlock([
    `${input.respondedByName} ${verb} ${quotation.number}.`,
    "",
    `Customer: ${input.customerName}`,
    `For: ${quotation.title}`,
    `Value: ${total}`,
    `When: ${input.respondedAtLabel}`,
    input.signatureName ? `Signed as: ${input.signatureName}` : null,
    input.rejectionReason ? `Reason: ${input.rejectionReason}` : null,
    "",
    "Open it in QuoteFlow:",
    input.quotationUrl,
  ]);

  return {
    subject: accepted
      ? `Accepted: ${quotation.number} (${total})`
      : `Declined: ${quotation.number}`,
    html: layout({
      branding,
      heading: accepted ? "Your quotation was accepted" : "Your quotation was declined",
      bodyHtml,
      cta: { label: "Open the quotation", url: input.quotationUrl },
    }),
    text,
  };
}

export interface ViewedEmailInput {
  branding: EmailBranding;
  customerName: string;
  quotation: { number: string; title: string };
  quotationUrl: string;
  firstView: boolean;
}

export function renderViewedEmail(input: ViewedEmailInput): RenderedEmail {
  const bodyHtml = `
    <p style="margin:0 0 14px">
      <strong>${escapeHtml(input.customerName)}</strong> opened
      <strong>${escapeHtml(input.quotation.number)}</strong>${input.firstView ? " for the first time" : " again"}.
    </p>
    <p style="margin:0;font-size:14px;color:#6b7280">${escapeHtml(input.quotation.title)}</p>`;

  return {
    subject: `${input.customerName} opened ${input.quotation.number}`,
    html: layout({
      branding: input.branding,
      heading: "Your quotation was opened",
      bodyHtml,
      cta: { label: "Open the quotation", url: input.quotationUrl },
      footerNote: "You can turn these notifications off in your business profile.",
    }),
    text: textBlock([
      `${input.customerName} opened ${input.quotation.number}${input.firstView ? " for the first time" : " again"}.`,
      input.quotation.title,
      "",
      input.quotationUrl,
    ]),
  };
}

export interface FollowUpDigestInput {
  branding: EmailBranding;
  items: {
    quotationNumber: string;
    customerName: string;
    title: string;
    totalCents: number;
    currency: string;
    dueLabel: string;
    quotationUrl: string;
    note: string | null;
  }[];
}

/** The only email the scheduled job sends, and only when something is due. */
export function renderFollowUpDigest(input: FollowUpDigestInput): RenderedEmail {
  const { branding, items } = input;

  const rows = items
    .map(
      (item) => `
      <tr>
        <td style="padding:12px 14px;border-bottom:1px solid #f3f4f6;font-size:14px">
          <a href="${escapeHtml(item.quotationUrl)}" style="color:#111827;text-decoration:none;font-weight:600">
            ${escapeHtml(item.quotationNumber)}
          </a>
          <div style="color:#6b7280;font-size:13px">${escapeHtml(item.customerName)} &middot; ${escapeHtml(item.title)}</div>
          ${item.note ? `<div style="color:#6b7280;font-size:13px">${escapeHtml(item.note)}</div>` : ""}
        </td>
        <td style="padding:12px 14px;border-bottom:1px solid #f3f4f6;font-size:14px;text-align:right;white-space:nowrap">
          ${escapeHtml(formatMoney(item.totalCents, item.currency, branding.locale))}
          <div style="color:#6b7280;font-size:13px">${escapeHtml(item.dueLabel)}</div>
        </td>
      </tr>`,
    )
    .join("");

  const bodyHtml = `
    <p style="margin:0 0 18px">
      ${items.length === 1 ? "One quotation is" : `${items.length} quotations are`} waiting on a follow-up.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0"
           style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px">
      ${rows}
    </table>
    <p style="margin:18px 0 0;font-size:13px;color:#6b7280">
      QuoteFlow does not contact your customers for you — these are reminders for you to reach out.
    </p>`;

  const text = textBlock([
    `${items.length === 1 ? "One quotation is" : `${items.length} quotations are`} waiting on a follow-up.`,
    "",
    ...items.map(
      (item) =>
        `- ${item.quotationNumber} · ${item.customerName} · ${formatMoney(item.totalCents, item.currency, branding.locale)} · due ${item.dueLabel}\n  ${item.quotationUrl}`,
    ),
    "",
    "QuoteFlow does not contact your customers for you — these are reminders for you to reach out.",
  ]);

  return {
    subject:
      items.length === 1
        ? `Follow up on ${items[0]!.quotationNumber}`
        : `${items.length} follow-ups due`,
    html: layout({
      branding,
      heading: "Follow-ups due",
      bodyHtml,
      footerNote: "You can turn these off in your business profile.",
    }),
    text,
  };
}

export interface PortalEmailInput {
  branding: EmailBranding;
  customerName: string;
  portalUrl: string;
  expiresLabel: string;
  message?: string | null;
}

export function renderPortalEmail(input: PortalEmailInput): RenderedEmail {
  const firstName = input.customerName.split(" ")[0] ?? input.customerName;
  const intro =
    input.message?.trim() ||
    "Here is a private link to every quotation we have sent you. Keep it somewhere safe — anyone with the link can see them.";

  const bodyHtml = `
    <p style="margin:0 0 14px">Hi ${escapeHtml(firstName)},</p>
    <p style="margin:0 0 6px;white-space:pre-wrap">${escapeHtml(intro)}</p>
    <p style="margin:0;font-size:13px;color:#6b7280">This link works until ${escapeHtml(input.expiresLabel)}.</p>`;

  return {
    subject: `Your quotations from ${input.branding.businessName}`,
    html: layout({
      branding: input.branding,
      heading: `Your quotations from ${input.branding.businessName}`,
      bodyHtml,
      cta: { label: "Open your quotations", url: input.portalUrl },
    }),
    text: textBlock([
      `Hi ${firstName},`,
      "",
      intro,
      "",
      input.portalUrl,
      "",
      `This link works until ${input.expiresLabel}.`,
      `— ${input.branding.businessName}`,
    ]),
  };
}

/**
 * Branding for messages that come from QuoteFlow itself rather than from a
 * business: a password reset is from the product, and dressing it in a
 * tenant's logo would misattribute it.
 */
export const PRODUCT_BRANDING: EmailBranding = {
  businessName: "QuoteFlow AI",
  brandColor: null,
  locale: "en-US",
};

export interface PasswordResetEmailInput {
  name: string;
  resetUrl: string;
  expiresLabel: string;
}

export function renderPasswordResetEmail(input: PasswordResetEmailInput): RenderedEmail {
  const bodyHtml = `
    <p style="margin:0 0 14px">Hi ${escapeHtml(input.name)},</p>
    <p style="margin:0 0 14px">
      Someone asked to reset the password on your QuoteFlow account. Use the button below to
      choose a new one.
    </p>
    <p style="margin:0;font-size:13px;color:#6b7280">
      The link stops working ${escapeHtml(input.expiresLabel)}, and signs you out everywhere once used.
    </p>`;

  return {
    subject: "Reset your QuoteFlow password",
    html: layout({
      branding: PRODUCT_BRANDING,
      heading: "Reset your password",
      bodyHtml,
      cta: { label: "Choose a new password", url: input.resetUrl },
      footerNote: "If you did not ask for this, ignore this email — your password is unchanged.",
    }),
    text: textBlock([
      `Hi ${input.name},`,
      "",
      "Someone asked to reset the password on your QuoteFlow account.",
      "Choose a new one here:",
      input.resetUrl,
      "",
      `The link stops working ${input.expiresLabel}, and signs you out everywhere once used.`,
      "If you did not ask for this, ignore this email — your password is unchanged.",
    ]),
  };
}

export interface VerifyEmailInput {
  name: string;
  verifyUrl: string;
  expiresLabel: string;
}

export function renderVerifyEmail(input: VerifyEmailInput): RenderedEmail {
  const bodyHtml = `
    <p style="margin:0 0 14px">Hi ${escapeHtml(input.name)},</p>
    <p style="margin:0 0 14px">
      Confirm this address so QuoteFlow can email quotations on your behalf and reach you when a
      customer responds.
    </p>
    <p style="margin:0;font-size:13px;color:#6b7280">
      This link works until ${escapeHtml(input.expiresLabel)}.
    </p>`;

  return {
    subject: "Confirm your email address",
    html: layout({
      branding: PRODUCT_BRANDING,
      heading: "Confirm your email address",
      bodyHtml,
      cta: { label: "Confirm my address", url: input.verifyUrl },
      footerNote: "If you did not create a QuoteFlow account, ignore this email.",
    }),
    text: textBlock([
      `Hi ${input.name},`,
      "",
      "Confirm this address so QuoteFlow can email quotations on your behalf",
      "and reach you when a customer responds:",
      input.verifyUrl,
      "",
      `This link works until ${input.expiresLabel}.`,
      "If you did not create a QuoteFlow account, ignore this email.",
    ]),
  };
}

export interface InvitationEmailInput {
  branding: EmailBranding;
  workspaceName: string;
  invitedByName: string;
  roleLabel: string;
  roleDescription: string;
  inviteUrl: string;
  expiresLabel: string;
  /** True when the address already has a QuoteFlow account. */
  hasAccount: boolean;
}

export function renderInvitationEmail(input: InvitationEmailInput): RenderedEmail {
  const bodyHtml = `
    <p style="margin:0 0 14px">
      ${escapeHtml(input.invitedByName)} invited you to join
      <strong>${escapeHtml(input.workspaceName)}</strong> on QuoteFlow as
      <strong>${escapeHtml(input.roleLabel)}</strong>.
    </p>
    <p style="margin:0 0 14px;font-size:14px;color:#4b5563">${escapeHtml(input.roleDescription)}</p>
    <p style="margin:0;font-size:13px;color:#6b7280">
      ${
        input.hasAccount
          ? "Sign in with this address to accept."
          : "You will pick a password when you accept."
      }
      The invitation expires ${escapeHtml(input.expiresLabel)}.
    </p>`;

  return {
    subject: `${input.invitedByName} invited you to ${input.workspaceName} on QuoteFlow`,
    html: layout({
      branding: input.branding,
      heading: `Join ${input.workspaceName}`,
      bodyHtml,
      cta: { label: "Accept the invitation", url: input.inviteUrl },
      footerNote: "If you were not expecting this, you can ignore it — nothing happens until you accept.",
    }),
    text: textBlock([
      `${input.invitedByName} invited you to join ${input.workspaceName} on QuoteFlow as ${input.roleLabel}.`,
      "",
      input.roleDescription,
      "",
      "Accept here:",
      input.inviteUrl,
      "",
      input.hasAccount
        ? "Sign in with this address to accept."
        : "You will pick a password when you accept.",
      `The invitation expires ${input.expiresLabel}.`,
      "If you were not expecting this, you can ignore it — nothing happens until you accept.",
    ]),
  };
}
