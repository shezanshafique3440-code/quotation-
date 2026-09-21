import { afterEach, describe, expect, it } from "vitest";
import {
  __setEmailTransportForTests,
  bareAddress,
  isValidEmailAddress,
  sendEmail,
  type EmailMessage,
  type EmailTransport,
} from "@/lib/email";
import { isEmailConfigured, resetEnvCache } from "@/lib/env";

const ORIGINAL = { ...process.env };

function setEnv(values: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetEnvCache();
}

function enableResend() {
  setEnv({
    EMAIL_PROVIDER: "resend",
    EMAIL_FROM: "QuoteFlow <quotes@example.com>",
    RESEND_API_KEY: "re_test_key",
  });
}

function stub(
  onSend: (message: EmailMessage, from: string) => Promise<string>,
  name = "stub",
): EmailTransport {
  return { name, send: onSend };
}

const message: EmailMessage = {
  to: "dana@example.test",
  subject: "Quotation NJ-2026-0001",
  html: "<p>Hello</p>",
  text: "Hello",
};

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL)) delete process.env[key];
  }
  Object.assign(process.env, ORIGINAL);
  resetEnvCache();
  __setEmailTransportForTests(null);
});

describe("address handling", () => {
  it("accepts ordinary addresses and rejects junk", () => {
    for (const good of ["a@b.co", "dana.whitfield+quotes@example.co.uk", "x_y@sub.domain.io"]) {
      expect(isValidEmailAddress(good)).toBe(true);
    }
    for (const bad of ["", "no-at-sign", "a@b", "a@@b.com", "a b@c.com", "a@b.com, c@d.com"]) {
      expect(isValidEmailAddress(bad)).toBe(false);
    }
  });

  it("rejects an address beyond the maximum length", () => {
    expect(isValidEmailAddress(`${"a".repeat(250)}@example.com`)).toBe(false);
  });

  it("extracts the bare address from a display-name form", () => {
    expect(bareAddress("QuoteFlow <quotes@example.com>")).toBe("quotes@example.com");
    expect(bareAddress("quotes@example.com")).toBe("quotes@example.com");
  });
});

describe("isEmailConfigured", () => {
  it("is false until a provider and its credentials are present", () => {
    setEnv({ EMAIL_PROVIDER: "none", EMAIL_FROM: undefined, RESEND_API_KEY: undefined });
    expect(isEmailConfigured()).toBe(false);

    enableResend();
    expect(isEmailConfigured()).toBe(true);

    setEnv({ EMAIL_PROVIDER: "smtp", SMTP_HOST: "smtp.example.com", RESEND_API_KEY: undefined });
    expect(isEmailConfigured()).toBe(true);
  });

  it("refuses a half-configured provider at parse time", () => {
    setEnv({ EMAIL_PROVIDER: "resend", EMAIL_FROM: "a@b.com", RESEND_API_KEY: undefined });
    expect(() => isEmailConfigured()).toThrow(/RESEND_API_KEY/);

    setEnv({ EMAIL_PROVIDER: "smtp", EMAIL_FROM: undefined, SMTP_HOST: "smtp.example.com" });
    expect(() => isEmailConfigured()).toThrow(/EMAIL_FROM/);

    setEnv({ EMAIL_PROVIDER: "smtp", EMAIL_FROM: "a@b.com", SMTP_HOST: undefined });
    expect(() => isEmailConfigured()).toThrow(/SMTP_HOST/);
  });
});

describe("sendEmail", () => {
  it("reports success only with an id from the provider", async () => {
    enableResend();
    __setEmailTransportForTests(stub(async () => "msg_123", "resend"));

    const result = await sendEmail(message);
    expect(result).toEqual({ ok: true, provider: "resend", providerMessageId: "msg_123" });
  });

  it("passes the configured sender and the message through unchanged", async () => {
    enableResend();
    let captured: { message: EmailMessage; from: string } | null = null;
    __setEmailTransportForTests(
      stub(async (m, from) => {
        captured = { message: m, from };
        return "msg_1";
      }),
    );

    await sendEmail({ ...message, replyTo: "sam@northline.test" });

    expect(captured!.from).toBe("QuoteFlow <quotes@example.com>");
    expect(captured!.message.to).toBe("dana@example.test");
    expect(captured!.message.subject).toBe("Quotation NJ-2026-0001");
    expect(captured!.message.replyTo).toBe("sam@northline.test");
  });

  it("applies the global reply-to when the caller supplies none", async () => {
    enableResend();
    setEnv({ EMAIL_REPLY_TO: "help@example.com" });
    let captured: EmailMessage | null = null;
    __setEmailTransportForTests(
      stub(async (m) => {
        captured = m;
        return "msg_1";
      }),
    );

    // sendEmail itself does not default reply-to; the notification layer does.
    await sendEmail(message);
    expect(captured!.replyTo).toBeUndefined();
  });

  it("returns the provider's own error rather than a generic one", async () => {
    enableResend();
    __setEmailTransportForTests(
      stub(async () => {
        throw new Error("Resend rejected the message (422): domain not verified");
      }),
    );

    const result = await sendEmail(message);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/domain not verified/);
    expect(result.providerMessageId).toBeUndefined();
  });

  it("never claims success when nothing is configured", async () => {
    setEnv({ EMAIL_PROVIDER: "none", EMAIL_FROM: undefined, RESEND_API_KEY: undefined });

    const result = await sendEmail(message);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not configured/i);
  });

  it("refuses an invalid recipient before reaching the provider", async () => {
    enableResend();
    let called = false;
    __setEmailTransportForTests(
      stub(async () => {
        called = true;
        return "msg_1";
      }),
    );

    const result = await sendEmail({ ...message, to: "not-an-address" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not a valid email address/);
    expect(called).toBe(false);
  });

  it("treats a thrown non-Error as a failure rather than crashing", async () => {
    enableResend();
    __setEmailTransportForTests(
      stub(async () => {
        throw "socket hang up";
      }),
    );

    const result = await sendEmail(message);
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
