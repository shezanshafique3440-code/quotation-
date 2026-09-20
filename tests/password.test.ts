import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/password";

describe("password hashing", () => {
  it("round-trips a password and rejects the wrong one", async () => {
    const hash = await hashPassword("correct-horse-battery");
    expect(await verifyPassword("correct-horse-battery", hash)).toBe(true);
    expect(await verifyPassword("correct-horse-batteryX", hash)).toBe(false);
    expect(await verifyPassword("", hash)).toBe(false);
  });

  it("salts every hash, so the same password hashes differently", async () => {
    const a = await hashPassword("same-password-here");
    const b = await hashPassword("same-password-here");
    expect(a).not.toBe(b);
    expect(await verifyPassword("same-password-here", b)).toBe(true);
  });

  it("stores the algorithm and parameters, never the plaintext", async () => {
    const hash = await hashPassword("super-secret-value");
    expect(hash.startsWith("scrypt$16384$8$1$")).toBe(true);
    expect(hash).not.toContain("super-secret-value");
  });

  it("returns false for a malformed stored hash instead of throwing", async () => {
    for (const bad of ["", "not-a-hash", "scrypt$1$2$3", "bcrypt$a$b$c$d$e"]) {
      await expect(verifyPassword("anything", bad)).resolves.toBe(false);
    }
  });

  it("normalises unicode so the same typed password matches", async () => {
    const composed = "café-password-1";
    const decomposed = "café-password-1";
    const hash = await hashPassword(composed);
    expect(await verifyPassword(decomposed, hash)).toBe(true);
  });
});
