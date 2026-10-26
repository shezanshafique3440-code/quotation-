import { randomBytes } from "node:crypto";
import { existsSync, lstatSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

const ENV_FILES = [".env", ".env.development", ".env.local", ".env.development.local"];
const nonblank = (value) => typeof value === "string" && value.trim() !== "";

export function assertLocalNode(version = process.versions.node) {
  if (Number(version.split(".")[0]) !== 24) {
    throw new Error("Local setup requires Node.js 24 LTS. Install it, reopen your terminal, then run npm run setup:local again.");
  }
}

/** Replace only the last assignment; leave comments and other config intact. */
function setValue(contents, name, value) {
  const expression = new RegExp(`^([ \\t]*(?:export[ \\t]+)?${name}[ \\t]*=[ \\t]*)(?:"(?:\\\\.|[^"\\\\])*"|'[^']*'|[^#\\r\\n]*)([ \\t]*(?:#[^\\r\\n]*)?)`, "gm");
  const matches = [...contents.matchAll(expression)];
  const assignment = `${name}=${JSON.stringify(value)}`;
  if (matches.length === 0) {
    const ending = contents.includes("\r\n") ? "\r\n" : "\n";
    return `${contents}${contents && !contents.endsWith("\n") ? ending : ""}${assignment}${ending}`;
  }
  const match = matches.at(-1);
  const replacement = `${match[1]}${JSON.stringify(value)}${match[2] ?? ""}`;
  return contents.slice(0, match.index) + replacement + contents.slice(match.index + match[0].length);
}

/**
 * Prepare development settings without copying or printing credentials.
 * The caller receives the effective environment for Prisma/npm child commands.
 */
export function prepareLocalEnvironment({
  cwd = process.cwd(),
  environment = process.env,
  mail = false,
  generateSecret = () => randomBytes(48).toString("hex"),
} = {}) {
  const files = ENV_FILES.map((name) => {
    const path = resolve(cwd, name);
    const contents = existsSync(path) ? readFileSync(path, "utf8") : "";
    return { name, path, contents, original: contents, values: parseEnv(contents) };
  });
  const settings = Object.assign({}, ...files.map((file) => file.values), environment);
  if (settings.NODE_ENV === "production") {
    throw new Error("Local setup requires development settings. NODE_ENV=production was preserved; use a dedicated development environment instead.");
  }
  const updates = new Map();
  const missing = (name, value) => {
    if (!nonblank(settings[name])) updates.set(name, typeof value === "function" ? value() : value);
  };
  missing("DATABASE_URL", "file:./dev.db");
  missing("APP_URL", "http://localhost:3000");
  missing("SESSION_SECRET", generateSecret);
  missing("CRON_SECRET", generateSecret);
  for (const name of ["AI_PROVIDER", "EMAIL_PROVIDER", "BILLING_PROVIDER"]) missing(name, "none");
  missing("TRUST_PROXY_HEADERS", "false");
  missing("PUBLIC_PAGES_ENABLED", "true");

  const effective = { ...settings, ...Object.fromEntries(updates) };
  let appUrl;
  try { appUrl = new URL(effective.APP_URL); } catch { throw new Error("APP_URL must be a valid local HTTP origin."); }
  if (appUrl.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(appUrl.hostname) ||
      appUrl.username || appUrl.password || appUrl.pathname !== "/" || appUrl.search || appUrl.hash) {
    throw new Error("Local setup requires APP_URL to be an HTTP loopback origin. Existing configuration was preserved; use a separate local configuration instead of a deployment URL.");
  }
  if (!effective.DATABASE_URL.startsWith("file:")) {
    throw new Error("Local setup supports the repository's SQLite file database only. Existing database configuration was preserved.");
  }
  if (effective.SESSION_SECRET.length < 32 || effective.CRON_SECRET.length < 16) {
    throw new Error("Existing SESSION_SECRET or CRON_SECRET is too short. Update it locally; setup did not replace an existing nonblank key.");
  }

  if (mail) {
    const provider = effective.EMAIL_PROVIDER;
    const host = effective.SMTP_HOST;
    if (!["none", "smtp"].includes(provider) ||
        (nonblank(host) && !["localhost", "127.0.0.1", "::1"].includes(host)) ||
        nonblank(effective.SMTP_USER) || nonblank(effective.SMTP_PASSWORD)) {
      throw new Error("Local mail capture conflicts with existing email-provider settings. Those settings were preserved; use a dedicated local environment without external SMTP credentials.");
    }
    const localMail = {
      EMAIL_PROVIDER: "smtp",
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: "1025",
      SMTP_SECURE: "false",
      EMAIL_FROM: provider === "smtp" && nonblank(effective.EMAIL_FROM)
        ? effective.EMAIL_FROM : "QuoteFlow Local <quotes@quoteflow.test>",
    };
    for (const [name, value] of Object.entries(localMail)) {
      if (nonblank(environment[name]) && environment[name] !== value) {
        throw new Error(`${name} is already injected into this process with a different setting. Existing configuration was preserved; clear that local override before enabling mail capture.`);
      }
      updates.set(name, value);
    }
    Object.assign(effective, localMail);
  }

  if (effective.AI_PROVIDER === "anthropic" && !nonblank(effective.ANTHROPIC_API_KEY)) {
    throw new Error("AI_PROVIDER enables Anthropic but ANTHROPIC_API_KEY is missing. Add it securely or set AI_PROVIDER=none in your local environment.");
  }
  if (effective.BILLING_PROVIDER === "stripe" &&
      (!nonblank(effective.STRIPE_SECRET_KEY) || !nonblank(effective.STRIPE_PRICE_ID_PRO))) {
    throw new Error("Stripe is enabled but its key or Pro price is missing. Add them securely or set BILLING_PROVIDER=none for local testing.");
  }

  for (const [name, value] of updates) {
    // Update the highest-precedence file that owns the key; otherwise use .env,
    // which is also understood by the Prisma CLI outside this setup process.
    const owner = files.findLast((file) => Object.hasOwn(file.values, name)) ?? files[0];
    owner.contents = setValue(owner.contents, name, value);
  }
  const changedFiles = files.filter((file) => file.contents !== file.original);
  for (const file of changedFiles) {
    if (existsSync(file.path) && lstatSync(file.path).isSymbolicLink()) {
      throw new Error(`Refusing to edit symlinked ${file.name}. Update its missing local settings manually; no configuration was changed.`);
    }
    const parsed = parseEnv(file.contents);
    for (const [name, value] of updates) {
      const owner = files.findLast((candidate) => Object.hasOwn(candidate.values, name)) ?? files[0];
      if (owner === file && parsed[name] !== value) {
        throw new Error(`Could not safely update ${name} in ${file.name}; no configuration was changed.`);
      }
    }
  }
  for (const file of changedFiles) writeFileSync(file.path, file.contents, { mode: 0o600 });
  return {
    environment: effective,
    changedNames: [...updates.keys()],
    writtenFiles: changedFiles.map((file) => file.name),
  };
}
