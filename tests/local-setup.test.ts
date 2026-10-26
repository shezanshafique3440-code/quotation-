import { mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { assertLocalNode, prepareLocalEnvironment } from "../scripts/local-env.mjs";

const roots: string[] = [];
const key = "a1b2c3d4".repeat(8);
function directory() {
  const cwd = mkdtempSync(join(tmpdir(), "quoteflow-local-setup-"));
  roots.push(cwd);
  return cwd;
}
function prepare(cwd: string, extra: Parameters<typeof prepareLocalEnvironment>[0] = {}) {
  return prepareLocalEnvironment({ cwd, environment: {}, generateSecret: () => key, ...extra });
}
afterEach(() => {
  for (const cwd of roots.splice(0)) rmSync(cwd, { recursive: true, force: true });
});

describe("local setup configuration", () => {
  it("requires the supported Node 24 runtime", () => {
    expect(() => assertLocalNode("24.19.0")).not.toThrow();
    expect(() => assertLocalNode("22.21.0")).toThrow(/Node.js 24 LTS/);
    expect(() => assertLocalNode("25.0.0")).toThrow(/Node.js 24 LTS/);
  });

  it("creates private local settings once, with optional integrations off", () => {
    const cwd = directory();
    const first = prepare(cwd);
    const contents = readFileSync(join(cwd, ".env"), "utf8");
    const config = parseEnv(contents);
    expect(config).toMatchObject({
      DATABASE_URL: "file:./dev.db", APP_URL: "http://localhost:3000",
      SESSION_SECRET: key, CRON_SECRET: key,
      AI_PROVIDER: "none", EMAIL_PROVIDER: "none", BILLING_PROVIDER: "none",
      TRUST_PROXY_HEADERS: "false",
    });
    expect(first.writtenFiles).toEqual([".env"]);
    if (process.platform !== "win32") expect(statSync(join(cwd, ".env")).mode & 0o777).toBe(0o600);
    const second = prepare(cwd, { generateSecret: () => { throw new Error("must not regenerate"); } });
    expect(second.writtenFiles).toEqual([]);
    expect(readFileSync(join(cwd, ".env"), "utf8")).toBe(contents);
  });

  it("retains existing values, comments, Windows line endings and multiline settings", () => {
    const cwd = directory();
    const contents = `# My configuration\r\nSESSION_SECRET="${key}" # retain\r\nCRON_SECRET="${key}"\r\nCUSTOM_VALUE="first\r\nsecond"\r\nDATABASE_URL="file:./personal.db"\r\n`;
    writeFileSync(join(cwd, ".env"), contents);
    const result = prepare(cwd);
    expect(readFileSync(join(cwd, ".env"), "utf8")).toContain(contents);
    expect(result.environment.DATABASE_URL).toBe("file:./personal.db");
    expect(result.environment.CUSTOM_VALUE).toBe("first\nsecond");
    expect(parseEnv(readFileSync(join(cwd, ".env"), "utf8")).SESSION_SECRET).toBe(key);
  });

  it("fills a blank higher-precedence secret without overwriting a lower-precedence key", () => {
    const cwd = directory();
    writeFileSync(join(cwd, ".env"), `SESSION_SECRET="${key}"\n`);
    writeFileSync(join(cwd, ".env.local"), "# local wins\nSESSION_SECRET=\"\" # fill locally\n");
    const replacement = "new-local-key-".repeat(6);
    const result = prepare(cwd, { generateSecret: () => replacement });
    expect(result.environment.SESSION_SECRET).toBe(replacement);
    expect(readFileSync(join(cwd, ".env"), "utf8")).toContain(`SESSION_SECRET="${key}"`);
    expect(readFileSync(join(cwd, ".env.local"), "utf8")).toContain(`# fill locally`);
    expect(parseEnv(readFileSync(join(cwd, ".env.local"), "utf8")).SESSION_SECRET).toBe(replacement);
  });

  it("retains injected credentials and never copies them into a settings file", () => {
    const cwd = directory();
    const injected = "injected-key-value-".repeat(4);
    const result = prepare(cwd, { environment: {
      SESSION_SECRET: injected, CRON_SECRET: injected,
      AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: injected,
    } });
    const contents = readFileSync(join(cwd, ".env"), "utf8");
    expect(result.environment.ANTHROPIC_API_KEY).toBe(injected);
    expect(contents).not.toContain(injected);
    expect(contents).not.toContain("ANTHROPIC_API_KEY");
    expect(contents).not.toContain("SESSION_SECRET");
  });

  it("uses development-local precedence and fills blank multiline values safely", () => {
    const cwd = directory();
    writeFileSync(join(cwd, ".env.local"), "APP_URL=http://localhost:4000\n");
    writeFileSync(join(cwd, ".env.development.local"), 'APP_URL=http://localhost:3000\nSESSION_SECRET="\n" # empty multiline\n');
    const result = prepare(cwd);
    expect(result.environment.APP_URL).toBe("http://localhost:3000");
    expect(parseEnv(readFileSync(join(cwd, ".env.development.local"), "utf8")).SESSION_SECRET).toBe(key);
    expect(readFileSync(join(cwd, ".env.local"), "utf8")).toBe("APP_URL=http://localhost:4000\n");
  });

  it("changes only the last duplicate blank assignment", () => {
    const cwd = directory();
    writeFileSync(join(cwd, ".env"), `SESSION_SECRET="${key}"\nSESSION_SECRET= # authoritative\n`);
    const replacement = "last-key-".repeat(8);
    prepare(cwd, { generateSecret: () => replacement });
    const contents = readFileSync(join(cwd, ".env"), "utf8");
    expect(contents).toContain(`SESSION_SECRET="${key}"`);
    expect(contents).toContain("# authoritative");
    expect(parseEnv(contents).SESSION_SECRET).toBe(replacement);
  });

  it("enables local SMTP only when explicitly requested and keeps keys on reruns", () => {
    const cwd = directory();
    writeFileSync(join(cwd, ".env"), `SESSION_SECRET="${key}"\nCRON_SECRET="${key}"\nEMAIL_PROVIDER="none"\nSMTP_PORT="587"\n`);
    const result = prepare(cwd, { mail: true });
    expect(result.environment).toMatchObject({
      EMAIL_PROVIDER: "smtp", SMTP_HOST: "127.0.0.1", SMTP_PORT: "1025",
      SMTP_SECURE: "false", EMAIL_FROM: "QuoteFlow Local <quotes@quoteflow.test>",
      SESSION_SECRET: key, CRON_SECRET: key,
    });
    const first = readFileSync(join(cwd, ".env"), "utf8");
    expect(prepare(cwd, { mail: true }).writtenFiles).toEqual([]);
    expect(readFileSync(join(cwd, ".env"), "utf8")).toBe(first);
  });

  it("refuses external mail conflicts before changing any config", () => {
    for (const config of [
      "EMAIL_PROVIDER=resend\nRESEND_API_KEY=existing-external-key\n",
      "EMAIL_PROVIDER=none\nSMTP_HOST=smtp.example.test\n",
      "EMAIL_PROVIDER=none\nSMTP_PASSWORD=existing-password\n",
    ]) {
      const cwd = directory();
      writeFileSync(join(cwd, ".env"), config);
      expect(() => prepare(cwd, { mail: true })).toThrow(/conflicts with existing/);
      expect(readFileSync(join(cwd, ".env"), "utf8")).toBe(config);
    }
  });

  it("does not hide injected overrides that prevent persistent local SMTP settings", () => {
    const cwd = directory();
    expect(() => prepare(cwd, { mail: true, environment: { SMTP_PORT: "587" } })).toThrow(/SMTP_PORT is already injected/);
    expect(() => readFileSync(join(cwd, ".env"))).toThrow();
  });

  it("refuses deployment URLs and non-SQLite data sources without changing files", () => {
    for (const config of [
      "APP_URL=https://quotes.example.test\n",
      "APP_URL=http://localhost:3000/subpath\n",
      "APP_URL=http://localhost:3000/?query=1\n",
      'APP_URL="http://localhost:3000/#fragment"\n',
      "DATABASE_URL=postgresql://localhost/example\n",
      "NODE_ENV=production\n",
    ]) {
      const cwd = directory();
      writeFileSync(join(cwd, ".env"), config);
      expect(() => prepare(cwd)).toThrow(/Local setup/);
      expect(readFileSync(join(cwd, ".env"), "utf8")).toBe(config);
    }
  });

  it.skipIf(process.platform === "win32")("does not overwrite a symlinked configuration target", () => {
    const cwd = directory();
    const target = join(cwd, "retained-config");
    writeFileSync(target, "# retain this file\n");
    symlinkSync(target, join(cwd, ".env"));
    expect(() => prepare(cwd)).toThrow(/symlinked .env/);
    expect(readFileSync(target, "utf8")).toBe("# retain this file\n");
  });
});
