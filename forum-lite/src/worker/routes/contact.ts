import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { schema } from "../db";
import { sendEmail } from "../lib/email";
import { loadEmailSettings } from "../lib/notifications";
import type { AppEnv } from "../types";

const app = new Hono<AppEnv>();

const DEFAULT_CONTACT_TO = "ufuk@devfox.net";

const contactSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(160),
  subject: z.string().trim().min(3).max(140),
  message: z.string().trim().min(10).max(5000),
  website: z.string().max(200).optional(),
});

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeHeader(value: string): string {
  return value.replace(/[\r\n]+/g, " ").replace(/[^\x20-\x7e]/g, "").trim();
}

async function loadContactSettings(db: AppEnv["Variables"]["db"], requestUrl: string) {
  const rows = await db.select().from(schema.settings);
  const settings: Record<string, string> = {};
  for (const row of rows) settings[row.key] = row.value;
  const emailSettings = await loadEmailSettings(db, requestUrl);
  return {
    to: settings.forum_contact_email?.trim() || DEFAULT_CONTACT_TO,
    from: emailSettings.from,
    provider: emailSettings.provider,
    sesRegion: emailSettings.sesRegion,
    siteUrl: emailSettings.siteUrl,
  };
}

app.post("/", zValidator("json", contactSchema), async (c) => {
  const body = c.req.valid("json");
  if (body.website?.trim()) {
    return c.json({ ok: true, message: "Message received" });
  }

  const db = c.get("db");
  const user = c.get("user");
  const settings = await loadContactSettings(db, c.req.url);
  const subject = `FSTDESK contact: ${safeHeader(body.subject).slice(0, 110)}`;
  const ip = c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for") ?? "-";
  const userAgent = c.req.header("user-agent") ?? "-";
  const text = [
    "New FSTDESK contact message",
    "",
    `Name: ${body.name}`,
    `Email: ${body.email}`,
    user ? `User: ${user.username} (#${user.id})` : "User: guest",
    `IP: ${ip}`,
    `User-Agent: ${userAgent}`,
    "",
    `Subject: ${body.subject}`,
    "",
    body.message,
    "",
    `Contact page: ${settings.siteUrl}/contact`,
  ].join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#282828;color:#ebdbb2;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace">
<div style="max-width:720px;margin:0 auto;padding:28px 20px">
  <div style="color:#fabd2f;font-weight:700;font-size:15px;margin-bottom:20px">FSTDESK</div>
  <div style="border:1px solid #504945;background:#3c3836;padding:22px">
    <h1 style="font-size:21px;line-height:1.35;color:#fabd2f;margin:0 0 16px">New contact message</h1>
    <table style="width:100%;border-collapse:collapse;color:#ebdbb2;font-size:13px">
      <tr><td style="color:#928374;padding:4px 12px 4px 0">name</td><td>${escapeHtml(body.name)}</td></tr>
      <tr><td style="color:#928374;padding:4px 12px 4px 0">email</td><td>${escapeHtml(body.email)}</td></tr>
      <tr><td style="color:#928374;padding:4px 12px 4px 0">user</td><td>${user ? `${escapeHtml(user.username)} (#${user.id})` : "guest"}</td></tr>
      <tr><td style="color:#928374;padding:4px 12px 4px 0">ip</td><td>${escapeHtml(ip)}</td></tr>
    </table>
    <h2 style="font-size:16px;color:#fabd2f;margin:20px 0 10px">${escapeHtml(body.subject)}</h2>
    <pre style="white-space:pre-wrap;line-height:1.55;margin:0;color:#ebdbb2">${escapeHtml(body.message)}</pre>
  </div>
  <p style="color:#928374;font-size:12px;margin-top:18px">Reply-To is set to ${escapeHtml(body.email)}.</p>
</div>
</body></html>`;

  const sent = await sendEmail(c.env, {
    to: settings.to,
    from: settings.from,
    provider: settings.provider,
    sesRegion: settings.sesRegion,
    subject,
    text,
    html,
    headers: {
      "Reply-To": safeHeader(body.email),
      "X-FSTDESK-Mail-Type": "contact",
    },
  });

  await db.insert(schema.activityLog).values({
    userId: user?.id ?? null,
    type: "contact_message",
    summary: sent.ok
      ? `Contact message sent from ${body.email} to ${settings.to}`
      : `Contact message failed from ${body.email}: ${sent.code ?? "email_error"}`,
  });

  if (!sent.ok) {
    return c.json({ error: "Message could not be sent. Please try again later." }, 502);
  }

  return c.json({ ok: true, message: "Message sent" });
});

export default app;
