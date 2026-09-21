import { z } from "zod";

/**
 * Environment configuration.
 *
 * Everything optional degrades to a *disabled* feature rather than a fake one:
 * with no AI key configured the AI endpoints return a clear "not configured"
 * error, and with no Stripe key the upgrade flow says billing is unavailable
 * instead of silently marking an organization as paid.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  APP_URL: z.string().url().default("http://localhost:3000"),

  /** Used to derive the session cookie MAC. Required outside development. */
  SESSION_SECRET: z.string().min(32).optional(),

  /** "anthropic" enables AI drafting; "none" disables it explicitly. */
  AI_PROVIDER: z.enum(["anthropic", "none"]).default("none"),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  AI_MODEL: z.string().min(1).default("claude-sonnet-5"),
  AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().max(16000).default(4000),

  /** "stripe" enables checkout; "none" disables paid upgrades. */
  BILLING_PROVIDER: z.enum(["stripe", "none"]).default("none"),
  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
  STRIPE_PRICE_ID_PRO: z.string().min(1).optional(),

  /**
   * Outbound email. "none" disables sending entirely — the UI then says so
   * rather than offering a button that silently does nothing.
   */
  EMAIL_PROVIDER: z.enum(["resend", "smtp", "none"]).default("none"),
  /** Envelope sender: "QuoteFlow <quotes@example.com>" or a bare address. */
  EMAIL_FROM: z.string().min(3).optional(),
  EMAIL_REPLY_TO: z.string().min(3).optional(),

  RESEND_API_KEY: z.string().min(1).optional(),

  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().positive().max(65535).default(587),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASSWORD: z.string().min(1).optional(),
  SMTP_SECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),

  /** Shared secret for the reminder-dispatch cron endpoint. */
  CRON_SECRET: z.string().min(16).optional(),

  /**
   * Whether a trusted proxy rewrites `x-forwarded-for`. Leave false when the
   * app is exposed directly: a spoofable header would let one caller pick a
   * fresh rate-limit bucket per request.
   */
  TRUST_PROXY_HEADERS: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),

  /**
   * Escape hatch for running a production build against http://localhost, so a
   * release can be smoke-tested before it ships. It only ever relaxes the
   * localhost case — an http URL on a real hostname is still refused.
   */
  ALLOW_INSECURE_LOCAL: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),

  /** Set false to disable public share pages fleet-wide (incident switch). */
  PUBLIC_PAGES_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;

  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${detail}`);
  }

  const env = parsed.data;

  // `next build` runs with NODE_ENV=production on a machine that has no
  // production secrets, and legitimately so. The fatal checks below are about
  // how the server *runs*, so they are deferred to start-up
  // (src/instrumentation.ts) rather than failing the build.
  const buildPhase = process.env.NEXT_PHASE === "phase-production-build";
  const fatal: string[] = [];

  if (env.NODE_ENV === "production" && !buildPhase) {
    if (!env.SESSION_SECRET) {
      fatal.push("SESSION_SECRET is required in production (min 32 characters).");
    } else if (isWeakSecret(env.SESSION_SECRET)) {
      fatal.push(
        "SESSION_SECRET looks like a placeholder. Generate one with `openssl rand -base64 48`.",
      );
    }

    const appUrl = new URL(env.APP_URL);
    const isLoopback = appUrl.hostname === "localhost" || appUrl.hostname === "127.0.0.1";

    if (isLoopback && env.ALLOW_INSECURE_LOCAL) {
      // Explicitly opted in to a local production build; nothing to enforce.
    } else {
      if (appUrl.protocol !== "https:") {
        fatal.push(`APP_URL must use https in production (got ${appUrl.protocol}//).`);
      }
      if (isLoopback) {
        fatal.push(
          "APP_URL must be the public origin in production, not localhost. Set ALLOW_INSECURE_LOCAL=true only to smoke-test a build on your own machine.",
        );
      }
    }
    if (env.BILLING_PROVIDER === "stripe" && !env.STRIPE_WEBHOOK_SECRET) {
      fatal.push(
        "STRIPE_WEBHOOK_SECRET is required in production: without it webhooks cannot be verified, so no subscription would ever activate.",
      );
    }
  }

  if (fatal.length > 0) {
    throw new Error(`Unsafe production configuration:\n  - ${fatal.join("\n  - ")}`);
  }
  if (env.AI_PROVIDER === "anthropic" && !env.ANTHROPIC_API_KEY) {
    throw new Error("AI_PROVIDER=anthropic requires ANTHROPIC_API_KEY.");
  }
  if (env.BILLING_PROVIDER === "stripe" && !env.STRIPE_SECRET_KEY) {
    throw new Error("BILLING_PROVIDER=stripe requires STRIPE_SECRET_KEY.");
  }
  if (env.BILLING_PROVIDER === "stripe" && !env.STRIPE_PRICE_ID_PRO) {
    throw new Error("BILLING_PROVIDER=stripe requires STRIPE_PRICE_ID_PRO.");
  }
  if (env.EMAIL_PROVIDER !== "none" && !env.EMAIL_FROM) {
    throw new Error(`EMAIL_PROVIDER=${env.EMAIL_PROVIDER} requires EMAIL_FROM.`);
  }
  if (env.EMAIL_PROVIDER === "resend" && !env.RESEND_API_KEY) {
    throw new Error("EMAIL_PROVIDER=resend requires RESEND_API_KEY.");
  }
  if (env.EMAIL_PROVIDER === "smtp" && !env.SMTP_HOST) {
    throw new Error("EMAIL_PROVIDER=smtp requires SMTP_HOST.");
  }

  cached = env;
  return env;
}

/** Test helper: forget the memoised parse so a new process.env is picked up. */
export function resetEnvCache(): void {
  cached = null;
}

/**
 * Re-run the production checks that `getEnv` defers during `next build`.
 *
 * Called once from `instrumentation.ts` when the server boots, so a
 * misconfigured deployment dies immediately and loudly instead of serving
 * traffic with an insecure session secret or an unverifiable webhook.
 */
export function assertProductionSafe(): void {
  const previousPhase = process.env.NEXT_PHASE;
  delete process.env.NEXT_PHASE;
  cached = null;
  try {
    getEnv();
  } finally {
    if (previousPhase !== undefined) process.env.NEXT_PHASE = previousPhase;
  }
}

/** Obvious placeholders that would otherwise pass a length check. */
function isWeakSecret(secret: string): boolean {
  const normalized = secret.trim().toLowerCase();
  if (/^(.)\1*$/.test(normalized)) return true;
  return [
    "changeme",
    "change-me",
    "placeholder",
    "secret",
    "password",
    "build-time",
    "example",
    "your-secret",
    "todo",
  ].some((weak) => normalized.includes(weak));
}

export interface EnvironmentReport {
  nodeEnv: string;
  ai: boolean;
  billing: boolean;
  email: boolean;
  cron: boolean;
  publicPages: boolean;
  trustProxyHeaders: boolean;
  /** Non-fatal configuration that will bite in production. */
  warnings: string[];
}

/**
 * Configuration summary for the health endpoint and the settings screen.
 * Reports what is actually on — never claims an integration that is absent.
 */
export function describeEnvironment(): EnvironmentReport {
  const env = getEnv();
  const warnings: string[] = [];

  if (env.NODE_ENV === "production") {
    if (env.DATABASE_URL.startsWith("file:")) {
      warnings.push(
        "DATABASE_URL points at a SQLite file. Use PostgreSQL for multi-instance deployments.",
      );
    }
    if (!env.CRON_SECRET) {
      warnings.push(
        "CRON_SECRET is unset, so quote expiry and the follow-up digest will never run.",
      );
    }
    if (!env.TRUST_PROXY_HEADERS) {
      warnings.push(
        "TRUST_PROXY_HEADERS is false, so rate limits are applied globally rather than per client.",
      );
    }
    if (!isEmailConfigured()) {
      warnings.push(
        "No email provider is configured, so quotations cannot be emailed and nobody is notified when a customer responds.",
      );
    }
    if (env.ALLOW_INSECURE_LOCAL) {
      warnings.push(
        "ALLOW_INSECURE_LOCAL is set. This is only for smoke-testing a build locally — never set it on a deployed server.",
      );
    }
  }

  return {
    nodeEnv: env.NODE_ENV,
    ai: isAiConfigured(),
    billing: isBillingConfigured(),
    email: isEmailConfigured(),
    cron: Boolean(env.CRON_SECRET),
    publicPages: env.PUBLIC_PAGES_ENABLED,
    trustProxyHeaders: env.TRUST_PROXY_HEADERS,
    warnings,
  };
}

export function isAiConfigured(): boolean {
  const env = getEnv();
  return env.AI_PROVIDER === "anthropic" && Boolean(env.ANTHROPIC_API_KEY);
}

export function isEmailConfigured(): boolean {
  const env = getEnv();
  if (env.EMAIL_PROVIDER === "none" || !env.EMAIL_FROM) return false;
  if (env.EMAIL_PROVIDER === "resend") return Boolean(env.RESEND_API_KEY);
  return Boolean(env.SMTP_HOST);
}

export function isBillingConfigured(): boolean {
  const env = getEnv();
  return (
    env.BILLING_PROVIDER === "stripe" &&
    Boolean(env.STRIPE_SECRET_KEY) &&
    Boolean(env.STRIPE_PRICE_ID_PRO)
  );
}
