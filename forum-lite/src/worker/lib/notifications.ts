import { eq } from "drizzle-orm";
import { schema, type DB } from "../db";
import type { User } from "../db/schema";
import type { Bindings } from "../types";
import { generateToken } from "./auth";
import { DEFAULT_CLOUDFLARE_FROM, DEFAULT_SES_FROM, DEFAULT_SES_REGION, DEFAULT_SES_SMTP_PORT, DEFAULT_SES_TRANSPORT, sendEmail, type EmailProvider, type SesTransport } from "./email";
import { isEmailSuppressed, recordEmailSuppression } from "./email-suppression";

export const DEFAULT_EMAIL_TEST_TO = "ufuk@devfox.net";

type NotificationKind = "reply" | "like" | "marketing" | "account" | "email_verify";

type ManagedEmailInput = {
  db: DB;
  env: Bindings;
  user: Pick<User, "id" | "email" | "username" | "displayName" | "banned" | "emailSuppressedAt">;
  kind: NotificationKind;
  subject: string;
  text: string;
  html: string;
  siteUrl: string;
  from?: string;
  provider?: EmailProvider;
  sesRegion?: string;
  sesTransport?: SesTransport;
  sesPort?: number;
  relatedType?: string;
  relatedId?: number;
  campaignKey?: string;
  ignorePreferences?: boolean;
  waitUntil?: (promise: Promise<unknown>) => void;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stripText(value: string, max = 220): string {
  const text = value
    .replace(/<[^>]*>/g, " ")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/[`*_>#|~=]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trim()}…` : text;
}

function absoluteUrl(siteUrl: string, path: string): string {
  return new URL(path, siteUrl).toString();
}

function token(): string {
  return generateToken().slice(0, 48);
}

function isTrackableHref(href: string): boolean {
  const value = href.trim();
  if (!value || value.startsWith("#")) return false;
  return !/^(mailto:|tel:|sms:|data:|javascript:)/i.test(value);
}

function trackingUrl(siteUrl: string, trackingToken: string, href: string): string {
  const target = new URL(href, siteUrl).toString();
  const url = new URL(`/email/click/${encodeURIComponent(trackingToken)}`, siteUrl);
  url.searchParams.set("u", target);
  return url.toString();
}

function addEmailTracking(html: string, siteUrl: string, trackingToken: string): string {
  const withTrackedLinks = html.replace(/\bhref=(["'])(.*?)\1/gi, (match, quote: string, href: string) => {
    if (!isTrackableHref(href)) return match;
    return `href=${quote}${escapeHtml(trackingUrl(siteUrl, trackingToken, href))}${quote}`;
  });
  const pixelUrl = absoluteUrl(siteUrl, `/email/open/${encodeURIComponent(trackingToken)}.gif`);
  const pixel = `<img src="${escapeHtml(pixelUrl)}" width="1" height="1" alt="" style="display:none;width:1px;height:1px;opacity:0;overflow:hidden" />`;
  return `${withTrackedLinks}${pixel}`;
}

async function logEmailEvent(
  db: DB,
  input: {
    userId?: number | null;
    email: string;
    kind: string;
    subject: string;
    status: string;
    relatedType?: string;
    relatedId?: number;
    campaignKey?: string;
    trackingToken?: string;
    message?: string;
    errorCode?: string;
  },
): Promise<number | null> {
  const [row] = await db
    .insert(schema.emailEvents)
    .values({
      userId: input.userId ?? null,
      email: input.email,
      kind: input.kind,
      subject: input.subject,
      status: input.status,
      relatedType: input.relatedType ?? null,
      relatedId: input.relatedId ?? null,
      campaignKey: input.campaignKey ?? null,
      trackingToken: input.trackingToken ?? null,
      message: input.message?.slice(0, 1000) ?? null,
      errorCode: input.errorCode ?? null,
      createdAt: new Date(),
    })
    .returning({ id: schema.emailEvents.id });
  return row?.id ?? null;
}

async function updateEmailEvent(
  db: DB,
  eventId: number | null,
  update: { status: string; message?: string; errorCode?: string },
) {
  if (!eventId) return;
  await db
    .update(schema.emailEvents)
    .set({
      status: update.status,
      message: update.message?.slice(0, 1000) ?? null,
      errorCode: update.errorCode ?? null,
    })
    .where(eq(schema.emailEvents.id, eventId));
}

export async function ensureNotificationPreferences(db: DB, userId: number) {
  const existing = await db.query.notificationPreferences.findFirst({
    where: eq(schema.notificationPreferences.userId, userId),
  });
  if (existing) return existing;

  const now = new Date();
  const [created] = await db
    .insert(schema.notificationPreferences)
    .values({
      userId,
      unsubscribeToken: token(),
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return created;
}

export async function unsubscribeByToken(
  db: DB,
  unsubscribeToken: string,
  type: string,
): Promise<{ ok: boolean; username?: string; email?: string; disabled: string }> {
  const pref = await db.query.notificationPreferences.findFirst({
    where: eq(schema.notificationPreferences.unsubscribeToken, unsubscribeToken),
  });
  if (!pref) return { ok: false, disabled: "none" };

  const now = new Date();
  const update: Record<string, unknown> = { updatedAt: now };
  const disabled = type === "reply" || type === "like" || type === "marketing" ? type : "all";
  if (disabled === "reply") update.replyEmail = false;
  else if (disabled === "like") update.likeEmail = false;
  else if (disabled === "marketing") update.marketingEmail = false;
  else update.allEmail = false;

  await db.update(schema.notificationPreferences).set(update).where(eq(schema.notificationPreferences.userId, pref.userId));
  const user = await db.query.users.findFirst({
    where: eq(schema.users.id, pref.userId),
    columns: { username: true, email: true },
  });
  return { ok: true, username: user?.username, email: user?.email, disabled };
}

function preferenceAllows(pref: typeof schema.notificationPreferences.$inferSelect, kind: NotificationKind): boolean {
  if (!pref.allEmail) return false;
  if (kind === "reply") return pref.replyEmail;
  if (kind === "like") return pref.likeEmail;
  if (kind === "marketing") return pref.marketingEmail;
  return true;
}

export async function sendManagedEmail(input: ManagedEmailInput): Promise<{ status: string; eventId: number | null }> {
  const email = input.user.email.trim().toLowerCase();
  if (!email) return { status: "skipped", eventId: null };

  if (input.user.banned) {
    const eventId = await logEmailEvent(input.db, { ...input, userId: input.user.id, email, status: "skipped", message: "User is banned" });
    return { status: "skipped", eventId };
  }

  if (input.user.emailSuppressedAt) {
    const eventId = await logEmailEvent(input.db, { ...input, userId: input.user.id, email, status: "suppressed", message: "User email is suppressed" });
    return { status: "suppressed", eventId };
  }

  const pref = await ensureNotificationPreferences(input.db, input.user.id);
  if (!input.ignorePreferences && !preferenceAllows(pref, input.kind)) {
    const eventId = await logEmailEvent(input.db, { ...input, userId: input.user.id, email, status: "skipped", message: "User unsubscribed" });
    return { status: "skipped", eventId };
  }

  if (await isEmailSuppressed(input.db, email)) {
    const eventId = await logEmailEvent(input.db, { ...input, userId: input.user.id, email, status: "suppressed", message: "Local suppression list" });
    return { status: "suppressed", eventId };
  }

  const unsubscribeUrl = absoluteUrl(input.siteUrl, `/unsubscribe/${encodeURIComponent(pref.unsubscribeToken)}?type=${input.kind}`);
  const trackingToken = token();
  const eventId = await logEmailEvent(input.db, {
    ...input,
    userId: input.user.id,
    email,
    status: "pending",
    trackingToken,
  });
  const htmlWithFooter = `${input.html}<p style="margin-top:22px;color:#928374;font-size:12px">Email preferences: <a href="${escapeHtml(unsubscribeUrl)}" style="color:#95c7c0">unsubscribe</a></p>`;
  const trackedHtml = addEmailTracking(htmlWithFooter, input.siteUrl, trackingToken);
  const sent = await sendEmail(input.env, {
    to: email,
    from: input.from,
    provider: input.provider,
    sesRegion: input.sesRegion,
    sesTransport: input.sesTransport,
    sesPort: input.sesPort,
    subject: input.subject,
    text: `${input.text}\n\nUnsubscribe: ${unsubscribeUrl}`,
    html: trackedHtml,
    headers: {
      "List-Unsubscribe": `<${unsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      "X-FSTDESK-Mail-Type": input.kind,
    },
  });

  if (sent.ok) {
    await updateEmailEvent(input.db, eventId, { status: "sent" });
    return { status: "sent", eventId };
  }

  if (sent.suppressed) {
    await recordEmailSuppression(input.db, input.env, email, {
      reason: "recipient_suppressed",
      source: `${input.kind}_send`,
      details: sent.code,
      waitUntil: input.waitUntil,
    });
  }

  const status = sent.suppressed ? "suppressed" : "error";
  await updateEmailEvent(input.db, eventId, {
    status,
    message: sent.message,
    errorCode: sent.code,
  });
  return { status, eventId };
}

function emailShell(title: string, body: string): string {
  return `<!doctype html><html><body style="margin:0;background:#282828;color:#ebdbb2;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace">
<div style="max-width:640px;margin:0 auto;padding:28px 20px">
  <div style="color:#fabd2f;font-weight:700;font-size:15px;margin-bottom:20px">FSTDESK</div>
  <div style="border:1px solid #504945;background:#3c3836;padding:22px">
    <h1 style="font-size:21px;line-height:1.35;color:#fabd2f;margin:0 0 16px">${escapeHtml(title)}</h1>
    ${body}
  </div>
  <p style="color:#928374;font-size:12px;margin-top:18px">Food science, food safety and product development discussions.</p>
</div>
</body></html>`;
}

function button(label: string, url: string): string {
  return `<p style="margin:20px 0 4px"><a href="${escapeHtml(url)}" style="display:inline-block;background:#b8ff1a;color:#282828;text-decoration:none;font-weight:700;padding:10px 14px;border:1px solid #d4ff70">${escapeHtml(label)}</a></p>`;
}

export function replyNotificationEmail(input: {
  recipientName: string;
  actorName: string;
  threadTitle: string;
  threadUrl: string;
  excerpt: string;
}) {
  const excerpt = stripText(input.excerpt);
  const subject = `New reply: ${input.threadTitle}`;
  const text = `Hi ${input.recipientName},\n\n${input.actorName} replied to your thread:\n${input.threadTitle}\n\n${excerpt}\n\nOpen thread: ${input.threadUrl}`;
  const html = emailShell(
    "New reply on your thread",
    `<p style="margin:0 0 12px">Hi <strong>${escapeHtml(input.recipientName)}</strong>,</p>
<p><strong>${escapeHtml(input.actorName)}</strong> replied to:</p>
<p style="color:#8ec07c;font-weight:700">${escapeHtml(input.threadTitle)}</p>
<blockquote style="border-left:3px solid #665c54;margin:16px 0;padding:8px 0 8px 14px;color:#d5c4a1">${escapeHtml(excerpt)}</blockquote>
${button("Open thread", input.threadUrl)}`,
  );
  return { subject, text, html };
}

export function likeNotificationEmail(input: {
  recipientName: string;
  actorName: string;
  threadTitle: string;
  threadUrl: string;
}) {
  const subject = `Your post got a like: ${input.threadTitle}`;
  const text = `Hi ${input.recipientName},\n\n${input.actorName} liked your post in:\n${input.threadTitle}\n\nOpen thread: ${input.threadUrl}`;
  const html = emailShell(
    "Your post got a like",
    `<p style="margin:0 0 12px">Hi <strong>${escapeHtml(input.recipientName)}</strong>,</p>
<p><strong>${escapeHtml(input.actorName)}</strong> liked your post in:</p>
<p style="color:#8ec07c;font-weight:700">${escapeHtml(input.threadTitle)}</p>
${button("Open thread", input.threadUrl)}`,
  );
  return { subject, text, html };
}

export function weAreBackEmail(input: { recipientName: string; siteUrl: string }) {
  const subject = "FSTDESK Forum is back";
  const loginUrl = absoluteUrl(input.siteUrl, "/login");
  const text = `Hi ${input.recipientName},\n\nFSTDESK Forum is back online. The old food science discussions, questions, tags and community profiles are available again with a faster, cleaner interface.\n\nFor security, old passwords were reset during the relaunch. Please use the email address you registered with and request a new password from the reset-password form. Your new password will be sent directly to your email.\n\nReset your password / sign in: ${loginUrl}\n\nCome back and continue the conversation: ${input.siteUrl}\n\nFSTDESK`;
  const html = emailShell(
    "FSTDESK Forum is back",
    `<p>Hi <strong>${escapeHtml(input.recipientName)}</strong>,</p>
<p>FSTDESK is back online with a faster, cleaner forum for food science, food safety, product development and ingredient discussions.</p>
<p>The old conversations, member profiles and technical threads are available again. We would love to see you back in the community.</p>
<div style="margin:18px 0;padding:14px 16px;border:1px solid #504945;background:#32302f">
  <p style="margin:0 0 8px;color:#fabd2f;font-weight:700">Passwords were reset for the relaunch</p>
  <p style="margin:0">Please use the email address you registered with and request a new password from the reset-password form. Your new password will be sent directly to your email.</p>
</div>
${button("Reset password / sign in", loginUrl)}
${button("Visit FSTDESK", input.siteUrl)}
<p style="color:#928374;font-size:12px">You are receiving this because you registered for FSTDESK Forum.</p>`,
  );
  return { subject, text, html };
}

export function emailVerificationProbeEmail(input: { recipientName: string; siteUrl: string }) {
  const subject = "FSTDESK Forum email check";
  const loginUrl = absoluteUrl(input.siteUrl, "/login");
  const text = `Hi ${input.recipientName},\n\nThis is a short FSTDESK Forum email check. We are confirming that your forum email address can receive account messages such as password resets and reply notifications.\n\nOpen FSTDESK: ${loginUrl}\n\nFSTDESK`;
  const html = emailShell(
    "FSTDESK Forum email check",
    `<p>Hi <strong>${escapeHtml(input.recipientName)}</strong>,</p>
<p>This short message confirms that your forum email address can receive account messages such as password resets and reply notifications.</p>
${button("Open FSTDESK", loginUrl)}
<p style="color:#928374;font-size:12px">No action is required.</p>`,
  );
  return { subject, text, html };
}

export type EmailSettings = {
  siteUrl: string;
  provider: EmailProvider;
  from: string;
  cloudflareFrom: string;
  sesFrom: string;
  sesRegion: string;
  sesTransport: SesTransport;
  sesPort: number;
  testTo: string;
};

export async function loadEmailSettings(db: DB, requestUrl: string): Promise<EmailSettings> {
  const rows = await db.select().from(schema.settings);
  const settings: Record<string, string> = {};
  for (const row of rows) settings[row.key] = row.value;
  const provider: EmailProvider = settings.email_provider === "ses" ? "ses" : "cloudflare";
  const sesTransport: SesTransport = settings.email_ses_transport === "api" ? "api" : DEFAULT_SES_TRANSPORT;
  const parsedSesPort = Number(settings.email_ses_port || DEFAULT_SES_SMTP_PORT);
  const cloudflareFrom = settings.email_from?.trim() || DEFAULT_CLOUDFLARE_FROM;
  const sesFrom = settings.email_ses_from?.trim() || DEFAULT_SES_FROM;
  return {
    siteUrl: settings.site_url?.trim() || new URL(requestUrl).origin,
    provider,
    from: provider === "ses" ? sesFrom : cloudflareFrom,
    cloudflareFrom,
    sesFrom,
    sesRegion: settings.email_ses_region?.trim() || DEFAULT_SES_REGION,
    sesTransport,
    sesPort: Number.isInteger(parsedSesPort) && parsedSesPort > 0 && parsedSesPort < 65536 ? parsedSesPort : DEFAULT_SES_SMTP_PORT,
    testTo: settings.email_test_to?.trim() || DEFAULT_EMAIL_TEST_TO,
  };
}
