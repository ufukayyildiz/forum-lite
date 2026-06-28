import type { Bindings } from "../types";
import type { DB } from "../db";
import { sendEmail } from "./email";
import { isEmailSuppressed, recordEmailSuppression } from "./email-suppression";
import { loadEmailSettings } from "./notifications";

type WaitUntilContext = {
  waitUntil?: (promise: Promise<unknown>) => void;
};

type OptionalEnv = Bindings & {
  ADMIN_EMAIL?: string;
  SITE_URL?: string;
};

const DEFAULT_ADMIN_EMAIL = "ufuk@devfox.net";
const DEFAULT_SITE_URL = "https://fstdesk.com";

function adminEmail(env: Bindings): string {
  return String((env as OptionalEnv).ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL).trim();
}

function siteUrl(env: Bindings): string {
  return String((env as OptionalEnv).SITE_URL || DEFAULT_SITE_URL)
    .trim()
    .replace(/\/+$/, "");
}

function clean(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function clip(value: unknown, max = 700): string {
  const text = clean(value);
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function pageUrl(env: Bindings, path: string): string {
  return `${siteUrl(env)}${path.startsWith("/") ? path : `/${path}`}`;
}

function row(label: string, value: unknown): string {
  return `<tr><td style="padding:6px 12px;color:#928374;white-space:nowrap">${escapeHtml(label)}</td><td style="padding:6px 12px;color:#ebdbb2;word-break:break-word">${escapeHtml(value)}</td></tr>`;
}

function queueAdminEmail(
  db: DB,
  env: Bindings,
  ctx: WaitUntilContext | undefined,
  requestUrl: string,
  subject: string,
  title: string,
  rows: Array<[string, unknown]>,
  actionUrl?: string,
) {
  const to = adminEmail(env);
  if (!to) return;

  const htmlRows = rows.map(([label, value]) => row(label, value)).join("");
  const action = actionUrl
    ? `<p style="margin:18px 0 0"><a href="${escapeHtml(actionUrl)}" style="background:#b8ff1a;color:#1d2021;text-decoration:none;padding:10px 14px;font-weight:bold;display:inline-block">Open</a></p>`
    : "";
  const html = `<!doctype html><html><body style="margin:0;background:#282828;color:#ebdbb2;font-family:monospace;padding:24px"><div style="max-width:720px;margin:0 auto;border:1px solid #504945;background:#32302f;padding:20px"><div style="color:#fabd2f;font-weight:bold;margin-bottom:12px">FSTDESK</div><h2 style="color:#fabd2f;margin:0 0 14px;font-size:20px">${escapeHtml(title)}</h2><table style="width:100%;border-collapse:collapse;border-top:1px solid #504945;border-bottom:1px solid #504945">${htmlRows}</table>${action}</div></body></html>`;
  const text = [
    `FSTDESK - ${title}`,
    "",
    ...rows.map(([label, value]) => `${label}: ${clip(value, 1000)}`),
    actionUrl ? `Open: ${actionUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const task = Promise.all([loadEmailSettings(db, requestUrl), isEmailSuppressed(db, to)])
    .then(([settings, suppressed]) => {
      if (suppressed) {
        console.warn("admin_alert_email_suppressed", to);
        return { ok: false, code: "LOCAL_SUPPRESSION", message: "Admin alert recipient is locally suppressed" };
      }
      return sendEmail(env, {
        to,
        from: settings.from,
        provider: settings.provider,
        sesRegion: settings.sesRegion,
        sesTransport: settings.sesTransport,
        sesPort: settings.sesPort,
        subject: clip(subject, 140),
        text,
        html,
      });
    })
    .then(async (result) => {
      if (!result.ok) console.error("admin_alert_email_failed", result.code, result.message);
      if (result.suppressed) {
        await recordEmailSuppression(db, env, to, {
          reason: "recipient_suppressed",
          source: "admin_alert",
          details: result.code,
        });
      }
    })
    .catch((error) => console.error("admin_alert_email_error", error));

  if (ctx?.waitUntil) ctx.waitUntil(task);
  else void task;
}

export function notifyAdminLogin(
  db: DB,
  env: Bindings,
  ctx: WaitUntilContext | undefined,
  requestUrl: string,
  data: {
    username: string;
    displayName?: string | null;
    email?: string | null;
    ip?: string;
    country?: string;
    userAgent?: string;
  },
) {
  queueAdminEmail(
    db,
    env,
    ctx,
    requestUrl,
    `FSTDESK login: ${data.username}`,
    "User login",
    [
      ["username", data.username],
      ["display name", data.displayName || ""],
      ["email", data.email || ""],
      ["ip", data.ip || ""],
      ["country", data.country || ""],
      ["user agent", data.userAgent || ""],
    ],
    pageUrl(env, `/u/${encodeURIComponent(data.username)}`),
  );
}

export function notifyAdminNewThread(
  db: DB,
  env: Bindings,
  ctx: WaitUntilContext | undefined,
  requestUrl: string,
  data: {
    publicId: string;
    title: string;
    content: string;
    categoryId: number;
    username: string;
    displayName?: string | null;
    email?: string | null;
  },
) {
  queueAdminEmail(
    db,
    env,
    ctx,
    requestUrl,
    `FSTDESK new thread: ${data.title}`,
    "New thread",
    [
      ["title", data.title],
      ["author", data.displayName ? `${data.displayName} (@${data.username})` : data.username],
      ["email", data.email || ""],
      ["category id", data.categoryId],
      ["excerpt", clip(data.content, 900)],
    ],
    pageUrl(env, `/t/${encodeURIComponent(data.publicId)}`),
  );
}

export function notifyAdminNewPost(
  db: DB,
  env: Bindings,
  ctx: WaitUntilContext | undefined,
  requestUrl: string,
  data: {
    postId: number;
    threadPublicId: string;
    threadTitle: string;
    content: string;
    username: string;
    displayName?: string | null;
    email?: string | null;
  },
) {
  queueAdminEmail(
    db,
    env,
    ctx,
    requestUrl,
    `FSTDESK new reply: ${data.threadTitle}`,
    "New reply",
    [
      ["thread", data.threadTitle],
      ["author", data.displayName ? `${data.displayName} (@${data.username})` : data.username],
      ["email", data.email || ""],
      ["post id", data.postId],
      ["excerpt", clip(data.content, 900)],
    ],
    pageUrl(env, `/t/${encodeURIComponent(data.threadPublicId)}`),
  );
}
