import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertLocalNode, prepareLocalEnvironment } from "./local-env.mjs";

const cwd = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function main() {
  assertLocalNode();
  const flags = new Set(process.argv.slice(2));
  if ([...flags].some((flag) => flag !== "--mail")) {
    throw new Error("Usage: npm run setup:local -- [--mail]");
  }
  const npmCli = process.env.npm_execpath;
  if (!npmCli || !existsSync(npmCli)) {
    throw new Error("Run this setup using npm run setup:local so it can invoke npm safely on Windows, macOS and Linux.");
  }

  const local = prepareLocalEnvironment({ cwd, mail: flags.has("--mail") });
  console.log(local.writtenFiles.length
    ? `Prepared local settings in ${local.writtenFiles.join(", ")}; secret values were not displayed.`
    : "Preserved existing local settings.");
  const run = (args) => {
    const result = spawnSync(process.execPath, [npmCli, ...args], {
      cwd,
      env: local.environment,
      stdio: "inherit",
      shell: false,
    });
    if (result.error) throw new Error(`Could not start npm ${args[0]}: ${result.error.code ?? "process error"}`);
    if (result.status !== 0) {
      process.exitCode = result.status ?? 1;
      throw new Error(`npm ${args.join(" ")} did not complete. Correct the reported prerequisite and rerun setup; no database reset was requested.`);
    }
  };

  run(["ci", "--include=dev", "--no-audit", "--no-fund"]);
  run(["run", "db:generate"]);
  run(["run", "db:push", "--", "--skip-generate"]);
  run(["run", "db:seed"]);
  run(["run", "db:seed:local"]);
  console.log("Local setup completed.");
  if (flags.has("--mail")) {
    console.log("Start the app, local email inbox and maintenance watcher together with npm run dev:local.");
  } else {
    console.log("Start the app with npm run dev. Local mail capture remains off unless explicitly configured.");
  }
  console.log("Run maintenance once with npm run maintenance, or keep it running with npm run maintenance:watch.");
  console.log("Third-party AI and payments remain disabled unless your own provider settings enable them. No GitHub push was performed.");
}

main().catch((error) => {
  console.error(`[setup:local] ${error instanceof Error ? error.message : "Setup failed."}`);
  process.exitCode ||= 1;
});
