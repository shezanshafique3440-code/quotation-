import { fingerprint } from "./crypto";
import { getEnv } from "./env";

/** Minimal shape shared by `Headers` and Next's `ReadonlyHeaders`. */
export interface HeaderBag {
  get(name: string): string | null;
}

/**
 * Best-effort client address.
 *
 * `x-forwarded-for` is client-controllable unless a proxy overwrites it, so it
 * is only trusted when the deployment says a trusted proxy sits in front —
 * otherwise every request shares one bucket, which throttles rather than
 * silently granting an attacker unlimited attempts by spoofing the header.
 */
export function clientIp(headers: HeaderBag): string {
  if (!getEnv().TRUST_PROXY_HEADERS) return "untrusted-proxy";

  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() || "unknown";
}

/** Stored in place of the address itself, on audit rows and signatures. */
export function clientIpHash(headers: HeaderBag): string {
  return fingerprint(clientIp(headers), "ip");
}

export function userAgent(headers: HeaderBag): string | null {
  const value = headers.get("user-agent");
  return value ? value.slice(0, 400) : null;
}

/**
 * Requests that obviously come from a link-preview crawler rather than a
 * person. Counting those as "customer viewed the quote" would make the
 * analytics lie, so view tracking skips them.
 */
const BOT_PATTERN =
  /bot|crawler|spider|slurp|facebookexternalhit|whatsapp|telegram|preview|monitoring|headless|lighthouse|pingdom|curl\/|wget|python-requests|okhttp|postman/i;

export function looksAutomated(agent: string | null): boolean {
  if (!agent) return true;
  return BOT_PATTERN.test(agent);
}
