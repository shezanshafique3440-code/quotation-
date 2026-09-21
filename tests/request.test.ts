import { afterEach, describe, expect, it } from "vitest";
import { clientIp, clientIpHash, looksAutomated, userAgent } from "@/lib/request";
import { resetEnvCache } from "@/lib/env";

function headers(map: Record<string, string>) {
  return { get: (name: string) => map[name.toLowerCase()] ?? null };
}

afterEach(() => {
  process.env.TRUST_PROXY_HEADERS = "true";
  resetEnvCache();
});

describe("clientIp", () => {
  it("takes the first entry of x-forwarded-for when a proxy is trusted", () => {
    expect(clientIp(headers({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" }))).toBe("203.0.113.5");
    expect(clientIp(headers({ "x-forwarded-for": "  203.0.113.5  " }))).toBe("203.0.113.5");
  });

  it("falls back to x-real-ip, then to a marker", () => {
    expect(clientIp(headers({ "x-real-ip": "198.51.100.7" }))).toBe("198.51.100.7");
    expect(clientIp(headers({}))).toBe("unknown");
  });

  it("refuses to trust a spoofable header when no proxy is declared", () => {
    process.env.TRUST_PROXY_HEADERS = "false";
    resetEnvCache();

    // One shared bucket throttles everyone rather than letting an attacker mint
    // a fresh bucket per request by varying the header.
    expect(clientIp(headers({ "x-forwarded-for": "1.1.1.1" }))).toBe("untrusted-proxy");
    expect(clientIp(headers({ "x-forwarded-for": "2.2.2.2" }))).toBe("untrusted-proxy");
  });
});

describe("clientIpHash", () => {
  it("is stable for one address and different for another, and never the address", () => {
    const a = clientIpHash(headers({ "x-forwarded-for": "203.0.113.5" }));
    const b = clientIpHash(headers({ "x-forwarded-for": "203.0.113.5" }));
    const c = clientIpHash(headers({ "x-forwarded-for": "198.51.100.7" }));

    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toContain("203.0.113.5");
  });
});

describe("userAgent", () => {
  it("returns the header, truncated, or null", () => {
    expect(userAgent(headers({ "user-agent": "Mozilla/5.0" }))).toBe("Mozilla/5.0");
    expect(userAgent(headers({ "user-agent": "x".repeat(900) })!)).toHaveLength(400);
    expect(userAgent(headers({}))).toBeNull();
  });
});

describe("looksAutomated", () => {
  it("flags crawlers, unfurlers and tooling", () => {
    for (const agent of [
      "WhatsApp/2.23.20.0",
      "facebookexternalhit/1.1",
      "Mozilla/5.0 (compatible; Googlebot/2.1)",
      "TelegramBot (like TwitterBot)",
      "curl/8.4.0",
      "python-requests/2.31",
      "HeadlessChrome/120",
      "Slackbot-LinkExpanding 1.0",
    ]) {
      expect(looksAutomated(agent)).toBe(true);
    }
  });

  it("treats a missing agent as automated", () => {
    expect(looksAutomated(null)).toBe(true);
    expect(looksAutomated("")).toBe(true);
  });

  it("lets real browsers through", () => {
    for (const agent of [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
    ]) {
      expect(looksAutomated(agent)).toBe(false);
    }
  });
});
