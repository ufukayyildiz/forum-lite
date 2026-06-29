import type { QueryClient } from "@tanstack/react-query";

type BootstrapQuery = {
  key: unknown[];
  data: unknown;
  updatedAt?: number;
};

type BootstrapPayload = {
  queries?: BootstrapQuery[];
};

const bootstrappedQueries = new Map<string, { data: unknown; updatedAt: number }>();
const BOOTSTRAP_STALE_MS = 5 * 60_000;
const BOOTSTRAP_API_SHORT_CIRCUIT_MS = 15_000;
let bootstrapPrimedAt = 0;

declare global {
  interface Window {
    __FSTDESK_BOOTSTRAP__?: BootstrapPayload;
    __FSTDESK_BOOTSTRAP_DEBUG__?: {
      events: Array<Record<string, unknown>>;
    };
  }
}

function queryKeyId(key: unknown[]) {
  return JSON.stringify(key);
}

function isBootstrapPayload(value: unknown): value is BootstrapPayload {
  return Boolean(value && typeof value === "object" && Array.isArray((value as BootstrapPayload).queries));
}

function debugBootstrap(event: string, data: Record<string, unknown> = {}) {
  if (typeof window === "undefined" || !window.location.search.includes("debugBootstrap=1")) return;
  window.__FSTDESK_BOOTSTRAP_DEBUG__ ??= { events: [] };
  window.__FSTDESK_BOOTSTRAP_DEBUG__.events.push({ event, at: Math.round(performance.now()), ...data });
}

export function getBootstrappedQueryData<T = unknown>(key: unknown[]): T | undefined {
  ensureBootstrappedQueriesPrimed();
  return bootstrappedQueries.get(queryKeyId(key))?.data as T | undefined;
}

export function getBootstrappedQueryUpdatedAt(key: unknown[]): number | undefined {
  ensureBootstrappedQueriesPrimed();
  return bootstrappedQueries.get(queryKeyId(key))?.updatedAt;
}

export function hasBootstrappedQueryData(key: unknown[]): boolean {
  ensureBootstrappedQueriesPrimed();
  return bootstrappedQueries.has(queryKeyId(key));
}

export function readFreshBootstrappedQueryData<T = unknown>(
  key: unknown[],
  maxAgeMs = BOOTSTRAP_API_SHORT_CIRCUIT_MS,
): { hit: true; data: T } | { hit: false } {
  ensureBootstrappedQueriesPrimed();
  if (!bootstrapPrimedAt || Date.now() - bootstrapPrimedAt > maxAgeMs) {
    debugBootstrap("readFresh:miss-age", { key, primed: Boolean(bootstrapPrimedAt), size: bootstrappedQueries.size });
    return { hit: false };
  }
  const value = bootstrappedQueries.get(queryKeyId(key));
  debugBootstrap(value ? "readFresh:hit" : "readFresh:miss-key", { key, size: bootstrappedQueries.size });
  return value ? { hit: true, data: value.data as T } : { hit: false };
}

export function bootstrapQueryOptions<T = unknown>(
  key: unknown[],
  options: { enabled?: boolean; staleTime?: number } = {},
) {
  const bootstrapped = hasBootstrappedQueryData(key);
  const enabled = (options.enabled ?? true) && !bootstrapped;
  debugBootstrap("queryOptions", { key, bootstrapped, enabled, size: bootstrappedQueries.size });
  return {
    initialData: () => getBootstrappedQueryData<T>(key),
    initialDataUpdatedAt: () => getBootstrappedQueryUpdatedAt(key),
    enabled,
    staleTime: bootstrapped ? (options.staleTime ?? BOOTSTRAP_STALE_MS) : options.staleTime,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  };
}

function readBootstrapPayload(): BootstrapPayload | null {
  if (typeof window === "undefined") return null;
  const windowPayload = window.__FSTDESK_BOOTSTRAP__ as unknown;
  if (isBootstrapPayload(windowPayload)) {
    debugBootstrap("readPayload:window", { count: windowPayload.queries?.length ?? 0 });
    return windowPayload;
  }

  const el = document.getElementById("__FSTDESK_BOOTSTRAP__");
  const text = el?.textContent?.trim();
  if (!text) {
    debugBootstrap("readPayload:empty");
    return null;
  }

  try {
    const payload = JSON.parse(text) as BootstrapPayload;
    debugBootstrap("readPayload:dom", { count: payload.queries?.length ?? 0, textLength: text.length });
    return payload;
  } catch {
    debugBootstrap("readPayload:parse-failed", { textLength: text.length });
    return null;
  }
}

function primeBootstrappedQueries(payload: BootstrapPayload, queryClient?: QueryClient) {
  if (!payload.queries?.length) return false;

  const now = Date.now();
  if (!bootstrapPrimedAt) bootstrapPrimedAt = now;
  const keys: unknown[] = [];

  for (const query of payload.queries) {
    if (!Array.isArray(query.key)) continue;
    try {
      const updatedAt = query.updatedAt ?? now;
      keys.push(query.key);
      bootstrappedQueries.set(queryKeyId(query.key), { data: query.data, updatedAt });
      queryClient?.setQueryData(query.key, query.data, { updatedAt });
    } catch (error) {
      console.warn("FSTDESK bootstrap query skipped", query.key, error);
    }
  }

  debugBootstrap("prime", { count: bootstrappedQueries.size, keys });
  return true;
}

function ensureBootstrappedQueriesPrimed() {
  if (bootstrapPrimedAt || typeof window === "undefined") return;

  try {
    const payload = readBootstrapPayload();
    if (payload) primeBootstrappedQueries(payload);
  } catch {
    // API short-circuiting is an optimization. If the bootstrap cannot be read,
    // normal network fetching remains the fallback.
  }
}

export function primeQueryClientFromBootstrap(queryClient: QueryClient) {
  let payload: BootstrapPayload | null = null;
  try {
    payload = readBootstrapPayload();
  } catch (error) {
    console.warn("FSTDESK bootstrap read failed", error);
  }
  if (!payload?.queries?.length) {
    debugBootstrap("prime:empty");
    document.getElementById("__FSTDESK_BOOTSTRAP__")?.remove();
    delete window.__FSTDESK_BOOTSTRAP__;
    return;
  }

  primeBootstrappedQueries(payload, queryClient);

  document.getElementById("__FSTDESK_BOOTSTRAP__")?.remove();
  delete window.__FSTDESK_BOOTSTRAP__;
}
