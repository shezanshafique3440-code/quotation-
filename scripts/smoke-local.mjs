import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";
import { PrismaClient } from "@prisma/client";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
nextEnv.loadEnvConfig(projectRoot, true, { info() {}, error() {} });

class SmokeFailure extends Error {}

function check(condition, message) {
  if (!condition) throw new SmokeFailure(message);
}

function localOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw new SmokeFailure("Use a valid local app and inbox URL."); }
  check(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
    !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash,
  "App and inbox URLs must be plain HTTP loopback origins.");
  return url;
}

const options = { app: process.env.APP_URL || "http://127.0.0.1:3000", inbox: "http://127.0.0.1:8025" };
for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index];
  if (argument === "--help") {
    console.log("Start npm run dev:local first, then run npm run test:local. Optional: --app-url http://127.0.0.1:3000 --inbox-url http://127.0.0.1:8025");
    process.exit(0);
  }
  const option = argument === "--app-url" ? "app" : argument === "--inbox-url" ? "inbox" : null;
  if (!option || !process.argv[index + 1]) {
    console.error("Use --app-url and --inbox-url with HTTP loopback origins, or --help.");
    process.exit(1);
  }
  options[option] = process.argv[++index];
}

const runId = randomUUID();
const ownerEmail = `smoke-${runId}@example.test`;
const customerEmail = `customer-${runId}@example.test`;
const ownerName = `Smoke ${runId}`;
const workspaceName = `Local smoke ${runId}`;
const fixtureIp = `fd00:${randomBytes(14).toString("hex").match(/.{4}/g).join(":")}`;
const firstPassword = randomBytes(24).toString("base64url");
const resetPassword = randomBytes(24).toString("base64url");
const prisma = new PrismaClient({ log: [] });
let app;
let inbox;
let stage = "local configuration";
let fixturesPossible = false;

function pass(message) { console.log(`PASS ${message}`); }

function decodeHtml(value) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (match, entity) => {
    if (entity[0] === "#") {
      const hex = entity[1].toLowerCase() === "x";
      const number = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return number >= 0 && number <= 0x10ffff ? String.fromCodePoint(number) : match;
    }
    return { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " }[entity.toLowerCase()];
  });
}

function attributes(markup) {
  const result = {};
  const pattern = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const match of markup.matchAll(pattern)) result[match[1].toLowerCase()] = decodeHtml(match[2] ?? match[3] ?? match[4] ?? "");
  return result;
}

function forms(html) {
  return [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)].map((match) => ({
    attributes: attributes(match[1]),
    html: match[2],
    inputs: [...match[2].matchAll(/<input\b([^>]*)>/gi)].map((input) => attributes(input[1])),
  }));
}

function hasFields(...names) {
  return (form) => names.every((name) => form.inputs.some((input) => input.name === name));
}

class Browser {
  cookies = new Map();

  async request(path, init = {}) {
    const url = new URL(path, app);
    check(url.origin === app.origin, "A request attempted to leave the local application.");
    const headers = new Headers(init.headers);
    headers.set("user-agent", "QuoteFlow Local Smoke");
    headers.set("x-forwarded-for", fixtureIp);
    if (this.cookies.size) headers.set("cookie", [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; "));
    if (init.method === "POST") headers.set("origin", app.origin);
    const response = await fetch(url, { ...init, headers, redirect: "manual", signal: AbortSignal.timeout(60_000) });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(";");
      const separator = pair.indexOf("=");
      if (separator > 0) this.cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
    return { status: response.status, headers: response.headers, body: await response.text() };
  }

  async submit(path, chooseForm, values = {}) {
    const page = await this.request(path);
    check(page.status === 200, "The expected application form could not be loaded.");
    const form = forms(page.body).find(chooseForm);
    check(form, "The expected application form was not rendered.");
    const data = new FormData();
    for (const input of form.inputs) {
      if (input.name && !Object.hasOwn(input, "disabled") &&
          (input.type === "hidden" || input.name.startsWith("$ACTION_"))) {
        data.append(input.name, input.value || "");
      }
    }
    check([...data.keys()].some((name) => name.startsWith("$ACTION_")), "The form has no native server-action fields.");
    for (const [name, value] of Object.entries(values)) data.set(name, value);
    return this.request(new URL(form.attributes.action || path, new URL(path, app)), { method: "POST", body: data });
  }
}

async function inboxMessages() {
  const response = await fetch(new URL("/api/messages", inbox), { signal: AbortSignal.timeout(5_000), redirect: "error" });
  check(response.ok, "The local inbox message API did not respond successfully.");
  const result = await response.json();
  check(Array.isArray(result.messages), "The local inbox message API returned an unexpected response.");
  return result.messages;
}

async function capturedMail(recipient, matches) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const message = (await inboxMessages()).find((candidate) =>
      JSON.stringify([candidate.to, candidate.envelope?.to]).includes(recipient) && matches(candidate));
    if (message) return message;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new SmokeFailure("The expected message did not arrive in the local inbox.");
}

function messageLink(message, segment) {
  const text = `${message.text || ""}\n${message.html || ""}`;
  const match = text.match(new RegExp(`https?://[^\\s<>"']+/${segment}/[A-Za-z0-9_-]+`));
  check(match, "The captured message has no expected application link.");
  const url = new URL(decodeHtml(match[0]));
  check(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
    url.port === app.port && !url.username && !url.password,
  "A captured message links outside the local application.");
  return `${url.pathname}${url.search}`;
}

function redirectsTo(response, pathname) {
  return response.status === 303 && new URL(response.headers.get("location"), app).pathname === pathname;
}

async function cleanFixtures() {
  const fixture = await prisma.user.findUnique({
    where: { email: ownerEmail },
    include: { memberships: { include: { organization: true } } },
  });
  if (!fixture) return;
  check(fixture.name === ownerName && fixture.memberships.every((membership) => membership.organization.name === workspaceName),
    "Smoke fixture ownership changed; automatic cleanup was stopped.");
  const organizationIds = fixture.memberships.map((membership) => membership.organizationId);
  await prisma.$transaction(async (tx) => {
    for (const organizationId of organizationIds) {
      const deleted = await tx.organization.deleteMany({
        where: { id: organizationId, name: workspaceName, memberships: { every: { userId: fixture.id } } },
      });
      check(deleted.count === 1, "Smoke workspace ownership changed; automatic cleanup was stopped.");
    }
    await tx.user.delete({ where: { id: fixture.id } });
    await tx.rateLimitCounter.deleteMany({
      where: { key: { in: [
        ...["signUp", "signIn", "passwordReset", "emailVerification"].map((name) => `${name}:${fixtureIp}`),
        `signIn:account:${ownerEmail}`, `passwordReset:account:${ownerEmail}`,
        `pdfDownload:user:${fixture.id}`,
        ...organizationIds.map((id) => `emailSend:org:${id}`),
      ] } },
    });
  });
}

try {
  app = localOrigin(options.app);
  inbox = localOrigin(options.inbox);
  check(process.env.EMAIL_PROVIDER === "smtp" &&
    ["localhost", "127.0.0.1", "::1"].includes(process.env.SMTP_HOST) &&
    process.env.SMTP_SECURE !== "true",
  "Run npm run setup:local and npm run dev:local with local SMTP capture configured first.");
  const inboxHealth = await fetch(new URL("/api/health", inbox), { signal: AbortSignal.timeout(5_000), redirect: "error" });
  const capture = await inboxHealth.json();
  check(inboxHealth.ok && capture.status === "ok" && capture.mode === "local-capture", "Start the local capture inbox before running this smoke test.");
  const browser = new Browser();
  const health = await browser.request("/api/health");
  const application = JSON.parse(health.body);
  check(health.status === 200 && application.status === "ok" && application.database === "up" && application.integrations.email === true,
    "The application must be healthy with local SMTP email enabled.");
  pass("local application and SMTP capture are ready");

  stage = "sign-up and verification email";
  fixturesPossible = true;
  const signedUp = await browser.submit("/sign-up", hasFields("businessName", "email", "password"), {
    businessName: workspaceName, name: ownerName, email: ownerEmail, password: firstPassword,
  });
  check(redirectsTo(signedUp, "/dashboard") && browser.cookies.has("qf_session"), "Sign-up did not create an authenticated workspace.");
  const owner = await prisma.user.findUniqueOrThrow({ where: { email: ownerEmail }, include: { memberships: true } });
  check(owner.memberships.length === 1 && !owner.emailVerifiedAt, "Sign-up did not create the expected unconfirmed owner.");
  const organizationId = owner.memberships[0].organizationId;
  const verification = await capturedMail(ownerEmail, (mail) => `${mail.text}\n${mail.html}`.includes("/verify-email/"));
  const verified = await browser.submit(messageLink(verification, "verify-email"), hasFields("token"));
  check(verified.status === 200 && (await prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).emailVerifiedAt,
    "Following the captured verification link did not confirm the account.");
  pass("sign-up, captured verification email and address confirmation");

  stage = "password-reset delivery and session revocation";
  const recovery = new Browser();
  const requested = await recovery.submit("/forgot-password", hasFields("email"), { email: ownerEmail });
  check(requested.status === 200, "The password-reset request failed.");
  const reset = await capturedMail(ownerEmail, (mail) => `${mail.text}\n${mail.html}`.includes("/reset-password/"));
  const changed = await recovery.submit(messageLink(reset, "reset-password"), hasFields("token", "password", "confirmPassword"), {
    password: resetPassword, confirmPassword: resetPassword,
  });
  check(redirectsTo(changed, "/sign-in"), "The captured reset link did not reset the password.");
  const oldSession = await browser.request("/dashboard");
  check([303, 307].includes(oldSession.status) && new URL(oldSession.headers.get("location"), app).pathname === "/sign-in",
    "Password reset did not revoke the previous session.");
  const oldPassword = await new Browser().submit("/sign-in", hasFields("email", "password"), { email: ownerEmail, password: firstPassword });
  check(oldPassword.status === 200 && oldPassword.body.includes("Those credentials did not match an account."), "The old password was not rejected.");
  const signedIn = await recovery.submit("/sign-in", hasFields("email", "password"), { email: ownerEmail, password: resetPassword });
  check(redirectsTo(signedIn, "/dashboard"), "Sign-in with the new password failed.");
  pass("captured password-reset email, old credential rejection and session revocation");

  stage = "quotation email delivery";
  const customer = await prisma.customer.create({ data: { organizationId, name: "Local smoke customer", email: customerEmail } });
  const quotation = await prisma.quotation.create({ data: {
    organizationId, customerId: customer.id, createdById: owner.id,
    number: "SMOKE-0001", title: "Local SMTP quotation", currency: "USD",
    subtotalCents: 10000, taxCents: 1000, totalCents: 11000,
    validUntil: new Date(Date.now() + 7 * 86_400_000),
    items: { create: { position: 0, description: "Local test service", quantity: 1, unit: "service", unitPriceCents: 10000, taxRateBp: 1000, lineTotalCents: 11000 } },
  } });
  const sent = await recovery.submit(`/quotations/${quotation.id}`, hasFields("quotationId", "to"), { to: customerEmail, message: "Local capture smoke check." });
  check(sent.status === 200, "The quotation email action failed.");
  const customerMail = await capturedMail(customerEmail, (mail) => `${mail.subject}\n${mail.text}`.includes("SMOKE-0001"));
  const stored = await prisma.quotation.findUniqueOrThrow({ where: { id: quotation.id } });
  const delivery = await prisma.emailDelivery.findFirst({ where: { organizationId, quotationId: quotation.id, kind: "quotation", status: "sent" } });
  check(stored.status === "sent" && delivery?.providerMessageId, "Captured delivery was not recorded as sent with a provider message ID.");
  const shared = await new Browser().request(messageLink(customerMail, "q"));
  check(shared.status === 200 && shared.body.includes("SMOKE-0001"), "The emailed quotation link did not show the expected document.");
  pass("actual quotation email action, SMTP capture, delivery record and customer share page");
} catch (error) {
  console.error(`FAIL ${stage}: ${error instanceof SmokeFailure ? error.message : "The local operation failed. Check the app and inbox logs."}`);
  process.exitCode = 1;
} finally {
  try {
    if (fixturesPossible) {
      await cleanFixtures();
      pass("smoke-created account and workspace fixtures cleaned up");
    }
  } catch {
    console.error("FAIL cleanup: automatic cleanup stopped; only this run's smoke fixtures may remain.");
    process.exitCode = 1;
  }
  await prisma.$disconnect();
}
