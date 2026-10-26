import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
nextEnv.loadEnvConfig(root, true, { info() {}, error() {} });

const children = [];
let stopping = false;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function stop(code) {
  if (stopping) return;
  stopping = true;
  if (process.platform === "win32") {
    // Next's CLI can own worker processes. Terminate only the trees launched
    // here; killing the parent alone would leave the Windows port occupied.
    await Promise.all(children.filter((child) => child.pid && child.exitCode === null && child.signalCode === null)
      .map((child) => new Promise((resolve) => {
        const terminator = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
        terminator.once("error", () => { child.kill(); resolve(); });
        terminator.once("exit", resolve);
      })));
  } else {
    for (const child of children) child.kill("SIGTERM");
  }
  await Promise.race([
    Promise.all(children.map((child) => child.exitCode !== null || child.signalCode !== null
      ? Promise.resolve() : new Promise((resolve) => child.once("exit", resolve)))),
    pause(3000),
  ]);
  for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  process.exitCode = code;
}

function start(args) {
  // This launcher binds only loopback. A separate source-IP bucket per smoke
  // run makes repeated local account tests possible without deleting anybody
  // else's counters. The persisted configuration and normal dev command keep
  // their own proxy-header policy.
  const child = spawn(process.execPath, args, {
    cwd: root,
    env: { ...process.env, TRUST_PROXY_HEADERS: "true" },
    stdio: "inherit",
  });
  children.push(child);
  child.once("error", () => {
    console.error("A local development process could not start.");
    void stop(1);
  });
  child.once("exit", (code) => {
    if (!stopping) {
      console.error("A local development process stopped. Closing the other local services.");
      void stop(code || 1);
    }
  });
  return child;
}

async function assertFree(port) {
  await new Promise((resolve, reject) => {
    const socket = createServer();
    socket.once("error", () => reject(new Error(`Port ${port} is already in use. Close your existing local service first.`)));
    socket.listen({ port, host: "127.0.0.1", exclusive: true }, () => socket.close(resolve));
  });
}

async function ready(url, predicate) {
  for (let attempt = 0; attempt < 60 && !stopping; attempt += 1) {
    try {
      const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(2000) });
      if (response.ok && predicate(await response.json())) return;
    } catch { /* Startup compilation and socket binding can take a moment. */ }
    await pause(500);
  }
  throw new Error("Local services did not become ready. Read the startup output and retry.");
}

try {
  if (process.env.NODE_ENV === "production") throw new Error("Use a development environment for npm run dev:local.");
  const url = new URL(process.env.APP_URL || "http://localhost:3000");
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(url.hostname) ||
      url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Local development requires an http loopback APP_URL. Run npm run setup:local -- --mail first.");
  }
  const port = Number(url.port || 80);
  if (process.env.EMAIL_PROVIDER !== "smtp" || process.env.SMTP_HOST !== "127.0.0.1" ||
      process.env.SMTP_PORT !== "1025" || process.env.SMTP_SECURE === "true" ||
      process.env.SMTP_USER || process.env.SMTP_PASSWORD || !process.env.CRON_SECRET) {
    throw new Error("Local mail and maintenance are not configured. Run npm run setup:local -- --mail first.");
  }
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || [1025, 8025].includes(port)) {
    throw new Error("Choose an APP_URL port from 1024 to 65535 other than 1025 and 8025.");
  }
  for (const value of [port, 1025, 8025]) await assertFree(value);
  process.once("SIGINT", () => void stop(0));
  process.once("SIGTERM", () => void stop(0));
  start([fileURLToPath(new URL("mail-local.mjs", import.meta.url))]);
  await ready("http://127.0.0.1:8025/api/health", (data) => data.mode === "local-capture");
  start([require.resolve("next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", String(port)]);
  await ready(`${url.origin}/api/health`, (data) => data.status === "ok" && data.database === "up" && data.integrations?.email);
  start([fileURLToPath(new URL("run-maintenance.mjs", import.meta.url)), "--watch"]);
  console.log("Local app, email inbox and hourly maintenance are ready. Keep this terminal open.");
  console.log("Run npm run test:local in a second terminal for the account and email smoke checks.");
} catch (error) {
  console.error(error.message);
  await stop(1);
}
