import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";

const TEST_DB = resolve(process.cwd(), ".test-data/test.db");
export const TEST_DATABASE_URL = `file:${TEST_DB}`;

/**
 * Create a real SQLite database from the Prisma schema once per run, so the
 * persistence tests exercise the same queries and constraints as production.
 */
export default function globalSetup() {
  mkdirSync(dirname(TEST_DB), { recursive: true });
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    rmSync(`${TEST_DB}${suffix}`, { force: true });
  }

  // The file was just removed, so a plain push creates the schema from scratch.
  execFileSync("npx", ["prisma", "db", "push", "--skip-generate"], {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });
}
