import type { CloudflareEmailFailure } from "./email";

export type EmailRisk = "critical" | "high" | "medium" | "low" | "system";
export type EmailAction = "suppress" | "review" | "ignore";

export type EmailFailureClassification = {
  email: string;
  category: string;
  label: string;
  risk: EmailRisk;
  action: EmailAction;
  score: number;
  temporary: boolean;
  reason: string;
  evidence: string[];
};

function normalizedText(row: CloudflareEmailFailure): string {
  return [
    row.status,
    row.eventType,
    row.errorCause,
    row.errorDetail,
    row.subject,
    row.messageId,
  ].filter(Boolean).join(" ").toLowerCase();
}

function matched(haystack: string, patterns: Array<[RegExp, string]>): string[] {
  return patterns.filter(([pattern]) => pattern.test(haystack)).map(([, label]) => label);
}

export function failureDetail(row: CloudflareEmailFailure): string {
  return [
    row.datetime,
    row.status,
    row.eventType,
    row.errorCause,
    row.errorDetail,
    row.subject ? `subject=${row.subject}` : "",
    row.messageId ? `messageId=${row.messageId}` : "",
  ].filter(Boolean).join(" | ").slice(0, 2000);
}

export function classifyCloudflareEmailFailure(row: CloudflareEmailFailure): EmailFailureClassification {
  const email = String(row.to ?? "").trim().toLowerCase();
  const text = normalizedText(row);
  const evidence = matched(text, [
    [/\b(5\.1\.1|550|551|553|user unknown|no such user|mailbox unavailable|mailbox not found|recipient address rejected|does not exist|invalid recipient)\b/, "recipient does not exist"],
    [/\b(mailbox[_ -]?no[_ -]?quota|overquota|over quota|out of storage|storage space|mailbox full|quota exceeded|overquotatemp|4\.2\.2)\b/, "mailbox full / over quota"],
    [/\b(temporary|transient|try again|defer|deferred|4\.7\.|421|451|452)\b/, "temporary delivery failure"],
    [/\b(spam|abuse|blocked|blocklist|blacklist|policy|reputation|complaint)\b/, "policy or reputation rejection"],
    [/\b(dmarc|spf|dkim|authentication|unauthorized|not authorized|sender|relay|routing_unknown_address|routing unknown)\b/, "sender/auth/routing issue"],
    [/\b(rate|throttl|quota|limit)\b/, "rate or quota limit"],
  ]);

  if (/\b(5\.1\.1|550|551|553|user unknown|no such user|mailbox unavailable|mailbox not found|recipient address rejected|does not exist|invalid recipient)\b/.test(text)) {
    return {
      email,
      category: "mailbox_not_found",
      label: "mailbox not found",
      risk: "critical",
      action: "suppress",
      score: 95,
      temporary: false,
      reason: "The recipient mailbox appears invalid or unavailable.",
      evidence,
    };
  }

  if (/\b(mailbox[_ -]?no[_ -]?quota|overquota|over quota|out of storage|storage space|mailbox full|quota exceeded|overquotatemp|4\.2\.2)\b/.test(text)) {
    return {
      email,
      category: "mailbox_full",
      label: "mailbox full",
      risk: "high",
      action: "suppress",
      score: 82,
      temporary: true,
      reason: "The mailbox is over quota or out of storage; avoid repeat sends until manually reviewed.",
      evidence,
    };
  }

  if (/\b(spam|abuse|blocked|blocklist|blacklist|policy|reputation|complaint)\b/.test(text)) {
    return {
      email,
      category: "policy_rejection",
      label: "policy rejection",
      risk: "high",
      action: "review",
      score: 76,
      temporary: false,
      reason: "Recipient or provider rejected the message by policy; review before suppressing.",
      evidence,
    };
  }

  if (/\b(dmarc|spf|dkim|authentication|unauthorized|not authorized|sender|relay|routing_unknown_address|routing unknown)\b/.test(text)) {
    return {
      email,
      category: "sender_or_routing",
      label: "sender/routing issue",
      risk: "system",
      action: "review",
      score: 35,
      temporary: false,
      reason: "This looks like a sender, DNS or Cloudflare routing issue, not a bad recipient.",
      evidence,
    };
  }

  if (/\b(temporary|transient|try again|defer|deferred|4\.7\.|421|451|452|rate|throttl|limit)\b/.test(text)) {
    return {
      email,
      category: "temporary_deferral",
      label: "temporary deferral",
      risk: "medium",
      action: "review",
      score: 58,
      temporary: true,
      reason: "Temporary delivery deferral. Repeated failures can be suppressed after review.",
      evidence,
    };
  }

  return {
    email,
    category: "unknown_failure",
    label: "unknown failure",
    risk: "low",
    action: "review",
    score: 40,
    temporary: true,
    reason: "Delivery failed but the error does not match a known bucket yet.",
    evidence,
  };
}
