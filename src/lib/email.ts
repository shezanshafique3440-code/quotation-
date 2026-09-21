import nodemailer, { type Transporter } from "nodemailer";
import { getEnv, isEmailConfigured } from "./env";
import { NotConfiguredError } from "./errors";

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string | undefined;
}

export interface SendResult {
  ok: boolean;
  provider: string;
  /** Present only on a genuine success. */
  providerMessageId?: string;
  /** Present only on a failure; safe to show to the sender. */
  error?: string;
}

/**
 * The narrow contract every provider implements, and the seam tests replace.
 * A transport either returns an id the provider gave us, or it throws.
 */
export interface EmailTransport {
  readonly name: string;
  send(message: EmailMessage, from: string): Promise<string>;
}

/** RFC-ish address check: enough to refuse obvious junk before a network call. */
const ADDRESS = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/;

export function isValidEmailAddress(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length <= 254 && ADDRESS.test(trimmed);
}

/** Pull the bare address out of `Name <addr@example.com>`. */
export function bareAddress(value: string): string {
  const match = /<([^>]+)>/.exec(value);
  return (match?.[1] ?? value).trim();
}

class ResendTransport implements EmailTransport {
  readonly name = "resend";

  constructor(private readonly apiKey: string) {}

  async send(message: EmailMessage, from: string): Promise<string> {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
        ...(message.replyTo ? { reply_to: message.replyTo } : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      // Read the provider's own reason rather than inventing one.
      const detail = await response.text().catch(() => "");
      throw new Error(
        `Resend rejected the message (${response.status})${detail ? `: ${detail.slice(0, 300)}` : ""}`,
      );
    }

    const payload = (await response.json().catch(() => null)) as { id?: string } | null;
    if (!payload?.id) {
      throw new Error("Resend accepted the request but returned no message id.");
    }
    return payload.id;
  }
}

class SmtpTransport implements EmailTransport {
  readonly name = "smtp";

  constructor(private readonly transporter: Transporter) {}

  async send(message: EmailMessage, from: string): Promise<string> {
    const info = await this.transporter.sendMail({
      from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
      ...(message.replyTo ? { replyTo: message.replyTo } : {}),
    });

    // A rejected recipient means the server did not accept delivery.
    if (info.rejected && info.rejected.length > 0) {
      throw new Error(`The mail server rejected ${info.rejected.join(", ")}.`);
    }
    if (!info.messageId) {
      throw new Error("The mail server accepted the message but returned no id.");
    }
    return info.messageId;
  }
}

let transport: EmailTransport | null = null;

/** Test seam: inject a stub so the suite never opens a socket. */
export function __setEmailTransportForTests(stub: EmailTransport | null): void {
  transport = stub;
}

export function getEmailTransport(): EmailTransport {
  if (!isEmailConfigured()) {
    throw new NotConfiguredError(
      "Email is not configured on this deployment. Set EMAIL_PROVIDER, EMAIL_FROM and the provider credentials to enable sending.",
    );
  }
  if (transport) return transport;

  const env = getEnv();
  if (env.EMAIL_PROVIDER === "resend") {
    transport = new ResendTransport(env.RESEND_API_KEY!);
  } else {
    transport = new SmtpTransport(
      nodemailer.createTransport({
        host: env.SMTP_HOST!,
        port: env.SMTP_PORT,
        secure: env.SMTP_SECURE,
        ...(env.SMTP_USER && env.SMTP_PASSWORD
          ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } }
          : {}),
      }),
    );
  }
  return transport;
}

/**
 * Attempt one send.
 *
 * Returns a result rather than throwing on provider failure, so the caller can
 * record what actually happened. It never reports success without an id from
 * the provider.
 */
export async function sendEmail(message: EmailMessage): Promise<SendResult> {
  const env = getEnv();

  if (!isValidEmailAddress(message.to)) {
    return {
      ok: false,
      provider: env.EMAIL_PROVIDER,
      error: `"${message.to}" is not a valid email address.`,
    };
  }

  let active: EmailTransport;
  try {
    active = getEmailTransport();
  } catch (error) {
    return {
      ok: false,
      provider: env.EMAIL_PROVIDER,
      error: error instanceof Error ? error.message : "Email is not configured.",
    };
  }

  try {
    const providerMessageId = await active.send(message, env.EMAIL_FROM!);
    return { ok: true, provider: active.name, providerMessageId };
  } catch (error) {
    return {
      ok: false,
      provider: active.name,
      error: error instanceof Error ? error.message : "The email could not be sent.",
    };
  }
}
