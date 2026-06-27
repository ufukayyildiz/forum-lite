type ErrorEventInput = {
  source: "worker" | "api" | "client" | "react";
  level?: "error" | "warn" | "info";
  kind: string;
  message: string;
  stack?: string | null;
  status?: number | null;
  method?: string | null;
  path?: string | null;
  url?: string | null;
  userId?: number | null;
  username?: string | null;
  ip?: string | null;
  country?: string | null;
  colo?: string | null;
  userAgent?: string | null;
  referrer?: string | null;
  requestId?: string | null;
  metadata?: unknown;
};

let errorEventsSchemaReady = false;
let errorEventsSchemaPromise: Promise<boolean> | null = null;

function clip(value: unknown, max = 2000): string | null {
  if (value == null) return null;
  const text = String(value);
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function redactUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, "https://fstdesk.com");
    for (const key of url.searchParams.keys()) {
      if (/token|password|pass|secret|key|auth|code|session/i.test(key)) url.searchParams.set(key, "[redacted]");
    }
    return url.pathname + url.search + url.hash;
  } catch {
    return clip(value.replace(/([?&][^=]*(token|password|pass|secret|key|auth|code|session)[^=]*=)[^&]+/gi, "$1[redacted]"), 1000);
  }
}

function safeJson(value: unknown): string | null {
  if (value == null) return null;
  try {
    return clip(JSON.stringify(value, (_key, item) => {
      if (typeof item === "string" && /bearer\s+|session=|password|secret|token/i.test(item)) return "[redacted]";
      return item;
    }), 4000);
  } catch {
    return clip(String(value), 4000);
  }
}

async function createOrRepairErrorEventsSchema(db: D1Database): Promise<boolean> {
  try {
    await db.prepare(
      `CREATE TABLE IF NOT EXISTS error_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        request_id TEXT,
        source TEXT NOT NULL,
        level TEXT NOT NULL DEFAULT 'error',
        kind TEXT NOT NULL,
        message TEXT NOT NULL,
        stack TEXT,
        status INTEGER,
        method TEXT,
        path TEXT,
        url TEXT,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        username TEXT,
        ip TEXT,
        country TEXT,
        colo TEXT,
        user_agent TEXT,
        referrer TEXT,
        metadata TEXT,
        created_at INTEGER NOT NULL
      )`,
    ).run();
    await db.prepare("CREATE INDEX IF NOT EXISTS error_events_created_at_idx ON error_events(created_at)").run();
    await db.prepare("CREATE INDEX IF NOT EXISTS error_events_level_idx ON error_events(level)").run();
    await db.prepare("CREATE INDEX IF NOT EXISTS error_events_source_idx ON error_events(source)").run();
    await db.prepare("CREATE INDEX IF NOT EXISTS error_events_path_idx ON error_events(path)").run();
    await db.prepare("CREATE INDEX IF NOT EXISTS error_events_status_idx ON error_events(status)").run();
    return true;
  } catch (error) {
    console.error("error_events_schema_unavailable", error);
    return false;
  }
}

export async function ensureErrorEventsSchema(db: D1Database): Promise<boolean> {
  if (errorEventsSchemaReady) return true;
  if (!errorEventsSchemaPromise) errorEventsSchemaPromise = createOrRepairErrorEventsSchema(db);
  const ready = await errorEventsSchemaPromise;
  errorEventsSchemaPromise = null;
  errorEventsSchemaReady = ready;
  return ready;
}

export function errorToRecord(error: unknown) {
  if (error instanceof Error) {
    return {
      message: clip(error.message, 2000) || "Error",
      stack: clip(error.stack, 6000),
      name: error.name,
    };
  }
  return {
    message: clip(error, 2000) || "Unknown error",
    stack: null,
    name: typeof error,
  };
}

export async function recordErrorEvent(db: D1Database, input: ErrorEventInput): Promise<void> {
  try {
    if (!(await ensureErrorEventsSchema(db))) return;
    await db.prepare(
      `INSERT INTO error_events (
        request_id, source, level, kind, message, stack, status, method, path, url,
        user_id, username, ip, country, colo, user_agent, referrer, metadata, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      clip(input.requestId, 120),
      input.source,
      input.level ?? "error",
      clip(input.kind, 120) ?? "unknown",
      clip(input.message, 2000) ?? "Unknown error",
      clip(input.stack, 6000),
      input.status ?? null,
      clip(input.method, 20),
      clip(input.path, 1000),
      redactUrl(input.url),
      input.userId ?? null,
      clip(input.username, 120),
      clip(input.ip, 80),
      clip(input.country, 12),
      clip(input.colo, 12),
      clip(input.userAgent, 500),
      redactUrl(input.referrer),
      safeJson(input.metadata),
      Math.floor(Date.now() / 1000),
    ).run();
  } catch (error) {
    console.error("error_event_record_failed", error);
  }
}

export function requestErrorMeta(c: any) {
  const url = new URL(c.req.url);
  const cf = c.req.raw.cf as Record<string, unknown> | undefined;
  const user = c.get?.("user");
  return {
    method: c.req.method,
    path: url.pathname,
    url: c.req.url,
    userId: user?.id ?? null,
    username: user?.username ?? null,
    ip: c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for") ?? null,
    country: c.req.header("cf-ipcountry") ?? (typeof cf?.country === "string" ? cf.country : null),
    colo: typeof cf?.colo === "string" ? cf.colo : null,
    userAgent: c.req.header("user-agent") ?? null,
    referrer: c.req.header("referer") ?? null,
    requestId: c.req.header("cf-ray") ?? c.req.header("x-request-id") ?? null,
  };
}
