import type { QueryClient } from "@tanstack/react-query";

type BootstrapQuery = {
  key: unknown[];
  data: unknown;
  updatedAt?: number;
};

type BootstrapPayload = {
  queries?: BootstrapQuery[];
};

declare global {
  interface Window {
    __FSTDESK_BOOTSTRAP__?: BootstrapPayload;
  }
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
  const payload = readBootstrapPayload();
  if (!payload?.queries?.length) return;

  const now = Date.now();
  for (const query of payload.queries) {
    if (!Array.isArray(query.key)) continue;
    queryClient.setQueryData(query.key, query.data, { updatedAt: query.updatedAt ?? now });
  }

  document.getElementById("__FSTDESK_BOOTSTRAP__")?.remove();
  delete window.__FSTDESK_BOOTSTRAP__;
}
