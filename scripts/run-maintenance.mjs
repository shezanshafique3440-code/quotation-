import nextEnvironment from '@next/env';
import { fileURLToPath } from 'node:url';
import {
  MaintenanceError,
  maintenanceConfig,
  runMaintenance,
  watchMaintenance,
  formatMaintenanceSummary,
} from './maintenance-runner.mjs';

const args = process.argv.slice(2);
if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
  console.log('Usage: node scripts/run-maintenance.mjs [--once | --watch]');
  console.log('Calls the configured app maintenance endpoint. --watch runs immediately, then hourly while this terminal remains open.');
} else if (args.length > 1 || (args.length === 1 && !['--once', '--watch'].includes(args[0]))) {
  console.error('Use --once or --watch. Secrets belong in environment configuration, never command arguments.');
  process.exitCode = 1;
} else {
  let watcher;
  const stop = () => watcher?.stop();
  try {
    const directory = fileURLToPath(new URL('../', import.meta.url));
    nextEnvironment.loadEnvConfig(directory, process.env.NODE_ENV !== 'production', {
      info() {},
      error() { throw new MaintenanceError('Local environment configuration could not be loaded. Check the .env files.'); },
    });
    const config = maintenanceConfig(process.env);
    if (args[0] === '--watch') {
      console.log('Maintenance watcher started. Runs now, then hourly. Keep this terminal open; press Ctrl+C to stop.');
      watcher = watchMaintenance(config, {
        onResult: (summary) => console.log(formatMaintenanceSummary(summary)),
        onError: (error) => console.error(error.message),
      });
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
      await watcher.done;
      console.log('Maintenance watcher stopped.');
    } else {
      console.log(formatMaintenanceSummary(await runMaintenance(config)));
    }
  } catch (error) {
    console.error(error instanceof MaintenanceError ? error.message : 'Maintenance could not start. Check the local configuration and installed dependencies.');
    process.exitCode = 1;
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}
