import { afterEach, describe, expect, it } from "vitest";
import {
  assertProductionSafe,
  describeEnvironment,
  getEnv,
  isBillingConfigured,
  resetEnvCache,
} from "@/lib/env";

const ORIGINAL = { ...process.env };

function setEnv(values: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetEnvCache();
}

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL)) delete process.env[key];
  }
  Object.assign(process.env, ORIGINAL);
  resetEnvCache();
});

const GOOD_PROD = {
  NODE_ENV: "production",
  SESSION_SECRET: "Ad8rM2pQv7XzLb4TkWn9Ys3Hc6Fj1Ge0Rq5Uo2Iy8Pw4Zx7Nv",
  APP_URL: "https://quotes.example.com",
  BILLING_PROVIDER: "none",
  AI_PROVIDER: "none",
  NEXT_PHASE: undefined,
};

describe("development defaults", () => {
  it("runs with only a database URL", () => {
    setEnv({ NODE_ENV: "development", SESSION_SECRET: undefined, APP_URL: undefined, NEXT_PHASE: undefined });
    const env = getEnv();
    expect(env.APP_URL).toBe("http://localhost:3000");
    expect(env.AI_PROVIDER).toBe("none");
    expect(env.TRUST_PROXY_HEADERS).toBe(true);
    expect(env.PUBLIC_PAGES_ENABLED).toBe(true);
  });

  it("parses the boolean switches", () => {
    setEnv({ NODE_ENV: "development", TRUST_PROXY_HEADERS: "false", PUBLIC_PAGES_ENABLED: "false" });
    expect(getEnv().TRUST_PROXY_HEADERS).toBe(false);
    expect(getEnv().PUBLIC_PAGES_ENABLED).toBe(false);
  });
});

describe("production safety", () => {
  it("accepts a properly configured production environment", () => {
    setEnv(GOOD_PROD);
    expect(() => getEnv()).not.toThrow();
    expect(() => assertProductionSafe()).not.toThrow();
  });

  it("refuses to boot without a session secret", () => {
    setEnv({ ...GOOD_PROD, SESSION_SECRET: undefined });
    expect(() => getEnv()).toThrow(/SESSION_SECRET is required/);
  });

  it("refuses a placeholder session secret even at the right length", () => {
    for (const secret of [
      "build-time-placeholder-secret-value-32ch",
      "changeme-changeme-changeme-changeme-1234",
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "your-secret-goes-here-your-secret-goes-x",
    ]) {
      setEnv({ ...GOOD_PROD, SESSION_SECRET: secret });
      expect(() => getEnv()).toThrow(/placeholder/i);
    }
  });

  it("refuses a non-HTTPS or localhost public URL", () => {
    setEnv({ ...GOOD_PROD, APP_URL: "http://quotes.example.com" });
    expect(() => getEnv()).toThrow(/https/);

    setEnv({ ...GOOD_PROD, APP_URL: "https://localhost:3000" });
    expect(() => getEnv()).toThrow(/localhost/);
  });

  it("refuses Stripe without a webhook secret, because no plan could ever activate", () => {
    setEnv({
      ...GOOD_PROD,
      BILLING_PROVIDER: "stripe",
      STRIPE_SECRET_KEY: "sk_test_x",
      STRIPE_PRICE_ID_PRO: "price_x",
      STRIPE_WEBHOOK_SECRET: undefined,
    });
    expect(() => getEnv()).toThrow(/STRIPE_WEBHOOK_SECRET/);
  });

  it("reports every problem at once rather than one per restart", () => {
    setEnv({ ...GOOD_PROD, SESSION_SECRET: "changeme-changeme-changeme-changeme-1234", APP_URL: "http://localhost:3000" });
    const error = (() => {
      try {
        getEnv();
        return null;
      } catch (e) {
        return e as Error;
      }
    })();

    expect(error?.message).toMatch(/placeholder/i);
    expect(error?.message).toMatch(/https/);
    expect(error?.message).toMatch(/localhost/);
  });

  it("defers the fatal checks during `next build`, then enforces them at start-up", () => {
    setEnv({ ...GOOD_PROD, SESSION_SECRET: undefined, APP_URL: "http://localhost:3000" });
    process.env.NEXT_PHASE = "phase-production-build";
    resetEnvCache();

    // The build machine has no production secrets; the build must not fail.
    expect(() => getEnv()).not.toThrow();
    // The server booting with the same config must.
    expect(() => assertProductionSafe()).toThrow(/SESSION_SECRET is required/);
    expect(process.env.NEXT_PHASE).toBe("phase-production-build");
  });
});

describe("integration configuration", () => {
  it("fails fast when an integration is half-configured", () => {
    setEnv({ NODE_ENV: "development", AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: undefined });
    expect(() => getEnv()).toThrow(/ANTHROPIC_API_KEY/);

    setEnv({ NODE_ENV: "development", AI_PROVIDER: "none", BILLING_PROVIDER: "stripe", STRIPE_SECRET_KEY: undefined });
    expect(() => getEnv()).toThrow(/STRIPE_SECRET_KEY/);

    setEnv({ BILLING_PROVIDER: "stripe", STRIPE_SECRET_KEY: "sk_test_x", STRIPE_PRICE_ID_PRO: undefined });
    expect(() => getEnv()).toThrow(/STRIPE_PRICE_ID_PRO/);
  });

  it("reports billing as configured only when it really is", () => {
    setEnv({ NODE_ENV: "development", BILLING_PROVIDER: "none" });
    expect(isBillingConfigured()).toBe(false);

    setEnv({
      NODE_ENV: "development",
      BILLING_PROVIDER: "stripe",
      STRIPE_SECRET_KEY: "sk_test_x",
      STRIPE_PRICE_ID_PRO: "price_x",
    });
    expect(isBillingConfigured()).toBe(true);
  });
});

describe("describeEnvironment", () => {
  it("states plainly which integrations are on", () => {
    setEnv({ NODE_ENV: "development", AI_PROVIDER: "none", BILLING_PROVIDER: "none", CRON_SECRET: undefined });
    const report = describeEnvironment();

    expect(report.ai).toBe(false);
    expect(report.billing).toBe(false);
    expect(report.cron).toBe(false);
    expect(report.publicPages).toBe(true);
    expect(report.warnings).toEqual([]);
  });

  it("warns about production setups that will bite later", () => {
    setEnv({
      ...GOOD_PROD,
      DATABASE_URL: "file:./prod.db",
      CRON_SECRET: undefined,
      TRUST_PROXY_HEADERS: "false",
    });

    const warnings = describeEnvironment().warnings.join(" ");
    expect(warnings).toMatch(/SQLite/);
    expect(warnings).toMatch(/CRON_SECRET/);
    expect(warnings).toMatch(/rate limits/);
  });
});

describe("ALLOW_INSECURE_LOCAL", () => {
  it("lets a production build be smoke-tested on http://localhost", () => {
    setEnv({ ...GOOD_PROD, APP_URL: "http://localhost:3000", ALLOW_INSECURE_LOCAL: "true" });
    expect(() => getEnv()).not.toThrow();
    expect(describeEnvironment().warnings.join(" ")).toMatch(/ALLOW_INSECURE_LOCAL/);
  });

  it("does not relax anything for a real hostname", () => {
    setEnv({ ...GOOD_PROD, APP_URL: "http://quotes.example.com", ALLOW_INSECURE_LOCAL: "true" });
    expect(() => getEnv()).toThrow(/https/);
  });

  it("is off by default, so localhost still fails without it", () => {
    setEnv({ ...GOOD_PROD, APP_URL: "http://localhost:3000", ALLOW_INSECURE_LOCAL: undefined });
    expect(() => getEnv()).toThrow(/localhost/);
  });
});
