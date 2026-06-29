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

declare global {
  interface Window {
    __FSTDESK_BOOTSTRAP__?: BootstrapPayload;
  }
}

function queryKeyId(key: unknown[]) {
  return JSON.stringify(key);
}

export function getBootstrappedQueryData<T = unknown>(key: unknown[]): T | undefined {
  return bootstrappedQueries.get(queryKeyId(key))?.data as T | undefined;
}

export function getBootstrappedQueryUpdatedAt(key: unknown[]): number | undefined {
  return bootstrappedQueries.get(queryKeyId(key))?.updatedAt;
}

export function hasBootstrappedQueryData(key: unknown[]): boolean {
  return bootstrappedQueries.has(queryKeyId(key));
}

export function bootstrapQueryOptions<T = unknown>(key: unknown[]) {
  return {
    initialData: () => getBootstrappedQueryData<T>(key),
    initialDataUpdatedAt: () => getBootstrappedQueryUpdatedAt(key),
  };
}

function readBootstrapPayload(): BootstrapPayload | null {
  if (typeof window === "undefined") return null;
  if (window.__FSTDESK_BOOTSTRAP__) return window.__FSTDESK_BOOTSTRAP__;

  const el = document.getElementById("__FSTDESK_BOOTSTRAP__");
  const text = el?.textContent?.trim();
  if (!text) return null;

  try {
    return JSON.parse(text) as BootstrapPayload;
  } catch {
    return null;
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
    document.getElementById("__FSTDESK_BOOTSTRAP__")?.remove();
    delete window.__FSTDESK_BOOTSTRAP__;
    return;
  }

  const now = Date.now();
  for (const query of payload.queries) {
    if (!Array.isArray(query.key)) continue;
    try {
      const updatedAt = query.updatedAt ?? now;
      bootstrappedQueries.set(queryKeyId(query.key), { data: query.data, updatedAt });
      queryClient.setQueryData(query.key, query.data, { updatedAt });
    } catch (error) {
      console.warn("FSTDESK bootstrap query skipped", query.key, error);
    }
  }

  document.getElementById("__FSTDESK_BOOTSTRAP__")?.remove();
  delete window.__FSTDESK_BOOTSTRAP__;
}
