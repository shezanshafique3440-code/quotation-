export interface LocalMailAddresses { smtpPort: number; httpPort: number }
export function createLocalMailServer(options?: {
  smtpPort?: number;
  httpPort?: number;
  maxMessages?: number;
}): {
  start(): Promise<LocalMailAddresses>;
  close(): Promise<void>;
};
