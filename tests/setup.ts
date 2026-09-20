import { resolve } from "node:path";

// Must run before any module reads process.env (src/lib/env.ts memoises it).
// Object.assign keeps TypeScript happy about the read-only NODE_ENV typing.
Object.assign(process.env, {
  NODE_ENV: "test",
  DATABASE_URL: `file:${resolve(process.cwd(), ".test-data/test.db")}`,
  APP_URL: "http://localhost:3000",
  SESSION_SECRET: "test-session-secret-that-is-long-enough-32",
  // Integrations are off by default; individual tests opt in.
  AI_PROVIDER: "none",
  BILLING_PROVIDER: "none",
});

delete process.env.ANTHROPIC_API_KEY;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_PRICE_ID_PRO;
