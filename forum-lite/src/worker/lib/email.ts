import { connect } from "cloudflare:sockets";
import type { Bindings } from "../types";

export type EmailProvider = "cloudflare" | "ses";
export type SesTransport = "smtp" | "api";

export const DEFAULT_CLOUDFLARE_FROM = "noreply@devfox.net";
export const DEFAULT_SES_FROM = "support@fstdesk.com";
export const DEFAULT_SES_REGION = "eu-west-1";
export const DEFAULT_SES_TRANSPORT: SesTransport = "smtp";
export const DEFAULT_SES_SMTP_PORT = 587;

export type EmailSendResult = {
  ok: boolean;
  code?: string;
  message?: string;
  suppressed?: boolean;
  provider?: EmailProvider;
  messageId?: string;
};

type EmailSendOptions = {
  to: string;
  subject: string;
  text: string;
  html: string;
  from?: string;
  provider?: EmailProvider;
  sesRegion?: string;
  sesTransport?: SesTransport;
  sesPort?: number;
  headers?: Record<string, string>;
};

type SmtpCredentials = {
  username: string;
  password: string;
};

type SmtpResponse = {
  code: number;
  lines: string[];
  text: string;
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

function normalizeProvider(value: unknown): EmailProvider {
  return String(value ?? "").trim().toLowerCase() === "ses" ? "ses" : "cloudflare";
}

function normalizeSesTransport(value: unknown): SesTransport {
  return String(value ?? "").trim().toLowerCase() === "api" ? "api" : DEFAULT_SES_TRANSPORT;
}

function sesApiCredentials(env: Bindings, allowLegacy = false) {
  const accessKeyId = (env.AWS_SES_API_ACCESS_KEY_ID || (allowLegacy ? env.AWS_SES_ACCESS_KEY_ID : undefined))?.trim();
  const secretAccessKey = (env.AWS_SES_API_SECRET_ACCESS_KEY || (allowLegacy ? env.AWS_SES_SECRET_ACCESS_KEY : undefined))?.trim();
  const sessionToken = (env.AWS_SES_API_SESSION_TOKEN || (allowLegacy ? env.AWS_SES_SESSION_TOKEN : undefined))?.trim();
  return accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey, sessionToken } : null;
}

function sesSmtpCredentials(env: Bindings) {
  const username = env.AWS_SES_SMTP_USERNAME?.trim();
  const password = env.AWS_SES_SMTP_PASSWORD?.trim();
  return username && password ? { username, password } : null;
}

export function isAwsSesConfigured(env: Bindings, transport: SesTransport = DEFAULT_SES_TRANSPORT): boolean {
  return transport === "api" ? Boolean(sesApiCredentials(env, true)) : Boolean(sesSmtpCredentials(env));
}

function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function hex(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return [...view].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", utf8(value)));
}

async function hmacSha256(key: Uint8Array, value: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, utf8(value)));
}

async function awsSigningKey(secret: string, dateStamp: string, region: string, service: string): Promise<Uint8Array> {
  const kDate = await hmacSha256(utf8(`AWS4${secret}`), dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  return hmacSha256(kService, "aws4_request");
}

function amzDateParts(now = new Date()) {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return {
    amzDate: iso,
    dateStamp: iso.slice(0, 8),
  };
}

async function awsSesFetch(
  env: Bindings,
  opts: { region: string; method: "GET" | "POST"; path: string; body?: string },
): Promise<{ ok: boolean; status: number; bodyText: string; body: Record<string, unknown> }> {
  const credentials = sesApiCredentials(env, true);
  if (!credentials) {
    throw new Error("AWS SES API credentials are not configured");
  }

  const service = "ses";
  const host = `email.${opts.region}.amazonaws.com`;
  const payload = opts.body ?? "";
  const { amzDate, dateStamp } = amzDateParts();
  const payloadHash = await sha256Hex(payload);
  const headers: Record<string, string> = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (credentials.sessionToken) headers["x-amz-security-token"] = credentials.sessionToken;

  const headerKeys = Object.keys(headers).sort();
  const canonicalHeaders = headerKeys.map((key) => `${key}:${sanitizeHeaderValue(headers[key])}\n`).join("");
  const signedHeaders = headerKeys.join(";");
  const canonicalRequest = [opts.method, opts.path, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const credentialScope = `${dateStamp}/${opts.region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, await sha256Hex(canonicalRequest)].join("\n");
  const signingKey = await awsSigningKey(credentials.secretAccessKey, dateStamp, opts.region, service);
  const signature = hex(await hmacSha256(signingKey, stringToSign));
  const authorization = `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const res = await fetch(`https://${host}${opts.path}`, {
    method: opts.method,
    headers: {
      ...headers,
      Authorization: authorization,
    },
    body: opts.body,
  });
  const bodyText = await res.text();
  const body = bodyText ? JSON.parse(bodyText) as Record<string, unknown> : {};
  return { ok: res.ok, status: res.status, bodyText, body };
}

function awsErrorMessage(body: Record<string, unknown>, bodyText: string, fallback: string): { code: string; message: string } {
  const code = String(body.__type || body.name || body.Code || fallback);
  const message = String(body.message || body.Message || bodyText || fallback);
  return { code, message: message.slice(0, 700) };
}

async function checkSesSuppression(env: Bindings, email: string, region: string): Promise<EmailSendResult | null> {
  const path = `/v2/email/suppression/addresses/${encodeURIComponent(email)}`;
  const result = await awsSesFetch(env, { region, method: "GET", path });
  if (result.ok) {
    const suppressed = result.body.SuppressedDestination as Record<string, unknown> | undefined;
    return {
      ok: false,
      code: "E_AWS_SES_RECIPIENT_SUPPRESSED",
      message: `Recipient is on the AWS SES suppression list${suppressed?.Reason ? ` (${suppressed.Reason})` : ""}`,
      suppressed: true,
      provider: "ses",
    };
  }
  if (result.status === 404) return null;
  const error = awsErrorMessage(result.body, result.bodyText, `SES suppression check failed (${result.status})`);
  return {
    ok: false,
    code: error.code || "E_AWS_SES_SUPPRESSION_CHECK_FAILED",
    message: `AWS SES suppression check failed: ${error.message}`,
    suppressed: false,
    provider: "ses",
  };
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
  const messageIdDomain = envelopeAddress(from).split("@")[1] || "fstdesk.com";
  const messageId = `<${crypto.randomUUID()}@${messageIdDomain}>`;
  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${messageId}`,
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

function envelopeAddress(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/<([^<>@\s]+@[^<>\s]+)>/);
  return (match?.[1] || trimmed).replace(/^mailto:/i, "").trim();
}

function dotStuff(message: string): string {
  const normalized = message.replace(/\r?\n/g, "\r\n").replace(/\r\n?$/g, "");
  return normalized
    .split("\r\n")
    .map((line) => line.startsWith(".") ? `.${line}` : line)
    .join("\r\n");
}

function smtpEndpoint(region: string, port: number): { host: string; port: number } {
  const cleanRegion = region.trim() || DEFAULT_SES_REGION;
  return { host: `email-smtp.${cleanRegion}.amazonaws.com`, port };
}

function smtpPort(value: unknown): number {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : DEFAULT_SES_SMTP_PORT;
}

function smtpConfiguredMessage(): string {
  return "AWS SES SMTP credentials are not configured. Add the SES SMTP username as AWS_SES_SMTP_USERNAME and the SES SMTP password as AWS_SES_SMTP_PASSWORD.";
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

class SmtpSession {
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private writer: WritableStreamDefaultWriter<Uint8Array>;
  private decoder = new TextDecoder();
  private encoder = new TextEncoder();
  private buffer = "";

  constructor(
    private socket: Socket,
    private readonly host: string,
  ) {
    this.reader = socket.readable.getReader();
    this.writer = socket.writable.getWriter();
  }

  async close() {
    try {
      this.reader.releaseLock();
    } catch {
      // already released
    }
    try {
      this.writer.releaseLock();
    } catch {
      // already released
    }
    await this.socket.close().catch(() => undefined);
  }

  private async readLine(): Promise<string> {
    for (;;) {
      const index = this.buffer.indexOf("\n");
      if (index !== -1) {
        const line = this.buffer.slice(0, index + 1);
        this.buffer = this.buffer.slice(index + 1);
        return line.replace(/\r?\n$/, "");
      }

      const chunk = await withTimeout(this.reader.read(), 15000, "SMTP read timed out");
      if (chunk.done) throw new Error("SMTP connection closed unexpectedly");
      this.buffer += this.decoder.decode(chunk.value, { stream: true });
    }
  }

  async readResponse(expect?: number | number[]): Promise<SmtpResponse> {
    const expected = Array.isArray(expect) ? expect : expect ? [expect] : undefined;
    const lines: string[] = [];
    let code = 0;

    for (;;) {
      const line = await this.readLine();
      lines.push(line);
      const parsed = Number(line.slice(0, 3));
      if (Number.isInteger(parsed)) code = parsed;
      if (!/^\d{3}-/.test(line)) break;
    }

    const response = { code, lines, text: lines.join("\n") };
    if (expected && !expected.includes(code)) {
      throw new Error(`SMTP expected ${expected.join("/")} but got ${code}: ${response.text}`);
    }
    return response;
  }

  async sendLine(line: string) {
    await withTimeout(this.writer.write(this.encoder.encode(`${line}\r\n`)), 15000, "SMTP write timed out");
  }

  async sendData(message: string) {
    await withTimeout(this.writer.write(this.encoder.encode(`${dotStuff(message)}\r\n.\r\n`)), 15000, "SMTP DATA write timed out");
  }

  async startTls(): Promise<SmtpSession> {
    this.reader.releaseLock();
    this.writer.releaseLock();
    const secureSocket = this.socket.startTls({ expectedServerHostname: this.host });
    return new SmtpSession(secureSocket, this.host);
  }
}

export async function sendEmail(
  env: Bindings,
  opts: EmailSendOptions,
): Promise<EmailSendResult> {
  const provider = normalizeProvider(opts.provider);
  if (provider === "ses") return sendSesEmail(env, opts);
  return sendCloudflareEmail(env, opts);
}

async function sendCloudflareEmail(env: Bindings, opts: EmailSendOptions): Promise<EmailSendResult> {
  const mailer = env.SEND_EMAIL as any;
  if (!mailer) return { ok: false, code: "E_EMAIL_BINDING_MISSING", message: "Email binding is not configured" };

  const from = opts.from ?? DEFAULT_CLOUDFLARE_FROM;
  const raw = buildMime({ from, to: opts.to, subject: opts.subject, text: opts.text, html: opts.html, headers: opts.headers });

  try {
    const { EmailMessage } = await (import("cloudflare:email") as any);
    const msg = new EmailMessage(from, opts.to, raw);
    await mailer.send(msg);
    return { ok: true, provider: "cloudflare" };
  } catch (error: any) {
    const code = typeof error?.code === "string" ? error.code : "E_EMAIL_SEND_FAILED";
    const message = typeof error?.message === "string" ? error.message : "Email send failed";
    return { ok: false, code, message, suppressed: code === "E_RECIPIENT_SUPPRESSED", provider: "cloudflare" };
  }
}

function sesErrorSuppressed(code: string, message: string): boolean {
  return /suppression|suppressed|complaint|bounce|blacklist|message rejected/i.test(`${code} ${message}`);
}

async function sendSesEmail(env: Bindings, opts: EmailSendOptions): Promise<EmailSendResult> {
  const transport = normalizeSesTransport(opts.sesTransport);
  return transport === "api" ? sendSesApiEmail(env, opts) : sendSesSmtpEmail(env, opts);
}

async function sendSesApiEmail(env: Bindings, opts: EmailSendOptions): Promise<EmailSendResult> {
  if (!sesApiCredentials(env, true)) {
    return { ok: false, code: "E_AWS_SES_API_CONFIG_MISSING", message: "AWS SES API credentials are not configured", provider: "ses" };
  }
  const region = (opts.sesRegion || DEFAULT_SES_REGION).trim() || DEFAULT_SES_REGION;
  const suppressionResult = await checkSesSuppression(env, opts.to, region).catch((error) => ({
    ok: false,
    code: "E_AWS_SES_SUPPRESSION_CHECK_FAILED",
    message: error instanceof Error ? error.message : "AWS SES suppression check failed",
    provider: "ses" as const,
  }));
  if (suppressionResult) return suppressionResult;

  const replyTo = opts.headers?.["Reply-To"] || opts.headers?.["reply-to"];
  const customHeaders = Object.entries(opts.headers ?? {})
    .filter(([name]) => name.toLowerCase() !== "reply-to")
    .map(([Name, Value]) => ({ Name, Value: sanitizeHeaderValue(Value) }))
    .filter((header) => header.Name && header.Value);
  const simple: Record<string, unknown> = {
    Subject: { Data: opts.subject, Charset: "UTF-8" },
    Body: {
      Text: { Data: opts.text, Charset: "UTF-8" },
      Html: { Data: opts.html, Charset: "UTF-8" },
    },
  };
  if (customHeaders.length) simple.Headers = customHeaders;

  const payload = JSON.stringify({
    FromEmailAddress: opts.from || DEFAULT_SES_FROM,
    Destination: { ToAddresses: [opts.to] },
    ...(replyTo ? { ReplyToAddresses: [sanitizeHeaderValue(replyTo)] } : {}),
    Content: { Simple: simple },
  });

  try {
    const result = await awsSesFetch(env, { region, method: "POST", path: "/v2/email/outbound-emails", body: payload });
    if (result.ok) {
      return { ok: true, provider: "ses", messageId: String(result.body.MessageId ?? "") || undefined };
    }
    const { code, message } = awsErrorMessage(result.body, result.bodyText, `SES_${result.status}`);
    return { ok: false, code, message: message.slice(0, 700), suppressed: sesErrorSuppressed(code, message), provider: "ses" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "AWS SES send failed";
    return { ok: false, code: "E_AWS_SES_SEND_FAILED", message, provider: "ses" };
  }
}

function smtpAuthLine(value: string): string {
  return btoa(value);
}

async function smtpCommand(session: SmtpSession, line: string, expect: number | number[]): Promise<SmtpResponse> {
  await session.sendLine(line);
  return session.readResponse(expect);
}

async function sendSesSmtpEmail(env: Bindings, opts: EmailSendOptions): Promise<EmailSendResult> {
  const credentials = sesSmtpCredentials(env);
  if (!credentials) {
    return { ok: false, code: "E_AWS_SES_SMTP_CONFIG_MISSING", message: smtpConfiguredMessage(), provider: "ses" };
  }

  const region = (opts.sesRegion || DEFAULT_SES_REGION).trim() || DEFAULT_SES_REGION;
  const port = smtpPort(opts.sesPort ?? env.AWS_SES_SMTP_PORT);
  const endpoint = {
    host: env.AWS_SES_SMTP_HOST?.trim() || smtpEndpoint(region, port).host,
    port,
  };
  const from = opts.from || DEFAULT_SES_FROM;
  const fromAddress = envelopeAddress(from);
  const toAddress = envelopeAddress(opts.to);
  const raw = buildMime({ from, to: opts.to, subject: opts.subject, text: opts.text, html: opts.html, headers: opts.headers });
  let session: SmtpSession | null = null;

  try {
    const socket = connect(
      { hostname: endpoint.host, port: endpoint.port },
      { secureTransport: endpoint.port === 465 ? "on" : "starttls", allowHalfOpen: false },
    );
    session = new SmtpSession(socket, endpoint.host);
    await session.readResponse(220);
    await smtpCommand(session, "EHLO fstdesk.com", 250);

    if (endpoint.port !== 465) {
      await smtpCommand(session, "STARTTLS", 220);
      session = await session.startTls();
      await smtpCommand(session, "EHLO fstdesk.com", 250);
    }

    await smtpCommand(session, "AUTH LOGIN", 334);
    await smtpCommand(session, smtpAuthLine(credentials.username), 334);
    await smtpCommand(session, smtpAuthLine(credentials.password), 235);
    await smtpCommand(session, `MAIL FROM:<${fromAddress}>`, 250);
    await smtpCommand(session, `RCPT TO:<${toAddress}>`, [250, 251]);
    await smtpCommand(session, "DATA", 354);
    await session.sendData(raw);
    const accepted = await session.readResponse(250);
    await smtpCommand(session, "QUIT", 221).catch(() => undefined);
    const messageId = accepted.text.match(/\b([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+)\b/)?.[1];
    return { ok: true, provider: "ses", messageId };
  } catch (error) {
    const message = error instanceof Error ? error.message : "AWS SES SMTP send failed";
    return {
      ok: false,
      code: "E_AWS_SES_SMTP_SEND_FAILED",
      message: message.slice(0, 700),
      suppressed: sesErrorSuppressed("E_AWS_SES_SMTP_SEND_FAILED", message),
      provider: "ses",
    };
  } finally {
    await session?.close();
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
): Promise<{ ok: boolean; skipped?: boolean; error?: string; code?: "auth_error" | "api_error" }> {
  const accountId = env.CF_ACCOUNT_ID;
  const token = env.CF_EMAIL_API_TOKEN;
  if (!accountId || !token) return { ok: false, skipped: true };

  const targets = env.CF_ZONE_ID
    ? [
      `https://api.cloudflare.com/client/v4/zones/${env.CF_ZONE_ID}/email/sending/suppression`,
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/email/sending/suppression`,
    ]
    : [`https://api.cloudflare.com/client/v4/accounts/${accountId}/email/sending/suppression`];

  let lastError = "";
  let authError = false;
  for (const url of targets) {
    const res = await fetch(url, {
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
    lastError = body.slice(0, 500);
    authError = /authentication error|not authorized|permission/i.test(body);
    if (!authError) break;
  }
  return { ok: false, error: lastError, code: authError ? "auth_error" : "api_error" };
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
  const suffix = "email/sending/suppression?per_page=1000&order=created_at&direction=desc";
  const targets = env.CF_ZONE_ID
    ? [
      `https://api.cloudflare.com/client/v4/zones/${env.CF_ZONE_ID}/${suffix}`,
      `https://api.cloudflare.com/client/v4/accounts/${auth.accountId}/${suffix}`,
    ]
    : [`https://api.cloudflare.com/client/v4/accounts/${auth.accountId}/${suffix}`];
  let lastError: unknown;
  for (const url of targets) {
    try {
      const body = await cfJson<{ result?: CloudflareSuppression[] }>(url, auth.token);
      return body.result ?? [];
    } catch (error) {
      lastError = error;
      if (!/authentication error|not authorized|permission/i.test(error instanceof Error ? error.message : String(error))) throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Cloudflare suppression list sync failed");
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
