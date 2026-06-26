import type { EmailFailureClassification } from "./email-classification";
import type { Bindings } from "../types";

export type SmtpVerifyStatus = "deliverable" | "undeliverable" | "risky" | "temporary" | "unknown" | "skipped";

export type SmtpVerifyResult = {
  provider: "self_hosted_smtp";
  status: SmtpVerifyStatus;
  email: string;
  reason: string;
  mxHost?: string | null;
  smtpCode?: number | null;
  smtpMessage?: string | null;
  catchAll?: boolean;
  mailboxExists?: boolean | null;
  checks?: string[];
  error?: string | null;
};

export function smtpVerifierConfigured(env: Bindings): boolean {
  return Boolean(env.EMAIL_VERIFY_ENDPOINT?.trim());
}

export async function verifyWithSelfHostedSmtp(
  env: Bindings,
  email: string,
): Promise<SmtpVerifyResult | null> {
  const endpoint = env.EMAIL_VERIFY_ENDPOINT?.trim();
  if (!endpoint) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (env.EMAIL_VERIFY_SECRET) headers.authorization = `Bearer ${env.EMAIL_VERIFY_SECRET}`;

    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        email,
        mailFrom: env.EMAIL_VERIFY_FROM || "verify@fstdesk.com",
        helo: env.EMAIL_VERIFY_HELO || "fstdesk.com",
      }),
      signal: controller.signal,
    });

    const body = await res.json().catch(() => null) as Partial<SmtpVerifyResult> | null;
    if (!res.ok || !body) {
      return {
        provider: "self_hosted_smtp",
        status: "unknown",
        email,
        reason: `SMTP verifier HTTP ${res.status}`,
        error: body?.error ?? `HTTP ${res.status}`,
        checks: ["external SMTP verifier request failed"],
      };
    }

    return {
      provider: "self_hosted_smtp",
      status: normalizeSmtpStatus(body.status),
      email: String(body.email || email).trim().toLowerCase(),
      reason: String(body.reason || "SMTP verifier returned a result."),
      mxHost: body.mxHost ?? null,
      smtpCode: typeof body.smtpCode === "number" ? body.smtpCode : null,
      smtpMessage: body.smtpMessage ? String(body.smtpMessage) : null,
      catchAll: Boolean(body.catchAll),
      mailboxExists: typeof body.mailboxExists === "boolean" ? body.mailboxExists : null,
      checks: Array.isArray(body.checks) ? body.checks.map(String).slice(0, 16) : [],
      error: body.error ? String(body.error) : null,
    };
  } catch (error) {
    return {
      provider: "self_hosted_smtp",
      status: "unknown",
      email,
      reason: "SMTP verifier request failed.",
      error: error instanceof Error ? error.message : "request failed",
      checks: ["external SMTP verifier request failed"],
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function classificationForSmtpVerify(result: SmtpVerifyResult): EmailFailureClassification {
  const evidence = [
    `provider=${result.provider}`,
    result.mxHost ? `mx=${result.mxHost}` : "",
    result.smtpCode ? `smtp=${result.smtpCode}` : "",
    result.smtpMessage ? `message=${result.smtpMessage}` : "",
    result.catchAll ? "catch_all=yes" : "",
    ...(result.checks ?? []),
  ].filter(Boolean).map(String);

  if (result.status === "deliverable") {
    return {
      email: result.email,
      category: "smtp_deliverable",
      label: "SMTP mailbox accepted",
      risk: "low",
      action: "ignore",
      score: 2,
      temporary: false,
      reason: "Recipient MX accepted RCPT TO during SMTP handshake. No email DATA was sent.",
      evidence,
    };
  }

  if (result.status === "undeliverable") {
    return {
      email: result.email,
      category: "smtp_mailbox_rejected",
      label: "mailbox rejected",
      risk: "critical",
      action: "suppress",
      score: 97,
      temporary: false,
      reason: result.reason || "Recipient MX rejected the mailbox during SMTP handshake.",
      evidence,
    };
  }

  if (result.status === "risky") {
    return {
      email: result.email,
      category: result.catchAll ? "smtp_accept_all" : "smtp_risky",
      label: result.catchAll ? "accept-all domain" : "SMTP risky",
      risk: "high",
      action: "review",
      score: result.catchAll ? 68 : 78,
      temporary: false,
      reason: result.reason || "SMTP verifier could not prove mailbox-level deliverability.",
      evidence,
    };
  }

  if (result.status === "temporary") {
    return {
      email: result.email,
      category: "smtp_temporary",
      label: "SMTP temporary",
      risk: "medium",
      action: "review",
      score: 58,
      temporary: true,
      reason: result.reason || "Recipient MX returned a temporary SMTP response.",
      evidence,
    };
  }

  return {
    email: result.email,
    category: "smtp_unknown",
    label: "SMTP unknown",
    risk: "medium",
    action: "review",
    score: 50,
    temporary: true,
    reason: result.reason || "SMTP verifier could not determine mailbox status.",
    evidence,
  };
}

export function smtpVerifyDetail(result: SmtpVerifyResult): string {
  return [
    "smtp_verify",
    result.status,
    result.reason,
    result.mxHost ? `mx=${result.mxHost}` : "",
    result.smtpCode ? `smtp=${result.smtpCode}` : "",
    result.smtpMessage ? `message=${result.smtpMessage}` : "",
    result.catchAll ? "catch_all=yes" : "",
    result.error ? `error=${result.error}` : "",
    ...(result.checks ?? []),
  ].filter(Boolean).join(" | ").slice(0, 2000);
}

function normalizeSmtpStatus(value: unknown): SmtpVerifyStatus {
  const text = String(value || "").toLowerCase();
  if (text === "deliverable" || text === "undeliverable" || text === "risky" || text === "temporary" || text === "unknown") {
    return text;
  }
  return "unknown";
}
