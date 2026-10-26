export const MAINTENANCE_INTERVAL_MS = 60 * 60 * 1000;
export const MAINTENANCE_TIMEOUT_MS = 30 * 1000;

export class MaintenanceError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MaintenanceError';
  }
}

/** The bearer credential only goes to the explicitly configured app origin. */
export function maintenanceConfig(environment) {
  const secret = environment.CRON_SECRET;
  if (typeof secret !== 'string' || secret.trim().length < 16) {
    throw new MaintenanceError('CRON_SECRET must be configured with at least 16 characters. Run local setup first.');
  }

  let origin;
  try {
    origin = new URL(environment.APP_URL || 'http://localhost:3000');
  } catch {
    throw new MaintenanceError('APP_URL must be a valid application origin.');
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
  if (origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash ||
      (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && loopback))) {
    throw new MaintenanceError('APP_URL must be an HTTPS origin, or an HTTP loopback origin for local testing, without credentials, a path or query.');
  }
  return { url: new URL('/api/cron/reminders', origin.origin).href, secret };
}

function summaryOf(body) {
  const counts = ['quotationsExpired', 'rateLimitRowsPruned', 'authTokensPruned', 'invitationsPruned', 'digestsSent'];
  if (!body || typeof body !== 'object' || typeof body.ranAt !== 'string' ||
      !Number.isFinite(Date.parse(body.ranAt)) ||
      !counts.every((key) => Number.isSafeInteger(body[key]) && body[key] >= 0) ||
      !Array.isArray(body.dueReminders) || !Array.isArray(body.digestsSkipped)) {
    throw new MaintenanceError('The maintenance endpoint returned an unexpected response. Check the application server.');
  }
  return {
    ranAt: body.ranAt,
    quotationsExpired: body.quotationsExpired,
    rateLimitRowsPruned: body.rateLimitRowsPruned,
    authTokensPruned: body.authTokensPruned,
    invitationsPruned: body.invitationsPruned,
    digestsSent: body.digestsSent,
    digestsSkipped: body.digestsSkipped.length,
    dueReminders: body.dueReminders.length,
  };
}

/** Return counts only: response rows may contain private customer details. */
export async function runMaintenance(config, options = {}) {
  const { fetchImpl = globalThis.fetch, signal, timeoutMs = MAINTENANCE_TIMEOUT_MS } = options;
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  const requestSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  try {
    const response = await fetchImpl(config.url, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.secret}`, accept: 'application/json' },
      // Never forward a bearer credential through a redirect, even to HTTPS.
      redirect: 'error',
      signal: requestSignal,
    });
    if (!response.ok) {
      if (response.status === 401) {
        throw new MaintenanceError('Maintenance was rejected (HTTP 401). Check that the runner and app use the same CRON_SECRET, then restart the app.');
      }
      throw new MaintenanceError(`Maintenance failed (HTTP ${response.status}). Check the application server logs.`);
    }
    let body;
    try { body = await response.json(); }
    catch { throw new MaintenanceError('The maintenance endpoint did not return valid JSON. Check the application server.'); }
    return summaryOf(body);
  } catch (error) {
    if (error instanceof MaintenanceError) throw error;
    if (signal?.aborted) throw new MaintenanceError('The maintenance request was cancelled.');
    if (timedOut) throw new MaintenanceError('The maintenance request timed out. Check the application server.');
    // Network errors can contain request URLs or credentials. Do not relay them.
    throw new MaintenanceError('The maintenance endpoint could not be reached, or attempted a redirect. Check APP_URL and that the application is running.');
  } finally {
    clearTimeout(timeout);
  }
}

/** Schedule after each completion, so a slow request never overlaps another. */
export function watchMaintenance(config, options = {}) {
  const {
    intervalMs = MAINTENANCE_INTERVAL_MS,
    run = runMaintenance,
    onResult = () => {},
    onError = () => {},
  } = options;
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1) {
    throw new MaintenanceError('The maintenance interval must be a positive number of milliseconds.');
  }
  const controller = new AbortController();
  let timer;
  let stopped = false;
  let running = false;
  let resolveDone;
  const done = new Promise((resolve) => { resolveDone = resolve; });
  const tick = async () => {
    if (stopped) return;
    running = true;
    try {
      const summary = await run(config, { signal: controller.signal });
      if (!stopped) onResult(summary);
    } catch (error) {
      if (!stopped) onError(error instanceof MaintenanceError ? error : new MaintenanceError('Maintenance failed. Check the application server.'));
    } finally {
      running = false;
      if (stopped) resolveDone();
      else timer = setTimeout(tick, intervalMs);
    }
  };
  void tick();
  return {
    done,
    stop() {
      if (stopped) return;
      stopped = true;
      clearTimeout(timer);
      controller.abort();
      if (!running) resolveDone();
    },
  };
}

export function formatMaintenanceSummary(summary) {
  return `Maintenance complete: ${summary.quotationsExpired} quotation(s) expired, ${summary.dueReminders} reminder(s) due, ${summary.digestsSent} digest(s) sent, ${summary.digestsSkipped} digest(s) skipped.`;
}
