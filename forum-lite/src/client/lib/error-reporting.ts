type ClientErrorPayload = {
  source?: "client" | "react";
  kind: string;
  message: string;
  stack?: string | null;
  reason?: string | null;
  componentStack?: string | null;
  metadata?: Record<string, unknown>;
};

let installed = false;
let sent = 0;

function viewport() {
  return {
    width: window.innerWidth,
    height: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
  };
}

function normalizeReason(reason: unknown) {
  if (reason instanceof Error) return { message: reason.message, stack: reason.stack ?? null };
  return { message: typeof reason === "string" ? reason : "Unhandled rejection", stack: null, reason: String(reason) };
}

export function reportClientError(input: ClientErrorPayload) {
  if (sent >= 30) return;
  sent += 1;
  const payload = {
    source: input.source ?? "client",
    kind: input.kind,
    message: input.message.slice(0, 2000),
    stack: input.stack?.slice(0, 6000) ?? null,
    reason: input.reason?.slice(0, 1000) ?? null,
    componentStack: input.componentStack?.slice(0, 6000) ?? null,
    href: window.location.href,
    viewport: viewport(),
    metadata: input.metadata ?? {},
  };
  fetch("/api/client-errors", {
    method: "POST",
    credentials: "include",
    keepalive: true,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => undefined);
}

export function installClientErrorReporting() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (event) => {
    reportClientError({
      kind: "window_error",
      message: event.message || "Window error",
      stack: event.error instanceof Error ? event.error.stack ?? null : null,
      metadata: { filename: event.filename, lineno: event.lineno, colno: event.colno },
    });
  });
  window.addEventListener("unhandledrejection", (event) => {
    const normalized = normalizeReason(event.reason);
    reportClientError({
      kind: "unhandled_rejection",
      message: normalized.message,
      stack: normalized.stack,
      reason: normalized.reason,
    });
  });
}
