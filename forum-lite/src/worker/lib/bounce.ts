const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

function firstEmail(value: string | null | undefined): string | null {
  const match = value?.match(EMAIL_RE);
  return match ? match[0].toLowerCase() : null;
}

function headerValue(raw: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = raw.match(new RegExp(`^${escaped}:\\s*(.+(?:\\r?\\n[\\t ].+)*)`, "im"));
  return match ? match[1].replace(/\r?\n[\t ]+/g, " ").trim() : null;
}

export function parseBounceEmail(raw: string, headers?: Headers): { email: string; reason: string; details: string } | null {
  const subject = headers?.get("subject") || headerValue(raw, "Subject") || "";
  const contentType = headers?.get("content-type") || headerValue(raw, "Content-Type") || "";
  const xFailed = headers?.get("x-failed-recipients") || headerValue(raw, "X-Failed-Recipients");

  const looksLikeBounce =
    /delivery-status|multipart\/report|message\/delivery-status/i.test(contentType) ||
    /undeliver|delivery status|mail delivery|returned mail|failure notice|delivery failure/i.test(subject) ||
    /Final-Recipient:/i.test(raw);

  if (!looksLikeBounce) return null;

  const finalRecipient = raw.match(/^Final-Recipient:\s*(?:rfc822;)?\s*(.+)$/im)?.[1];
  const originalRecipient = raw.match(/^Original-Recipient:\s*(?:rfc822;)?\s*(.+)$/im)?.[1];
  const email = firstEmail(xFailed) || firstEmail(finalRecipient) || firstEmail(originalRecipient);
  if (!email) return null;

  const status = raw.match(/^Status:\s*([245]\.\d+\.\d+)/im)?.[1] || "";
  const action = raw.match(/^Action:\s*(\S+)/im)?.[1] || "";
  const diagnostic = raw.match(/^Diagnostic-Code:\s*(.+(?:\r?\n[\t ].+)*)/im)?.[1]?.replace(/\r?\n[\t ]+/g, " ").trim() || "";

  const reason = status.startsWith("4.") ? "soft_bounce" : "hard_bounce";
  const details = [
    subject ? `subject=${subject}` : "",
    status ? `status=${status}` : "",
    action ? `action=${action}` : "",
    diagnostic ? `diagnostic=${diagnostic}` : "",
  ].filter(Boolean).join("; ");

  return { email, reason, details };
}
