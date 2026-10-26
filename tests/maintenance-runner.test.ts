import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formatMaintenanceSummary,
  maintenanceConfig,
  MaintenanceError,
  MAINTENANCE_INTERVAL_MS,
  runMaintenance,
  watchMaintenance,
  type MaintenanceSummary,
} from "../scripts/maintenance-runner.mjs";

const secret = "local-test-cron-value-32-characters";
const config = maintenanceConfig({ APP_URL: "http://localhost:3000", CRON_SECRET: secret });
const response = {
  ranAt: "2026-10-26T04:00:00.000Z",
  quotationsExpired: 2,
  rateLimitRowsPruned: 3,
  authTokensPruned: 4,
  invitationsPruned: 5,
  digestsSent: 1,
  dueReminders: [{ quotation: { customer: { email: "private@example.test" } } }],
  digestsSkipped: [{ error: "private transport detail" }],
};
const summary: MaintenanceSummary = {
  ranAt: response.ranAt,
  quotationsExpired: 2,
  rateLimitRowsPruned: 3,
  authTokensPruned: 4,
  invitationsPruned: 5,
  digestsSent: 1,
  dueReminders: 1,
  digestsSkipped: 1,
};

afterEach(() => vi.useRealTimers());

describe("maintenance destination", () => {
  it("accepts only the configured HTTPS or loopback origin and exact endpoint", () => {
    expect(config.url).toBe("http://localhost:3000/api/cron/reminders");
    expect(maintenanceConfig({ APP_URL: "https://quotes.example.test", CRON_SECRET: secret }).url)
      .toBe("https://quotes.example.test/api/cron/reminders");
    expect(maintenanceConfig({ APP_URL: "http://127.0.0.1:3456", CRON_SECRET: secret }).url)
      .toBe("http://127.0.0.1:3456/api/cron/reminders");
  });

  it.each([
    "http://remote.example.test", "https://user:password@example.test",
    "https://quotes.example.test/subpath", "https://quotes.example.test?target=elsewhere",
    "https://quotes.example.test/#fragment", "file:///tmp/app", "not an origin",
  ])("rejects an unsafe or ambiguous APP_URL without echoing it: %s", (APP_URL) => {
    expect(() => maintenanceConfig({ APP_URL, CRON_SECRET: secret })).toThrow(MaintenanceError);
    try { maintenanceConfig({ APP_URL, CRON_SECRET: secret }); }
    catch (error) { expect((error as Error).message).not.toContain(APP_URL); }
  });

  it("rejects missing or empty cron credentials", () => {
    for (const CRON_SECRET of [undefined, "", " ".repeat(32), "too-short"]) {
      expect(() => maintenanceConfig({ CRON_SECRET })).toThrow(/CRON_SECRET/);
    }
  });
});

describe("maintenance request", () => {
  it("authenticates a POST, disables redirects, and returns only safe counts", async () => {
    const fetchImpl = vi.fn(async () => Response.json(response));
    expect(await runMaintenance(config, { fetchImpl })).toEqual(summary);
    expect(fetchImpl).toHaveBeenCalledWith(config.url, expect.objectContaining({
      method: "POST", redirect: "error",
      headers: { authorization: `Bearer ${secret}`, accept: "application/json" },
      signal: expect.any(AbortSignal),
    }));
    const output = formatMaintenanceSummary(summary);
    expect(output).toContain("2 quotation(s) expired");
    expect(output).not.toContain(secret);
    expect(output).not.toContain("private");
  });

  it("does not print credential-bearing network errors", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error(`redirect with Bearer ${secret}`); });
    await expect(runMaintenance(config, { fetchImpl })).rejects.toThrow(/could not be reached/);
    await expect(runMaintenance(config, { fetchImpl })).rejects.not.toThrow(secret);
  });

  it.each([401, 403, 500])("rejects HTTP %i without exposing response rows", async (status) => {
    const fetchImpl = vi.fn(async () => new Response(secret, { status }));
    await expect(runMaintenance(config, { fetchImpl })).rejects.toThrow(`HTTP ${status}`);
    await expect(runMaintenance(config, { fetchImpl })).rejects.not.toThrow(secret);
  });

  it("rejects successful HTML and malformed summary bodies", async () => {
    await expect(runMaintenance(config, { fetchImpl: async () => new Response("<html>not the app</html>") }))
      .rejects.toThrow(/valid JSON/);
    await expect(runMaintenance(config, { fetchImpl: async () => Response.json({ ok: true }) }))
      .rejects.toThrow(/unexpected response/);
  });

  it("aborts a stalled request at its timeout", async () => {
    vi.useFakeTimers();
    const fetchImpl: typeof fetch = async (_input, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(new Error(secret)), { once: true });
    });
    const pending = expect(runMaintenance(config, { fetchImpl, timeoutMs: 50 })).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(50);
    await pending;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels a request when its owner stops it", async () => {
    const controller = new AbortController();
    const fetchImpl: typeof fetch = async (_input, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(new Error(secret)), { once: true });
    });
    const pending = expect(runMaintenance(config, { fetchImpl, signal: controller.signal }))
      .rejects.toThrow(/cancelled/);
    controller.abort();
    await pending;
  });
});

describe("local hourly watcher", () => {
  it("runs immediately, waits an hour after completion, and never overlaps", async () => {
    vi.useFakeTimers();
    let finish: ((result: MaintenanceSummary) => void) | undefined;
    const run = vi.fn(() => new Promise<MaintenanceSummary>((resolve) => { finish = resolve; }));
    const onResult = vi.fn();
    const watcher = watchMaintenance(config, { run, onResult });
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2 * MAINTENANCE_INTERVAL_MS);
    expect(run).toHaveBeenCalledTimes(1);
    finish!(summary);
    await Promise.resolve();
    expect(onResult).toHaveBeenCalledWith(summary);
    await vi.advanceTimersByTimeAsync(MAINTENANCE_INTERVAL_MS - 1);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
    watcher.stop();
    finish!(summary);
    await watcher.done;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps retrying after a failure and clears its timer on stop", async () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const run = vi.fn(async () => { throw new MaintenanceError("Server unavailable"); });
    const watcher = watchMaintenance(config, { run, onError });
    await Promise.resolve();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "Server unavailable" }));
    await vi.advanceTimersByTimeAsync(MAINTENANCE_INTERVAL_MS);
    expect(run).toHaveBeenCalledTimes(2);
    watcher.stop();
    await watcher.done;
    await vi.advanceTimersByTimeAsync(MAINTENANCE_INTERVAL_MS);
    expect(run).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts an in-flight request quietly when stopped", async () => {
    const onError = vi.fn();
    const run = vi.fn((_config, options) => new Promise<MaintenanceSummary>((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new MaintenanceError("Cancelled")), { once: true });
    }));
    const watcher = watchMaintenance(config, { run, onError });
    watcher.stop();
    await watcher.done;
    expect(onError).not.toHaveBeenCalled();
  });
});
