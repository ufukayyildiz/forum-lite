import type { Bindings } from "../types";

const DEFAULT_FROM = "noreply@devfox.net";

function buildMime({
  from,
  to,
  subject,
  text,
  html,
}: {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
}): string {
  const boundary = "=_" + Math.random().toString(36).slice(2, 18);
  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
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
  },
): Promise<boolean> {
  const mailer = env.SEND_EMAIL as any;
  if (!mailer) return false;

  const from = opts.from ?? DEFAULT_FROM;
  const raw = buildMime({ from, to: opts.to, subject: opts.subject, text: opts.text, html: opts.html });

  try {
    const { EmailMessage } = await (import("cloudflare:email") as any);
    const msg = new EmailMessage(from, opts.to, raw);
    await mailer.send(msg);
    return true;
  } catch {
    // Email sending is best-effort; never crash the request
    return false;
  }
}

export function welcomeEmail(username: string, siteUrl: string) {
  const subject = `Welcome to the forum, ${username}!`;
  const text = `Hi ${username},\n\nYour account has been created successfully.\n\nVisit the forum: ${siteUrl}\n\nHappy posting!`;
  const html = `<!DOCTYPE html><html><body style="font-family:monospace;background:#282828;color:#ebdbb2;padding:24px">
<h2 style="color:#fabd2f">Welcome, ${username}!</h2>
<p>Your account has been created successfully.</p>
<p><a href="${siteUrl}" style="color:#83a598">Visit the forum &rarr;</a></p>
<p style="color:#928374;font-size:12px">Happy posting!</p>
</body></html>`;
  return { subject, text, html };
}

export function newPasswordEmail(username: string, password: string, siteUrl: string) {
  const subject = "Yeni forum sifreniz";
  const text = `Merhaba ${username},\n\nForum hesabiniz icin yeni sifreniz:\n\n${password}\n\nGiris: ${siteUrl}/login\n\nBu islemi siz baslatmadiysaniz lutfen giris yaptiktan sonra sifrenizi tekrar degistirin.`;
  const html = `<!DOCTYPE html><html><body style="font-family:monospace;background:#282828;color:#ebdbb2;padding:24px">
<h2 style="color:#fabd2f">Yeni sifreniz</h2>
<p>Merhaba <strong>${username}</strong>, forum hesabiniz icin yeni sifreniz:</p>
<p style="font-size:22px;letter-spacing:2px;color:#8ec07c;background:#3c3836;border:1px solid #504945;padding:10px 14px;display:inline-block">${password}</p>
<p><a href="${siteUrl}/login" style="color:#83a598">Giris yap &rarr;</a></p>
<p style="color:#928374;font-size:12px">Bu islemi siz baslatmadiysaniz giris yaptiktan sonra sifrenizi tekrar degistirin.</p>
</body></html>`;
  return { subject, text, html };
}
