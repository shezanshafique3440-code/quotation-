import { createLocalMailServer } from "./local-mail-server.mjs";

const server = createLocalMailServer();
try {
  const { smtpPort, httpPort } = await server.start();
  console.log(`Local SMTP capture listening on 127.0.0.1:${smtpPort}.`);
  console.log(`Open the local inbox on 127.0.0.1:${httpPort} in your browser.`);
  console.log("Messages stay in memory until this process closes; none are delivered externally.");
  const stop = async () => { await server.close(); process.exit(0); };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
} catch (error) {
  console.error(error?.code === "EADDRINUSE"
    ? "Local mail ports 1025 or 8025 are already in use. Stop the existing inbox first."
    : "Local inbox could not start. Check that ports 1025 and 8025 are available.");
  process.exitCode = 1;
}
