/**
 * Runs once when the server process starts.
 *
 * `getEnv` skips its fatal production checks during `next build`, because the
 * build machine has no production secrets. This is where they are enforced, so
 * a deployment with a placeholder session secret or an unverifiable Stripe
 * webhook fails to boot rather than quietly serving traffic.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { assertProductionSafe, describeEnvironment } = await import("./lib/env");

  assertProductionSafe();

  const report = describeEnvironment();
  for (const warning of report.warnings) {
    console.warn(`[env] ${warning}`);
  }
  console.info(
    `[env] ${report.nodeEnv} · ai=${report.ai} billing=${report.billing} email=${report.email} cron=${report.cron} publicPages=${report.publicPages}`,
  );
}
