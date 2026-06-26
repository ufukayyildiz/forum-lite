#!/usr/bin/env node
import { createServer } from "node:http";
import { promises as dns } from "node:dns";
import { randomUUID } from "node:crypto";
import net from "node:net";

const PORT = Number(process.env.PORT || 8789);
const VERIFY_SECRET = process.env.EMAIL_VERIFY_SECRET || "";
const DEFAULT_HELO = process.env.EMAIL_VERIFY_HELO || "fstdesk.com";
const DEFAULT_MAIL_FROM = process.env.EMAIL_VERIFY_FROM || "verify@fstdesk.com";
const CONNECT_TIMEOUT_MS = Number(process.env.SMTP_VERIFY_CONNECT_TIMEOUT_MS || 8000);
const COMMAND_TIMEOUT_MS = Number(process.env.SMTP_VERIFY_COMMAND_TIMEOUT_MS || 8000);

createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    return json(res, 200, { ok: true });
  }
  if (req.method !== "POST" || req.url !== "/verify") {
    return json(res, 404, { error: "not found" });
  }

  if (VERIFY_SECRET) {
    const auth = req.headers.authorization || "";
    if (auth !== `Bearer ${VERIFY_SECRET}`) {
      return json(res, 401, { error: "unauthorized" });
    }
  }

  try {
    const body = await readJson(req);
    const email = String(body.email || "").trim().toLowerCase();
    const mailFrom = String(body.mailFrom || DEFAULT_MAIL_FROM).trim();
    const helo = String(body.helo || DEFAULT_HELO).trim();
    const result = await verifyEmail(email, { mailFrom, helo });
    return json(res, 200, result);
  } catch (error) {
    return json(res, 400, {
      provider: "self_hosted_smtp",
      status: "unknown",
      reason: error instanceof Error ? error.message : "verification failed",
      error: error instanceof Error ? error.message : "verification failed",
    });
  }
}).listen(PORT, () => {
  console.log(`email verifier listening on :${PORT}`);
});

async function verifyEmail(email, options) {
  const parsed = parseEmail(email);
  if (!parsed.validSyntax) {
    return result(email, "undeliverable", "Invalid email syntax.", { checks: ["syntax failed"] });
  }

  const mxRecords = await resolveMx(parsed.domain);
  if (!mxRecords.length) {
    return result(email, "undeliverable", "Domain has no MX record.", { checks: ["mx failed"] });
  }

  const checks = ["syntax ok", "mx ok"];
  let lastError = "";
  for (const mx of mxRecords.slice(0, 3)) {
    try {
      const rcpt = await smtpRcpt(mx.exchange, email, options);
      checks.push(`rcpt ${rcpt.code}`);
      if (rcpt.code >= 200 && rcpt.code < 300) {
        const randomLocal = `fstdesk-${randomUUID().replaceAll("-", "")}`;
        const catchAllProbe = `${randomLocal}@${parsed.domain}`;
        const catchAll = await smtpRcpt(mx.exchange, catchAllProbe, options).catch(() => null);
        const acceptsRandom = Boolean(catchAll && catchAll.code >= 200 && catchAll.code < 300);
        return result(email, acceptsRandom ? "risky" : "deliverable", acceptsRandom
          ? "MX accepted the real mailbox and a random mailbox; domain appears accept-all."
          : "MX accepted RCPT TO for this mailbox. No DATA was sent.", {
          mxHost: mx.exchange,
          smtpCode: rcpt.code,
          smtpMessage: rcpt.message,
          catchAll: acceptsRandom,
          mailboxExists: true,
          checks: acceptsRandom ? [...checks, "catch-all yes"] : [...checks, "catch-all no"],
        });
      }
      if (rcpt.code >= 500) {
        return result(email, "undeliverable", "MX rejected RCPT TO for this mailbox.", {
          mxHost: mx.exchange,
          smtpCode: rcpt.code,
          smtpMessage: rcpt.message,
          mailboxExists: false,
          checks,
        });
      }
      return result(email, "temporary", "MX returned a temporary SMTP response.", {
        mxHost: mx.exchange,
        smtpCode: rcpt.code,
        smtpMessage: rcpt.message,
        mailboxExists: null,
        checks,
      });
    } catch (error) {
      lastError = error instanceof Error ? error.message : "SMTP check failed";
      checks.push(`mx ${mx.exchange} failed`);
    }
  }

  return result(email, "unknown", "SMTP handshake could not determine mailbox status.", {
    error: lastError,
    checks,
  });
}

function parseEmail(input) {
  const raw = String(input || "").trim().replace(/^mailto:/i, "");
  const match = /^([^@\s]+)@([^@\s]+)$/.exec(raw);
  const local = match?.[1]?.toLowerCase() || "";
  const domain = match?.[2]?.toLowerCase().replace(/\.+$/, "") || "";
  const labels = domain.split(".");
  const validSyntax = Boolean(
    local &&
    local.length <= 64 &&
    raw.length <= 254 &&
    domain.includes(".") &&
    !local.startsWith(".") &&
    !local.endsWith(".") &&
    !local.includes("..") &&
    labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)),
  );
  return { email: `${local}@${domain}`, local, domain, validSyntax };
}

async function resolveMx(domain) {
  try {
    const rows = await dns.resolveMx(domain);
    return rows
      .filter((row) => row.exchange)
      .sort((a, b) => a.priority - b.priority);
  } catch {
    return [];
  }
}

async function smtpRcpt(host, rcptTo, options) {
  const socket = net.createConnection({ host, port: 25 });
  socket.setEncoding("utf8");
  socket.setTimeout(COMMAND_TIMEOUT_MS);
  const reader = createSmtpReader(socket);

  try {
    await waitForConnect(socket);
    const greeting = await reader.readResponse();
    if (greeting.code >= 400) throw new Error(`SMTP greeting ${greeting.code}: ${greeting.message}`);

    await send(socket, reader, `EHLO ${options.helo}`);
    const mail = await send(socket, reader, `MAIL FROM:<${options.mailFrom}>`);
    if (mail.code >= 400) throw new Error(`MAIL FROM ${mail.code}: ${mail.message}`);
    const rcpt = await send(socket, reader, `RCPT TO:<${rcptTo}>`);
    socket.write("QUIT\r\n");
    return rcpt;
  } finally {
    socket.destroy();
  }
}

function waitForConnect(socket) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("SMTP connect timeout"));
    }, CONNECT_TIMEOUT_MS);
    socket.once("connect", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    socket.once("timeout", () => {
      clearTimeout(timer);
      socket.destroy();
      reject(new Error("SMTP socket timeout"));
    });
  });
}

async function send(socket, reader, command) {
  socket.write(`${command}\r\n`);
  return reader.readResponse();
}

function createSmtpReader(socket) {
  let buffer = "";
  const waiters = [];
  socket.on("data", (chunk) => {
    buffer += chunk;
    drain();
  });
  socket.on("error", (error) => {
    while (waiters.length) waiters.shift().reject(error);
  });

  function drain() {
    while (waiters.length) {
      const parsed = parseResponse(buffer);
      if (!parsed) return;
      buffer = buffer.slice(parsed.end);
      waiters.shift().resolve(parsed.response);
    }
  }

  return {
    readResponse() {
      const parsed = parseResponse(buffer);
      if (parsed) {
        buffer = buffer.slice(parsed.end);
        return Promise.resolve(parsed.response);
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("SMTP response timeout")), COMMAND_TIMEOUT_MS);
        waiters.push({
          resolve: (value) => {
            clearTimeout(timer);
            resolve(value);
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          },
        });
      });
    },
  };
}

function parseResponse(buffer) {
  const lines = buffer.split(/\r?\n/);
  let consumed = 0;
  const responseLines = [];
  for (const line of lines) {
    if (!line) break;
    consumed += line.length + (buffer[consumed + line.length] === "\r" ? 2 : 1);
    responseLines.push(line);
    if (/^\d{3}\s/.test(line)) {
      const code = Number(line.slice(0, 3));
      return { response: { code, message: responseLines.join(" | ") }, end: consumed };
    }
  }
  return null;
}

function result(email, status, reason, extra = {}) {
  return {
    provider: "self_hosted_smtp",
    status,
    email,
    reason,
    mxHost: extra.mxHost ?? null,
    smtpCode: extra.smtpCode ?? null,
    smtpMessage: extra.smtpMessage ?? null,
    catchAll: Boolean(extra.catchAll),
    mailboxExists: extra.mailboxExists ?? null,
    checks: extra.checks ?? [],
    error: extra.error ?? null,
  };
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}
