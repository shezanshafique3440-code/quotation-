/* global document, window */
const container = document.getElementById("messages");
const status = document.getElementById("status");
let previousIds = "";

function element(tag, text) {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
}

async function refresh() {
  try {
    const response = await fetch("/api/messages", { cache: "no-store" });
    if (!response.ok) throw new Error("Inbox unavailable");
    const { messages } = await response.json();
    status.textContent = messages.length ? `${messages.length} captured message(s). Newest first.` : "Waiting for your first test email…";
    const ids = messages.map((message) => message.id).join(",");
    if (ids === previousIds) return;
    previousIds = ids;
    container.replaceChildren();
    for (const message of messages) {
      const card = document.createElement("article");
      card.append(element("h2", message.subject));
      card.append(element("p", `From: ${message.from}`));
      card.append(element("p", `To: ${message.to}`));
      card.append(element("p", new Date(message.receivedAt).toLocaleString()));
      card.append(element("pre", message.text));
      const links = element("div", "");
      links.className = "links";
      for (const candidate of new Set(message.text.match(/https?:\/\/[^\s<>]+/g) || [])) {
        try {
          const url = new URL(candidate);
          if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) continue;
          const link = element("a", url.pathname.startsWith("/verify-email/") ? "Open verification page" : url.pathname.startsWith("/reset-password/") ? "Open password reset page" : "Open local app link");
          link.href = url.href;
          link.target = "_blank";
          link.rel = "noreferrer noopener";
          links.append(link);
        } catch { /* A line break or punctuation can make an email URL incomplete. */ }
      }
      card.append(links);
      container.append(card);
    }
  } catch {
    status.textContent = "Inbox unavailable. Keep npm run mail:local running, then refresh.";
  }
}

document.getElementById("refresh").addEventListener("click", refresh);
window.setInterval(refresh, 3000);
refresh();
