export const MAINTENANCE_INTERVAL_MS: number;
export const MAINTENANCE_TIMEOUT_MS: number;
export class MaintenanceError extends Error {}
export interface MaintenanceConfig { url: string; secret: string }
export interface MaintenanceSummary {
  ranAt: string;
  quotationsExpired: number;
  rateLimitRowsPruned: number;
  authTokensPruned: number;
  invitationsPruned: number;
  digestsSent: number;
  digestsSkipped: number;
  dueReminders: number;
}
export interface RunOptions {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
}
export function maintenanceConfig(environment: Record<string, string | undefined>): MaintenanceConfig;
export function runMaintenance(config: MaintenanceConfig, options?: RunOptions): Promise<MaintenanceSummary>;
export function watchMaintenance(config: MaintenanceConfig, options?: {
  intervalMs?: number;
  run?: (config: MaintenanceConfig, options: RunOptions) => Promise<MaintenanceSummary>;
  onResult?: (summary: MaintenanceSummary) => void;
  onError?: (error: MaintenanceError) => void;
}): { done: Promise<void>; stop(): void };
export function formatMaintenanceSummary(summary: MaintenanceSummary): string;
