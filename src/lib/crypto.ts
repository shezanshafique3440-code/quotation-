import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getEnv } from "./env";

/**
 * Keyed one-way derivation used for anything we must be able to *match* but
 * never need to read back: session tokens, portal tokens, client IPs.
 *
 * Keyed with SESSION_SECRET, so a database dump alone yields neither a usable
 * token nor a reversible IP. Falls back to a plain digest in development,
 * where SESSION_SECRET is optional — never storing the raw value either way.
 */
export function fingerprint(value: string, purpose = ""): string {
  const input = purpose === "" ? value : `${purpose}:${value}`;
  const secret = getEnv().SESSION_SECRET;
  return secret
    ? createHmac("sha256", secret).update(input).digest("hex")
    : createHash("sha256").update(input).digest("hex");
}

/** URL-safe random token. 32 bytes is 256 bits of entropy. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/**
 * Share-link token for a public quotation page. Shorter than a session token
 * but still 192 bits, and it authorises exactly one quotation.
 */
export function randomShareToken(): string {
  return randomBytes(24).toString("base64url");
}

export function safeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
