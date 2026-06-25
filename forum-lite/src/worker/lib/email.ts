import type { Bindings } from "../types";

const DEFAULT_FROM = "noreply@devfox.net";

export type EmailSendResult = {
  ok: boolean;
  code?: string;
  message?: string;
  suppressed?: boolean;
};

export type CloudflareSuppression = {
  email: string;
  reason?: string;
  created_at?: string;
  expires_at?: string | null;
};

export type CloudflareEmailFailure = {
  datetime?: string;
  from?: string;
  to?: string;
  subject?: string;
  status?: string;
  eventType?: string;
  sendingDomain?: string;
  messageId?: string;
  errorCause?: string;
  errorDetail?: string;
};

export function cloudflareEmailApiConfigured(env: Bindings): boolean {
  return Boolean(env.CF_ACCOUNT_ID && env.CF_EMAIL_API_TOKEN);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function generateMimeBoundary(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return "=_" + [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function buildMime({
  from,
  to,
  subject,
  text,
  html,
  headers,
}: {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  headers?: Record<string, string>;
}): string {
  const boundary = generateMimeBoundary();
  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    ...Object.entries(headers ?? {}).map(([key, value]) => `${key}: ${value.replace(/[\r\n]/g, " ")}`),
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/plain; charset=utf-8`,
    `Content-Transfer-Encoding: 8bit`,
    ``,
    text,
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset=utf-8`,
    `Content-Transfer-Encoding: 8bit`,
    ``,
    html,
    ``,
    `--${boundary}--`,
  ].join("\r\n");
}

export async function sendEmail(
  env: Bindings,
  opts: {
    to: string;
    subject: string;
    text: string;
    html: string;
    from?: string;
    headers?: Record<string, string>;
  },
): Promise<EmailSendResult> {
  const mailer = env.SEND_EMAIL as any;
  if (!mailer) return { ok: false, code: "E_EMAIL_BINDING_MISSING", message: "Email binding is not configured" };

  const from = opts.from ?? DEFAULT_FROM;
  const raw = buildMime({ from, to: opts.to, subject: opts.subject, text: opts.text, html: opts.html, headers: opts.headers });

  try {
    const { EmailMessage } = await (import("cloudflare:email") as any);
    const msg = new EmailMessage(from, opts.to, raw);
    await mailer.send(msg);
    return { ok: true };
  } catch (error: any) {
    const code = typeof error?.code === "string" ? error.code : "E_EMAIL_SEND_FAILED";
    const message = typeof error?.message === "string" ? error.message : "Email send failed";
    return { ok: false, code, message, suppressed: code === "E_RECIPIENT_SUPPRESSED" };
  }
}

export function welcomeEmail(username: string, siteUrl: string) {
  const safeUsername = escapeHtml(username);
  const safeSiteUrl = escapeHtml(siteUrl);
  const subject = `Welcome to FSTDESK Forum, ${username}!`;
  const text = `Hi ${username},\n\nYour account has been created successfully.\n\nVisit the forum: ${siteUrl}\n\nHappy posting!`;
  const html = `<!DOCTYPE html><html><body style="font-family:monospace;background:#282828;color:#ebdbb2;padding:24px">
<h2 style="color:#fabd2f">Welcome, ${safeUsername}!</h2>
<p>Your account has been created successfully.</p>
<p><a href="${safeSiteUrl}" style="color:#95c7c0">Visit the forum &rarr;</a></p>
<p style="color:#928374;font-size:12px">Happy posting!</p>
</body></html>`;
  return { subject, text, html };
}

export function newPasswordEmail(username: string, password: string, siteUrl: string) {
  const safeUsername = escapeHtml(username);
  const safePassword = escapeHtml(password);
  const safeSiteUrl = escapeHtml(siteUrl);
  const subject = "Your FSTDESK Forum password";
  const text = `Hi ${username},\n\nYour new forum password is:\n\n${password}\n\nSign in: ${siteUrl}/login\n\nIf you did not request this, sign in and change your password again.`;
  const html = `<!DOCTYPE html><html><body style="font-family:monospace;background:#282828;color:#ebdbb2;padding:24px">
<h2 style="color:#fabd2f">Your FSTDESK Forum password</h2>
<p>Hi <strong>${safeUsername}</strong>, your password is:</p>
<p style="font-size:22px;letter-spacing:2px;color:#8ec07c;background:#3c3836;border:1px solid #504945;padding:10px 14px;display:inline-block">${safePassword}</p>
<p><a href="${safeSiteUrl}/login" style="color:#95c7c0">Sign in &rarr;</a></p>
<p style="color:#928374;font-size:12px">If you did not request this, sign in and change your password again.</p>
</body></html>`;
  return { subject, text, html };
}

export function accountCreatedPasswordEmail(username: string, password: string, siteUrl: string) {
  const safeUsername = escapeHtml(username);
  const safePassword = escapeHtml(password);
  const safeSiteUrl = escapeHtml(siteUrl);
  const subject = "Your FSTDESK Forum account password";
  const text = `Hi ${username},\n\nYour FSTDESK Forum account has been created.\n\nYour temporary password is:\n\n${password}\n\nSign in: ${siteUrl}/login\n\nYour email will be marked verified after your first successful sign in.`;
  const html = `<!DOCTYPE html><html><body style="font-family:monospace;background:#282828;color:#ebdbb2;padding:24px">
<h2 style="color:#fabd2f">Your FSTDESK Forum account</h2>
<p>Hi <strong>${safeUsername}</strong>, your account has been created.</p>
<p>Your temporary password is:</p>
<p style="font-size:22px;letter-spacing:2px;color:#8ec07c;background:#3c3836;border:1px solid #504945;padding:10px 14px;display:inline-block">${safePassword}</p>
<p><a href="${safeSiteUrl}/login" style="color:#95c7c0">Sign in &rarr;</a></p>
<p style="color:#928374;font-size:12px">Your email will be marked verified after your first successful sign in.</p>
</body></html>`;
  return { subject, text, html };
}

export async function addCloudflareSuppression(
  env: Bindings,
  email: string,
): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  const accountId = env.CF_ACCOUNT_ID;
  const token = env.CF_EMAIL_API_TOKEN;
  if (!accountId || !token) return { ok: false, skipped: true };

  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/email/sending/suppression`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email }),
  });

  if (res.ok || res.status === 409) return { ok: true };
  const body = await res.text().catch(() => "");
  if (/already|exists|duplicate/i.test(body)) return { ok: true };
  return { ok: false, error: body.slice(0, 500) };
}

function cloudflareAuth(env: Bindings): { accountId: string; token: string } | null {
  if (!env.CF_ACCOUNT_ID || !env.CF_EMAIL_API_TOKEN) return null;
  return { accountId: env.CF_ACCOUNT_ID, token: env.CF_EMAIL_API_TOKEN };
}

async function cfJson<T>(url: string, token: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const body = await res.json().catch(async () => ({ success: false, errors: [{ message: await res.text().catch(() => res.statusText) }] }));
  if (!res.ok || (body as any)?.success === false) {
    const message = JSON.stringify((body as any)?.errors ?? body).slice(0, 700);
    throw new Error(message || res.statusText);
  }
  return body as T;
}

export async function listCloudflareSuppressions(env: Bindings): Promise<CloudflareSuppression[]> {
  const auth = cloudflareAuth(env);
  if (!auth) throw new Error("CF_ACCOUNT_ID / CF_EMAIL_API_TOKEN missing");
  const url = `https://api.cloudflare.com/client/v4/accounts/${auth.accountId}/email/sending/suppression?per_page=1000&order=created_at&direction=desc`;
  const body = await cfJson<{ result?: CloudflareSuppression[] }>(url, auth.token);
  return body.result ?? [];
}

async function findZoneId(env: Bindings, sendingDomain: string): Promise<string> {
  if (env.CF_ZONE_ID) return env.CF_ZONE_ID;
  const auth = cloudflareAuth(env);
  if (!auth) throw new Error("CF_ACCOUNT_ID / CF_EMAIL_API_TOKEN missing");
  const domain = sendingDomain.replace(/^.*@/, "").toLowerCase();
  const url = `https://api.cloudflare.com/client/v4/zones?name=${encodeURIComponent(domain)}&account.id=${encodeURIComponent(auth.accountId)}`;
  const body = await cfJson<{ result?: Array<{ id: string; name: string }> }>(url, auth.token);
  const zone = body.result?.[0];
  if (!zone?.id) throw new Error(`Cloudflare zone not found for ${domain}; set CF_ZONE_ID`);
  return zone.id;
}

function isDeliveryFailure(row: CloudflareEmailFailure): boolean {
  const haystack = [
    row.status,
    row.eventType,
    row.errorCause,
    row.errorDetail,
  ].filter(Boolean).join(" ").toLowerCase();
  return /\b(deliveryfailed|delivery failed|failed|failure|rejected|reject|errored|error|bounce|bounced)\b/.test(haystack) ||
    /\b(4\d\d|5\d\d|4\.\d\.\d|5\.\d\.\d|quota|overquota|out of storage|mailbox full|recipient.*storage)\b/.test(haystack);
}

function matchesSendingDomain(row: CloudflareEmailFailure, sendingDomain: string): boolean {
  const domain = sendingDomain.replace(/^.*@/, "").toLowerCase();
  if (!domain) return true;
  const from = String(row.from ?? "").toLowerCase();
  const eventDomain = String(row.sendingDomain ?? "").toLowerCase();
  return eventDomain === domain || eventDomain.endsWith(`.${domain}`) || from.endsWith(`@${domain}`);
}

export async function listCloudflareDeliveryFailures(
  env: Bindings,
  opts: { sendingDomain: string; hours?: number },
): Promise<CloudflareEmailFailure[]> {
  const auth = cloudflareAuth(env);
  if (!auth) throw new Error("CF_ACCOUNT_ID / CF_EMAIL_API_TOKEN missing");
  const hours = Math.max(1, Math.min(24 * 30, Math.round(opts.hours ?? 72)));
  const zoneTag = await findZoneId(env, opts.sendingDomain);
  const end = new Date();
  const start = new Date(end.getTime() - hours * 60 * 60 * 1000);
  const query = `
    query RecentEmailFailures($zoneTag: string!, $start: Time!, $end: Time!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          emailSendingAdaptive(
            filter: { datetime_geq: $start, datetime_leq: $end }
            limit: 1000
            orderBy: [datetime_DESC]
          ) {
            datetime
            from
            to
            subject
            status
            eventType
            sendingDomain
            messageId
            errorCause
            errorDetail
          }
        }
      }
    }
  `;
  const body = await cfJson<{ data?: { viewer?: { zones?: Array<{ emailSendingAdaptive?: CloudflareEmailFailure[] }> } }; errors?: unknown[] }>(
    "https://api.cloudflare.com/client/v4/graphql",
    auth.token,
    {
      method: "POST",
      body: JSON.stringify({
        query,
        variables: { zoneTag, start: start.toISOString(), end: end.toISOString() },
      }),
    },
  );
  const rows = body.data?.viewer?.zones?.[0]?.emailSendingAdaptive ?? [];
  return rows.filter((row) => Boolean(row.to) && matchesSendingDomain(row, opts.sendingDomain) && isDeliveryFailure(row));
}
