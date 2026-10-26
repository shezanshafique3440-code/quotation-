export function assertLocalNode(version?: string): void;
export function prepareLocalEnvironment(options?: {
  cwd?: string;
  environment?: Record<string, string | undefined>;
  mail?: boolean;
  generateSecret?: () => string;
}): {
  environment: Record<string, string | undefined>;
  changedNames: string[];
  writtenFiles: string[];
};
