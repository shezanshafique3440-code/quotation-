import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { SMTPServer } from "smtp-server";
import { simpleParser } from "mailparser";

const HOST = "127.0.0.1";

/** Real SMTP delivery into a loopback-only, in-memory development inbox. */
export function createLocalMailServer({ smtpPort = 1025, httpPort = 8025, maxMessages = 100 } = {}) {
  if (!Number.isInteger(maxMessages) || maxMessages < 1 || maxMessages > 1000) {
    throw new Error("Inbox capacity must be between 1 and 1000 messages.");
  }
  const messages = [];
  let listening = false;
  let addresses;
  const smtp = new SMTPServer({
    name: "quoteflow-local-inbox",
    authOptional: true,
    disabledCommands: ["AUTH", "STARTTLS"],
    size: 10 * 1024 * 1024,
    rejectOversized: true,
    maxRecipients: 100,
    logger: false,
    onData(stream, session, callback) {
      const chunks = [];
      stream.on("data", (chunk) => {
        if (!stream.sizeExceeded) chunks.push(chunk);
      });
      stream.once("error", () => callback(new Error("Message could not be read.")));
      stream.once("end", async () => {
        if (stream.sizeExceeded) {
          callback(Object.assign(new Error("Local inbox message exceeds 10 MiB."), { responseCode: 552 }));
          return;
        }
        try {
          const mail = await simpleParser(Buffer.concat(chunks));
          const id = randomUUID();
          messages.unshift({
            id,
            receivedAt: new Date().toISOString(),
            envelope: {
              from: session.envelope.mailFrom?.address || "",
              to: session.envelope.rcptTo.map((recipient) => recipient.address),
            },
            from: mail.from?.text || "",
            to: Array.isArray(mail.to) ? mail.to.map((to) => to.text).join(", ") : mail.to?.text || "",
            subject: mail.subject || "(no subject)",
            text: mail.text || "",
            html: typeof mail.html === "string" ? mail.html : "",
          });
          messages.length = Math.min(messages.length, maxMessages);
          callback(null, `Captured locally as ${id}`);
        } catch {
          callback(new Error("Message could not be decoded."));
        }
      });
    },
  });
  // A bad client must not crash the inbox or print private message content.
  smtp.on("error", () => {});

  const http = createServer(async (request, response) => {
    response.setHeader("cache-control", "no-store");
    response.setHeader("x-content-type-options", "nosniff");
    response.setHeader("referrer-policy", "no-referrer");
    response.setHeader("content-security-policy", "default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'");
    const json = (status, data) => {
      response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify(data));
    };
    const url = new URL(request.url || "/", `http://${HOST}`);
    // Reject DNS-rebinding and cross-origin browser requests to this local tool.
    const hostname = (request.headers.host || "").split(":")[0];
    if (hostname !== HOST && hostname !== "localhost") {
      json(403, { error: "Use the loopback inbox address." });
      return;
    }
    const origin = request.headers.origin;
    if (origin && origin !== `http://${request.headers.host}`) {
      json(403, { error: "Cross-origin inbox access is disabled." });
      return;
    }
    if (request.method !== "GET") {
      json(405, { error: "Only reading captured messages is supported." });
      return;
    }
    if (url.pathname === "/api/health") {
      json(200, { status: "ok", mode: "local-capture", ...addresses });
    } else if (url.pathname === "/api/messages") {
      json(200, { messages });
    } else if (url.pathname.startsWith("/api/messages/")) {
      const message = messages.find((item) => item.id === url.pathname.slice("/api/messages/".length));
      json(message ? 200 : 404, message || { error: "Message not found." });
    } else if (url.pathname === "/" || url.pathname === "/inbox.js") {
      try {
        const filename = url.pathname === "/" ? "local-mail.html" : "local-mail-ui.js";
        const body = await readFile(new URL(filename, import.meta.url));
        response.writeHead(200, { "content-type": url.pathname === "/" ? "text/html; charset=utf-8" : "text/javascript; charset=utf-8" });
        response.end(body);
      } catch {
        json(500, { error: "Inbox files could not be loaded." });
      }
    } else {
      json(404, { error: "Not found." });
    }
  });

  const listen = (server, port) => new Promise((resolve, reject) => {
    const fail = (error) => reject(error);
    server.once("error", fail);
    server.listen(port, HOST, () => {
      server.off("error", fail);
      resolve();
    });
  });
  const close = (server) => new Promise((resolve) => server.close(() => resolve()));

  return {
    async start() {
      if (listening) return addresses;
      await listen(smtp, smtpPort);
      try {
        await listen(http, httpPort);
      } catch (error) {
        await close(smtp);
        throw error;
      }
      listening = true;
      addresses = { smtpPort: smtp.server.address().port, httpPort: http.address().port };
      return addresses;
    },
    async close() {
      if (!listening) return;
      listening = false;
      http.closeIdleConnections();
      await Promise.all([close(http), close(smtp)]);
    },
  };
}
