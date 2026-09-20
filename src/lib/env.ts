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

  /** Shared secret for the reminder-dispatch cron endpoint. */
  CRON_SECRET: z.string().min(16).optional(),
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

  if (env.NODE_ENV === "production" && !env.SESSION_SECRET) {
    throw new Error("SESSION_SECRET is required in production (min 32 characters).");
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

  cached = env;
  return env;
}

/** Test helper: forget the memoised parse so a new process.env is picked up. */
export function resetEnvCache(): void {
  cached = null;
}

export function isAiConfigured(): boolean {
  const env = getEnv();
  return env.AI_PROVIDER === "anthropic" && Boolean(env.ANTHROPIC_API_KEY);
}

export function isBillingConfigured(): boolean {
  const env = getEnv();
  return (
    env.BILLING_PROVIDER === "stripe" &&
    Boolean(env.STRIPE_SECRET_KEY) &&
    Boolean(env.STRIPE_PRICE_ID_PRO)
  );
}
