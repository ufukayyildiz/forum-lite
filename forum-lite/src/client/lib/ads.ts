import type { AdsConfig } from "./api";

export type AdIntervalKind = "post" | "topic" | "user" | "tag";
type AdDevice = "desktop" | "mobile";

const DEFAULT_INTERVALS: Record<AdIntervalKind, number> = {
  post: 3,
  topic: 7,
  user: 7,
  tag: 7,
};

function clampInterval(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Math.max(1, Math.min(50, Number.isFinite(parsed) ? parsed : fallback));
}

export function currentAdDevice(): AdDevice {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "desktop";
  return window.matchMedia("(max-width: 767px)").matches ? "mobile" : "desktop";
}

export function activeAdSettings(config: AdsConfig | undefined) {
  if (!config) return undefined;
  return currentAdDevice() === "mobile" ? config.mobile : config.desktop;
}

export function activeAdHtml(config: AdsConfig | undefined) {
  const active = activeAdSettings(config);
  return (active?.html || config?.html || "").trim();
}

export function activeAdInterval(config: AdsConfig | undefined, kind: AdIntervalKind) {
  const active = activeAdSettings(config);
  const fallback = kind === "post" ? config?.postInterval ?? DEFAULT_INTERVALS.post : DEFAULT_INTERVALS[kind];
  const value = active?.intervals?.[kind];
  return clampInterval(value, fallback);
}
