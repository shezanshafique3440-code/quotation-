import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { MIN_PASSWORD_LENGTH } from "./constants";

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

// ~64 MB of memory per hash; `maxmem` must exceed 128 * N * r.
const PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LENGTH = 64;

export { MIN_PASSWORD_LENGTH };

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, PARAMS);
  return [
    "scrypt",
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString("base64url"),
    derived.toString("base64url"),
  ].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, nRaw, rRaw, pRaw, saltRaw, hashRaw] = parts as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  const N = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  const expected = Buffer.from(hashRaw, "base64url");
  if (expected.length === 0) return false;

  const derived = await scrypt(password.normalize("NFKC"), Buffer.from(saltRaw, "base64url"), expected.length, {
    N,
    r,
    p,
    maxmem: Math.max(PARAMS.maxmem, 256 * N * r),
  });

  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
