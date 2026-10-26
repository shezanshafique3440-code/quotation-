import { afterEach, describe, expect, it } from "vitest";
import nodemailer from "nodemailer";
import { createLocalMailServer } from "../scripts/local-mail-server.mjs";

let inbox: ReturnType<typeof createLocalMailServer> | undefined;
afterEach(async () => { await inbox?.close(); inbox = undefined; });

describe("local SMTP inbox", () => {
  it("accepts real SMTP email, decodes it and exposes local-only read routes", async () => {
    inbox = createLocalMailServer({ smtpPort: 0, httpPort: 0 });
    const { smtpPort, httpPort } = await inbox.start();
    const base = `http://127.0.0.1:${httpPort}`;
    const transport = nodemailer.createTransport({ host: "127.0.0.1", port: smtpPort, secure: false });
    try {
      const result = await transport.sendMail({
        from: "QuoteFlow <quotes@quoteflow.test>", to: "owner@example.test",
        subject: "Confirm your address ✓", text: "Open http://localhost:3000/verify-email/local-test",
        html: "<p>Open the verification link</p>",
      });
      expect(result.accepted).toContain("owner@example.test");
      expect(await (await fetch(`${base}/api/health`)).json()).toMatchObject({ status: "ok", mode: "local-capture" });
      const { messages } = await (await fetch(`${base}/api/messages`)).json();
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({
        subject: "Confirm your address ✓", text: "Open http://localhost:3000/verify-email/local-test",
        envelope: { from: "quotes@quoteflow.test", to: ["owner@example.test"] },
      });
      const message = await (await fetch(`${base}/api/messages/${messages[0].id}`)).json();
      expect(message.subject).toBe(messages[0].subject);
      expect((await fetch(`${base}/api/messages/missing`)).status).toBe(404);
      expect((await fetch(`${base}/api/messages`, { method: "DELETE" })).status).toBe(405);
      expect((await fetch(`${base}/api/messages`, { headers: { Origin: "https://other.example" } })).status).toBe(403);
      const page = await fetch(base);
      expect(page.headers.get("content-security-policy")).toContain("script-src 'self'");
      expect(await page.text()).toContain("QuoteFlow local inbox");
    } finally { transport.close(); }
  });

  it("bounds retained messages and starts repeatably without rebinding sockets", async () => {
    inbox = createLocalMailServer({ smtpPort: 0, httpPort: 0, maxMessages: 1 });
    const addresses = await inbox.start();
    expect(await inbox.start()).toEqual(addresses);
    const transport = nodemailer.createTransport({ host: "127.0.0.1", port: addresses.smtpPort, secure: false });
    try {
      for (const subject of ["First", "Second"]) await transport.sendMail({
        from: "local@quoteflow.test", to: "owner@example.test", subject, text: subject,
      });
      const { messages } = await (await fetch(`http://127.0.0.1:${addresses.httpPort}/api/messages`)).json();
      expect(messages).toHaveLength(1);
      expect(messages[0].subject).toBe("Second");
    } finally { transport.close(); }
  });
});
