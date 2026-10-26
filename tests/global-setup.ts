import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const TEST_DB = resolve(process.cwd(), ".test-data/test.db");
export const TEST_DATABASE_URL = `file:${TEST_DB.replace(/\\/g, "/")}`;

/**
 * Create a real SQLite database from the Prisma schema once per run, so the
 * persistence tests exercise the same queries and constraints as production.
 */
export default function globalSetup() {
  mkdirSync(dirname(TEST_DB), { recursive: true });
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    rmSync(`${TEST_DB}${suffix}`, { force: true });
  }

  // SQLite accepts an empty file as a new database. Create it explicitly:
  // Prisma's schema engine can fail before schemaPush when the file is absent.
  writeFileSync(TEST_DB, "", { flag: "wx" });
  // Run the locked CLI through Node: npx.cmd is not directly executable by
  // execFileSync on Windows, and this also avoids any implicit CLI download.
  const prismaCli = createRequire(import.meta.url).resolve("prisma/build/index.js");
  execFileSync(process.execPath, [prismaCli, "db", "push", "--skip-generate"], {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });
}
