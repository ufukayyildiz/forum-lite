import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useMe } from "../lib/useAuth";

function sendDuration(id: number, durationMs: number) {
  const body = JSON.stringify({ id, durationMs });
  const blob = new Blob([body], { type: "application/json" });
  if (navigator.sendBeacon?.("/api/analytics/duration", blob)) return;
  fetch("/api/analytics/duration", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {});
}

export function AnalyticsTracker() {
  const location = useLocation();
  const { data: me, isLoading: meLoading } = useMe();

  useEffect(() => {
    if (meLoading) return;
    if (location.pathname.startsWith("/admin") || me?.role === "admin") return;

    const path = `${location.pathname}${location.search}`;
    const start = performance.now();
    let viewId = 0;
    let sent = false;
    let closedBeforeViewResponse = false;

    const closeView = () => {
      if (sent) return;
      sent = true;
      const durationMs = Math.max(0, Math.round(performance.now() - start));
      if (viewId) sendDuration(viewId, durationMs);
      else closedBeforeViewResponse = true;
    };

    fetch("/api/analytics/view", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, referrer: document.referrer || "" }),
      keepalive: true,
    })
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        viewId = Number((data as { id?: number } | null)?.id ?? 0);
        if (closedBeforeViewResponse && viewId) {
          const durationMs = Math.max(0, Math.round(performance.now() - start));
          sendDuration(viewId, durationMs);
        }
      })
      .catch(() => {});

    const onVisibility = () => {
      if (document.visibilityState === "hidden") closeView();
    };
    window.addEventListener("pagehide", closeView);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      closeView();
      window.removeEventListener("pagehide", closeView);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [location.pathname, location.search, me?.role, meLoading]);

  return null;
}
