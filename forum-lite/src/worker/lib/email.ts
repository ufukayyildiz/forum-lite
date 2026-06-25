import type { Bindings } from "../types";

const DEFAULT_FROM = "noreply@devfox.net";

export type EmailSendResult = {
  ok: boolean;
  code?: string;
  message?: string;
  suppressed?: boolean;
};

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
    `Content-Transfer-Encoding: quoted-printable`,
    ``,
    text,
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset=utf-8`,
    `Content-Transfer-Encoding: quoted-printable`,
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

  if (res.ok) return { ok: true };
  const body = await res.text().catch(() => "");
  return { ok: false, error: body.slice(0, 500) };
}
