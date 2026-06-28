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
const sentKeys = new Map<string, number>();

function ignoredClientError(message: string, stack?: string | null, reason?: string | null) {
  const text = `${message}\n${stack ?? ""}\n${reason ?? ""}`;
  return [
    /ResizeObserver loop completed with undelivered notifications/i,
    /ResizeObserver loop limit exceeded/i,
    /AbortError: The operation was aborted/i,
    /adsbygoogle\.push\(\) error: All 'ins' elements .* already have ads in them/i,
    /Object Not Found Matching Id:\d+,\s*MethodName:[a-zA-Z0-9_]+,\s*ParamCount:\d+/i,
  ].some((pattern) => pattern.test(text));
}

function metadataNumber(metadata: Record<string, unknown> | undefined, key: string) {
  const value = metadata?.[key];
  return typeof value === "number" ? value : null;
}

function metadataString(metadata: Record<string, unknown> | undefined, key: string) {
  const value = metadata?.[key];
  return typeof value === "string" ? value : null;
}

function isLikelyBotRuntime() {
  if (typeof navigator === "undefined") return false;
  return /bot|crawler|spider|slurp|google-inspectiontool|lighthouse|pagespeed|baiduspider/i.test(navigator.userAgent);
}

function shouldReportClientError(input: ClientErrorPayload) {
  if (ignoredClientError(input.message, input.stack, input.reason)) return false;

  if (input.kind === "api_network_error" && /failed to fetch|load failed|network request failed/i.test(input.message)) {
    return false;
  }

  const status = metadataNumber(input.metadata, "status");
  const path = metadataString(input.metadata, "path");
  if (input.kind === "api_error_response" && path === "/auth/me" && status !== null && status >= 500 && isLikelyBotRuntime()) {
    return false;
  }
  if (input.kind === "api_error_response" && status === 599) return false;
  if (input.kind === "api_error_response" && status && status < 500 && status !== 429) {
    return false;
  }

  const key = [
    input.kind,
    input.message.slice(0, 120),
    input.metadata?.path,
    input.metadata?.status,
  ].join("|");
  const now = Date.now();
  const lastSentAt = sentKeys.get(key) ?? 0;
  if (now - lastSentAt < 60_000) return false;
  sentKeys.set(key, now);
  return true;
}

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
  if (!shouldReportClientError(input)) return;
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
    if (ignoredClientError(event.message || "", event.error instanceof Error ? event.error.stack ?? null : null)) {
      event.preventDefault();
      return;
    }
    reportClientError({
      kind: "window_error",
      message: event.message || "Window error",
      stack: event.error instanceof Error ? event.error.stack ?? null : null,
      metadata: { filename: event.filename, lineno: event.lineno, colno: event.colno },
    });
  });
  window.addEventListener("unhandledrejection", (event) => {
    const normalized = normalizeReason(event.reason);
    if (ignoredClientError(normalized.message, normalized.stack, normalized.reason)) {
      event.preventDefault();
      return;
    }
    reportClientError({
      kind: "unhandled_rejection",
      message: normalized.message,
      stack: normalized.stack,
      reason: normalized.reason,
    });
  });
}
