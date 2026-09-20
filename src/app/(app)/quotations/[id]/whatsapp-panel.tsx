"use client";

import { useState } from "react";
import { Alert } from "@/components/ui";

/**
 * QuoteFlow does not send WhatsApp messages. It produces the text and a
 * click-to-chat link that opens the owner's own WhatsApp with the message
 * pre-filled — the owner presses send.
 */
export function WhatsAppPanel({
  initialMessage,
  number,
}: {
  initialMessage: string;
  number: string | null;
}) {
  const [message, setMessage] = useState(initialMessage);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  const href = number
    ? `https://wa.me/${number}?text=${encodeURIComponent(message)}`
    : `https://wa.me/?text=${encodeURIComponent(message)}`;

  const copy = async () => {
    setCopyError(null);
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopyError("Your browser blocked clipboard access. Select the text and copy it manually.");
    }
  };

  return (
    <div className="space-y-3 px-5 py-4">
      {!number ? (
        <Alert tone="warning">
          This customer has no WhatsApp number saved, so the link will open WhatsApp without a
          recipient. Add one on the customer record to address it automatically.
        </Alert>
      ) : null}

      <textarea
        className="input min-h-56 font-mono text-xs leading-relaxed"
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        aria-label="WhatsApp message"
      />

      <div className="flex flex-wrap items-center gap-2">
        <a href={href} target="_blank" rel="noopener noreferrer" className="btn btn-primary">
          Open in WhatsApp
        </a>
        <button type="button" className="btn btn-secondary" onClick={copy}>
          {copied ? "Copied" : "Copy message"}
        </button>
        <span className="text-xs text-[var(--color-ink-subtle)]">
          {message.length} characters
        </span>
      </div>

      {copyError ? <Alert tone="danger">{copyError}</Alert> : null}

      <p className="text-xs text-[var(--color-ink-subtle)]">
        Opening WhatsApp pre-fills this text. Nothing is sent until you press send there, and marking
        the quotation as sent is a separate step.
      </p>
    </div>
  );
}
