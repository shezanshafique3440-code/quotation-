import { describe, expect, it } from "vitest";
import {
  escapeHtml,
  renderDecisionEmail,
  renderFollowUpDigest,
  renderInvitationEmail,
  renderPasswordResetEmail,
  renderPortalEmail,
  renderQuotationEmail,
  renderVerifyEmail,
  renderViewedEmail,
  type EmailBranding,
} from "@/lib/email-templates";

const branding: EmailBranding = {
  businessName: "Northline Joinery Ltd",
  brandColor: "#1f7a5a",
  locale: "en-GB",
  website: "https://northline.test",
  phone: "+441132960000",
};

describe("escapeHtml", () => {
  it("neutralises every character that could break out of markup", () => {
    expect(escapeHtml(`<script>alert("x")</script>`)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;",
    );
    expect(escapeHtml("Tom & Jerry's")).toBe("Tom &amp; Jerry&#39;s");
  });
});

describe("renderQuotationEmail", () => {
  const input = {
    branding,
    customerName: "Dana Whitfield",
    quotation: {
      number: "NJ-2026-0001",
      title: "Alcove shelving",
      totalCents: 245_759,
      currency: "GBP",
      validUntilLabel: "13 Oct 2026",
      notes: null,
    },
    shareUrl: "https://app.example.com/q/abc123",
    requireSignature: true,
  };

  it("carries the number, total, validity and link in both parts", () => {
    const email = renderQuotationEmail(input);

    expect(email.subject).toBe("Quotation NJ-2026-0001 from Northline Joinery Ltd");
    for (const part of [email.html, email.text]) {
      expect(part).toContain("NJ-2026-0001");
      expect(part).toContain("Alcove shelving");
      expect(part).toContain("2,457.59");
      expect(part).toContain("https://app.example.com/q/abc123");
    }
    expect(email.text).toContain("13 Oct 2026");
  });

  it("uses the sender's own note when given one", () => {
    const email = renderQuotationEmail({ ...input, message: "Thanks for the call this morning." });
    expect(email.html).toContain("Thanks for the call this morning.");
    expect(email.text).toContain("Thanks for the call this morning.");
  });

  it("mentions the signature only when one is required", () => {
    expect(renderQuotationEmail(input).html).toMatch(/electronic signature/i);
    expect(renderQuotationEmail({ ...input, requireSignature: false }).html).not.toMatch(
      /electronic signature/i,
    );
  });

  it("escapes hostile customer and business names", () => {
    const email = renderQuotationEmail({
      ...input,
      customerName: `<img src=x onerror="alert(1)">`,
      branding: { ...branding, businessName: "<b>Evil</b>" },
    });
    expect(email.html).not.toContain("<img src=x");
    expect(email.html).not.toContain("<b>Evil</b>");
    expect(email.html).toContain("&lt;b&gt;Evil&lt;/b&gt;");
  });

  it("renders a zero-decimal currency without a fractional part", () => {
    const email = renderQuotationEmail({
      ...input,
      quotation: { ...input.quotation, currency: "JPY", totalCents: 240_000 },
    });
    expect(email.text).toMatch(/240,000/);
    expect(email.text).not.toMatch(/240,000\.00/);
  });
});

describe("renderDecisionEmail", () => {
  const base = {
    branding,
    customerName: "Dana Whitfield",
    respondedByName: "Dana Whitfield",
    quotation: {
      number: "NJ-2026-0001",
      title: "Alcove shelving",
      totalCents: 245_759,
      currency: "GBP",
    },
    quotationUrl: "https://app.example.com/quotations/q1",
    respondedAtLabel: "22 Sept 2026, 14:05",
  };

  it("says accepted, with the value in the subject", () => {
    const email = renderDecisionEmail({ ...base, decision: "accepted" });
    expect(email.subject).toContain("Accepted: NJ-2026-0001");
    expect(email.subject).toContain("2,457.59");
    expect(email.html).toMatch(/accepted/);
    expect(email.text).toContain("https://app.example.com/quotations/q1");
  });

  it("says declined, and carries the reason when one was given", () => {
    const email = renderDecisionEmail({
      ...base,
      decision: "declined",
      rejectionReason: "Went with another supplier",
    });
    expect(email.subject).toBe("Declined: NJ-2026-0001");
    expect(email.html).toContain("Went with another supplier");
    expect(email.text).toContain("Went with another supplier");
  });

  it("reports a signature only when one exists", () => {
    const signed = renderDecisionEmail({
      ...base,
      decision: "accepted",
      signatureName: "Dana Whitfield",
    });
    expect(signed.text).toMatch(/Signed as: Dana Whitfield/);
    expect(renderDecisionEmail({ ...base, decision: "accepted" }).text).not.toMatch(/Signed as/);
  });
});

describe("renderViewedEmail", () => {
  it("distinguishes a first open from a repeat", () => {
    const first = renderViewedEmail({
      branding,
      customerName: "Dana",
      quotation: { number: "NJ-1", title: "Job" },
      quotationUrl: "https://app.example.com/q",
      firstView: true,
    });
    expect(first.text).toMatch(/for the first time/);

    const again = renderViewedEmail({
      branding,
      customerName: "Dana",
      quotation: { number: "NJ-1", title: "Job" },
      quotationUrl: "https://app.example.com/q",
      firstView: false,
    });
    expect(again.text).toMatch(/again/);
  });

  it("tells the recipient how to stop receiving them", () => {
    const email = renderViewedEmail({
      branding,
      customerName: "Dana",
      quotation: { number: "NJ-1", title: "Job" },
      quotationUrl: "https://app.example.com/q",
      firstView: true,
    });
    expect(email.html).toMatch(/turn these notifications off/i);
  });
});

describe("renderFollowUpDigest", () => {
  const item = {
    quotationNumber: "NJ-2026-0001",
    customerName: "Dana Whitfield",
    title: "Alcove shelving",
    totalCents: 245_759,
    currency: "GBP",
    dueLabel: "22 Sept 2026",
    quotationUrl: "https://app.example.com/quotations/q1",
    note: "Check the oak option",
  };

  it("uses singular wording for one item", () => {
    const email = renderFollowUpDigest({ branding, items: [item] });
    expect(email.subject).toBe("Follow up on NJ-2026-0001");
    expect(email.html).toMatch(/One quotation is/);
  });

  it("counts and lists several", () => {
    const email = renderFollowUpDigest({
      branding,
      items: [item, { ...item, quotationNumber: "NJ-2026-0002" }],
    });
    expect(email.subject).toBe("2 follow-ups due");
    expect(email.text).toContain("NJ-2026-0001");
    expect(email.text).toContain("NJ-2026-0002");
  });

  it("states plainly that QuoteFlow contacts nobody on the owner's behalf", () => {
    const email = renderFollowUpDigest({ branding, items: [item] });
    expect(email.html).toMatch(/does not contact your customers for you/i);
    expect(email.text).toMatch(/does not contact your customers for you/i);
  });
});

describe("renderPortalEmail", () => {
  it("carries the link and its expiry", () => {
    const email = renderPortalEmail({
      branding,
      customerName: "Dana Whitfield",
      portalUrl: "https://app.example.com/portal/tok",
      expiresLabel: "20 Mar 2027",
    });
    expect(email.subject).toBe("Your quotations from Northline Joinery Ltd");
    expect(email.html).toContain("https://app.example.com/portal/tok");
    expect(email.text).toContain("20 Mar 2027");
  });

  it("warns that anyone with the link can see the quotations", () => {
    const email = renderPortalEmail({
      branding,
      customerName: "Dana",
      portalUrl: "https://app.example.com/portal/tok",
      expiresLabel: "20 Mar 2027",
    });
    expect(email.text).toMatch(/anyone with the link/i);
  });
});

describe("renderPasswordResetEmail", () => {
  const input = {
    name: "Sam Rivera",
    resetUrl: "https://app.example.com/reset-password/tok",
    expiresLabel: "at 21 Sept 2026, 11:00",
  };

  it("carries the link in both parts", () => {
    const email = renderPasswordResetEmail(input);
    expect(email.html).toContain(input.resetUrl);
    expect(email.text).toContain(input.resetUrl);
  });

  it("is branded as QuoteFlow, not as a tenant", () => {
    const email = renderPasswordResetEmail(input);
    expect(email.subject).toMatch(/QuoteFlow/);
    expect(email.html).not.toMatch(/Northline/);
  });

  it("says what happens if the request was not theirs", () => {
    const email = renderPasswordResetEmail(input);
    expect(email.html).toMatch(/your password is unchanged/i);
    expect(email.text).toMatch(/your password is unchanged/i);
  });

  it("warns that using it signs them out everywhere", () => {
    expect(renderPasswordResetEmail(input).text).toMatch(/signs you out everywhere/i);
  });

  it("escapes a name that contains markup", () => {
    const email = renderPasswordResetEmail({ ...input, name: '<img src=x onerror="alert(1)">' });
    expect(email.html).not.toContain("<img");
    expect(email.html).toContain("&lt;img");
  });
});

describe("renderVerifyEmail", () => {
  const input = {
    name: "Sam Rivera",
    verifyUrl: "https://app.example.com/verify-email/tok",
    expiresLabel: "24 Sept 2026, 10:00",
  };

  it("carries the link and the deadline", () => {
    const email = renderVerifyEmail(input);
    expect(email.html).toContain(input.verifyUrl);
    expect(email.text).toContain("24 Sept 2026, 10:00");
  });

  it("explains why confirming matters", () => {
    expect(renderVerifyEmail(input).text).toMatch(/email quotations on your behalf/i);
  });
});

describe("renderInvitationEmail", () => {
  const input = {
    branding,
    workspaceName: "Northline Joinery Ltd",
    invitedByName: "Sam Rivera",
    roleLabel: "Member",
    roleDescription: "Quotes, customers, catalog and follow-ups.",
    inviteUrl: "https://app.example.com/invite/tok",
    expiresLabel: "6 Oct 2026",
    hasAccount: false,
  };

  it("names the workspace, the inviter and the role", () => {
    const email = renderInvitationEmail(input);
    expect(email.subject).toBe("Sam Rivera invited you to Northline Joinery Ltd on QuoteFlow");
    expect(email.html).toContain("Northline Joinery Ltd");
    expect(email.text).toContain("Member");
  });

  it("tells a newcomer they will pick a password", () => {
    const email = renderInvitationEmail(input);
    expect(email.text).toMatch(/pick a password/i);
  });

  it("tells an existing account to sign in instead", () => {
    const email = renderInvitationEmail({ ...input, hasAccount: true });
    expect(email.text).toMatch(/sign in with this address/i);
    expect(email.text).not.toMatch(/pick a password/i);
  });

  it("promises that nothing happens until they accept", () => {
    expect(renderInvitationEmail(input).text).toMatch(/nothing happens until you accept/i);
  });

  it("escapes an inviter name containing markup", () => {
    const email = renderInvitationEmail({ ...input, invitedByName: "<script>x</script>" });
    expect(email.html).not.toContain("<script>");
  });
});
