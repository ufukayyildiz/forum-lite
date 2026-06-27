import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import type { AdsConfig } from "../lib/api";
import { activeAdHtml } from "../lib/ads";

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

const FALLBACK_DELAY_MS = 3000;
const ADSENSE_STABLE_VISIBLE_MS = 1000;
const VIEWABLE_THRESHOLD = 1;
const VIEWPORT_TOLERANCE_PX = 1;
const DEFAULT_AD_HEIGHT = 160;

const HOUSE_ADS = [
  {
    title: "ManuFox ERP",
    copy: "Production, stock, purchasing and quality workflows for manufacturers.",
    cta: "Explore",
    tone: "lime",
    layout: "bar",
  },
  {
    title: "Run manufacturing cleaner",
    copy: "Plan orders, track batches and keep operations visible from one system.",
    cta: "See ManuFox",
    tone: "aqua",
    layout: "focus",
  },
  {
    title: "Built for growing factories",
    copy: "A practical ERP layer for teams that need fewer spreadsheets and faster decisions.",
    cta: "Learn more",
    tone: "yellow",
    layout: "split",
  },
] as const;

function randomHouseAdIndex(seed: number, reason: string) {
  if (globalThis.crypto?.getRandomValues) {
    const values = new Uint32Array(1);
    globalThis.crypto.getRandomValues(values);
    return values[0] % HOUSE_ADS.length;
  }
  return Math.abs((seed * 1103515245 + reason.length * 12345) % HOUSE_ADS.length);
}

function houseAdHtml(variant: number, reason: string) {
  const ad = HOUSE_ADS[variant % HOUSE_ADS.length];
  const url = new URL("https://manufox.com/about");
  url.searchParams.set("utm_source", "fstdesk");
  url.searchParams.set("utm_medium", "house_ad");
  url.searchParams.set("utm_campaign", "adsense_fallback");
  url.searchParams.set("utm_content", `${ad.tone}_${reason}`);

  return `
    <a class="gb-house-ad gb-house-ad-${ad.tone} gb-house-ad-${ad.layout}" href="${url.toString()}" target="_blank" rel="noopener sponsored">
      <span class="gb-house-ad-main">
        <span class="gb-house-ad-brand">MANUFOX</span>
        <strong>${ad.title}</strong>
        <span>${ad.copy}</span>
      </span>
      <span class="gb-house-ad-cta">${ad.cta}</span>
    </a>
  `;
}

export function AdSlot({
  config,
  index,
  height = DEFAULT_AD_HEIGHT,
}: {
  config?: AdsConfig;
  index: number;
  height?: number;
}) {
  const htmlRef = useRef<HTMLDivElement>(null);
  const houseVariantRef = useRef<number | null>(null);
  const html = activeAdHtml(config);
  const reservedHeight = Math.max(60, Math.min(DEFAULT_AD_HEIGHT, Math.round(Number(height) || DEFAULT_AD_HEIGHT)));

  useEffect(() => {
    const mount = htmlRef.current;
    if (!config?.enabled || !mount) return;

    const slot = mount.closest<HTMLElement>(".gb-ad-slot");
    if (slot && slot.getClientRects().length === 0) return;
    let fallbackApplied = false;
    let adRequested = false;
    let fallbackVisibleStartedAt = 0;
    let mutationObserver: MutationObserver | null = null;
    let viewObserver: IntersectionObserver | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let fallbackTimer: number | null = null;
    let adaptRaf: number | null = null;
    const timers: number[] = [];

    const setCss = (el: HTMLElement, prop: string, value: string, priority = "") => {
      if (el.style.getPropertyValue(prop) !== value || el.style.getPropertyPriority(prop) !== priority) {
        el.style.setProperty(prop, value, priority);
      }
    };

    const setSlotHeight = () => {
      slot?.style.setProperty("--gb-ad-height", `${reservedHeight}px`);
      slot?.style.setProperty("height", `${reservedHeight}px`, "important");
      slot?.style.setProperty("min-height", `${reservedHeight}px`, "important");
      slot?.style.setProperty("max-height", `${reservedHeight}px`, "important");
    };

    const slotFullyVisible = () => {
      if (!slot) return false;
      const rect = slot.getBoundingClientRect();
      const width = window.innerWidth || document.documentElement.clientWidth;
      const height = window.innerHeight || document.documentElement.clientHeight;
      if (rect.width <= 1 || rect.height <= 1) return false;
      return (
        rect.top >= -VIEWPORT_TOLERANCE_PX &&
        rect.left >= -VIEWPORT_TOLERANCE_PX &&
        rect.bottom <= height + VIEWPORT_TOLERANCE_PX &&
        rect.right <= width + VIEWPORT_TOLERANCE_PX
      );
    };

    const normalizeAdMarkup = () => {
      setCss(mount, "align-items", "center");
      setCss(mount, "display", "flex");
      setCss(mount, "height", `${reservedHeight}px`, "important");
      setCss(mount, "justify-content", "center");
      setCss(mount, "margin-left", "auto");
      setCss(mount, "margin-right", "auto");
      setCss(mount, "max-height", `${reservedHeight}px`, "important");
      setCss(mount, "max-width", "100%");
      setCss(mount, "overflow", "hidden", "important");
      setCss(mount, "text-align", "center");
      setCss(mount, "width", "100%");

      for (const el of Array.from(mount.querySelectorAll<HTMLElement>("ins.adsbygoogle, .adsbygoogle"))) {
        el.setAttribute("data-ad-format", "horizontal");
        el.setAttribute("data-full-width-responsive", "false");
        setCss(el, "display", "block", "important");
        setCss(el, "height", `${reservedHeight}px`, "important");
        setCss(el, "margin-left", "auto", "important");
        setCss(el, "margin-right", "auto", "important");
        setCss(el, "max-height", `${reservedHeight}px`, "important");
        setCss(el, "max-width", "100%", "important");
        setCss(el, "min-height", `${reservedHeight}px`, "important");
        setCss(el, "overflow", "hidden", "important");
        setCss(el, "width", "100%", "important");
      }

      for (const frame of Array.from(mount.querySelectorAll<HTMLIFrameElement>("iframe"))) {
        setCss(frame, "display", "block", "important");
        setCss(frame, "height", `${reservedHeight}px`, "important");
        setCss(frame, "margin-left", "auto", "important");
        setCss(frame, "margin-right", "auto", "important");
        setCss(frame, "max-height", `${reservedHeight}px`, "important");
        setCss(frame, "max-width", "100%", "important");
        setCss(frame, "overflow", "hidden", "important");
        frame.scrolling = "no";
      }
    };

    const adsenseState = () => {
      const adEls = Array.from(mount.querySelectorAll<HTMLElement>("ins.adsbygoogle, .adsbygoogle"));
      if (adEls.some((el) => el.getAttribute("data-ad-status") === "unfilled")) return "unfilled";
      if (adEls.some((el) => el.getAttribute("data-ad-status") === "filled")) return "filled";

      const frames = Array.from(mount.querySelectorAll<HTMLIFrameElement>("iframe"));
      const hasGoogleFrame = frames.some((frame) => {
        const rect = frame.getBoundingClientRect();
        return rect.width > 1 && rect.height > 1 && (frame.src || frame.id.startsWith("google_ads_iframe"));
      });
      return hasGoogleFrame ? "filled" : "pending";
    };
    const pendingAdsenseElements = () =>
      Array.from(mount.querySelectorAll<HTMLElement>("ins.adsbygoogle")).filter((el) => (
        el.dataset.gbAdsPushed !== "true" &&
        !el.getAttribute("data-adsbygoogle-status") &&
        !el.getAttribute("data-ad-status")
      ));

    const adaptToCreative = () => {
      normalizeAdMarkup();
      if (mount.querySelector("iframe")) {
        setSlotHeight();
        slot?.setAttribute("data-ad-state", "filled");
      }
    };
    const scheduleAdaptToCreative = () => {
      if (adaptRaf !== null) return;
      adaptRaf = window.requestAnimationFrame(() => {
        adaptRaf = null;
        adaptToCreative();
      });
    };

    const commitFallback = (reason: string) => {
      if (fallbackApplied || adsenseState() === "filled") return;
      fallbackApplied = true;
      mutationObserver?.disconnect();
      resizeObserver?.disconnect();
      slot?.setAttribute("data-ad-state", "house");
      mount.setAttribute("data-ad-fallback", reason);
      if (houseVariantRef.current === null) houseVariantRef.current = randomHouseAdIndex(index, reason);
      mount.innerHTML = houseAdHtml(houseVariantRef.current, reason);
      setSlotHeight();
      normalizeAdMarkup();
    };

    const scheduleFallback = (reason: string) => {
      if (fallbackApplied || adsenseState() === "filled" || !slotFullyVisible()) return;
      if (!fallbackVisibleStartedAt) fallbackVisibleStartedAt = Date.now();
      if (fallbackTimer !== null) return;
      const remainingMs = Math.max(FALLBACK_DELAY_MS - (Date.now() - fallbackVisibleStartedAt), 0);
      fallbackTimer = window.setTimeout(() => {
        fallbackTimer = null;
        if (!slotFullyVisible()) {
          fallbackVisibleStartedAt = 0;
          waitUntilFullyVisible(() => scheduleFallback(reason));
          return;
        }
        const state = adsenseState();
        if (state === "filled") {
          adaptToCreative();
        } else {
          commitFallback(state === "pending" ? reason : state);
        }
      }, remainingMs);
      timers.push(fallbackTimer);
    };

    const waitUntilFullyVisibleFor = (durationMs: number, onVisible: () => void, visibleSince = 0) => {
      if (!slotFullyVisible()) {
        timers.push(window.setTimeout(() => waitUntilFullyVisibleFor(durationMs, onVisible, 0), 250));
        return;
      }
      const since = visibleSince || Date.now();
      const elapsed = Date.now() - since;
      if (elapsed >= durationMs) {
        onVisible();
        return;
      }
      timers.push(window.setTimeout(
        () => waitUntilFullyVisibleFor(durationMs, onVisible, since),
        Math.min(250, durationMs - elapsed),
      ));
    };
    const waitUntilFullyVisible = (onVisible: () => void) => waitUntilFullyVisibleFor(0, onVisible);

    const requestAdsense = () => {
      if (adRequested || fallbackApplied || !slotFullyVisible()) return;
      adRequested = true;
      fallbackVisibleStartedAt = Date.now();
      slot?.setAttribute("data-ad-state", "loading");
      mount.setAttribute("data-ad-requested", "true");
      normalizeAdMarkup();

      const pendingAds = pendingAdsenseElements();
      if (pendingAds.length > 0) {
        window.adsbygoogle = window.adsbygoogle || [];
        requestAnimationFrame(() => {
          const stillPending = pendingAds.filter((el) => (
            el.isConnected &&
            el.dataset.gbAdsPushed !== "true" &&
            !el.getAttribute("data-adsbygoogle-status") &&
            !el.getAttribute("data-ad-status")
          ));
          if (!stillPending.length) {
            scheduleFallback("already-requested");
            return;
          }
          try {
            window.dispatchEvent(new Event("resize"));
            for (const el of stillPending) {
              el.dataset.gbAdsPushed = "true";
              window.adsbygoogle?.push({});
            }
          } catch {
            // Adsense can reject duplicate pushes for the same slot.
          }
        });
      } else if (adsenseState() === "filled") {
        adaptToCreative();
      } else {
        scheduleFallback("already-requested");
      }

      scheduleFallback("pending");
    };

    setSlotHeight();
    slot?.setAttribute("data-ad-state", "waiting");
    mount.removeAttribute("data-ad-fallback");
    mount.removeAttribute("data-ad-requested");

    if (!html) {
      waitUntilFullyVisible(() => scheduleFallback("missing-code"));
      return () => {
        for (const timer of timers) window.clearTimeout(timer);
        mount.innerHTML = "";
        slot?.removeAttribute("data-ad-state");
      };
    }

    mount.innerHTML = html;
    normalizeAdMarkup();

    mutationObserver = new MutationObserver(() => {
      adaptToCreative();
      if (adsenseState() === "unfilled") scheduleFallback("unfilled");
    });
    mutationObserver.observe(mount, { attributeFilter: ["data-ad-status"], attributes: true, childList: true, subtree: true });

    const scripts = Array.from(mount.querySelectorAll("script"));
    for (const script of scripts) {
      if (script.src) {
        const src = new URL(script.src, window.location.href).toString();
        const alreadyLoaded = Array.from(document.scripts).some((s) => s.src === src && s !== script);
        if (!alreadyLoaded) {
          const clone = document.createElement("script");
          for (const attr of Array.from(script.attributes)) clone.setAttribute(attr.name, attr.value);
          clone.async = script.async || true;
          clone.src = src;
          document.head.appendChild(clone);
        }
        script.remove();
      } else {
        const source = script.textContent ?? "";
        if (/adsbygoogle[\s\S]*\.push\s*\(/.test(source)) {
          script.remove();
          continue;
        }
        const clone = document.createElement("script");
        for (const attr of Array.from(script.attributes)) clone.setAttribute(attr.name, attr.value);
        clone.text = source;
        script.replaceWith(clone);
      }
    }

    if ("ResizeObserver" in window) {
      resizeObserver = new ResizeObserver(scheduleAdaptToCreative);
      resizeObserver.observe(mount);
    }

    for (const delay of [250, 1000, 2500, 5000]) {
      timers.push(window.setTimeout(adaptToCreative, delay));
    }

    if (!mount.querySelector(".adsbygoogle")) {
      waitUntilFullyVisible(() => scheduleFallback("missing-adsense"));
    } else if ("IntersectionObserver" in window && slot) {
      viewObserver = new IntersectionObserver(
        (entries) => {
          const entry = entries[0];
          if (entry?.isIntersecting && entry.intersectionRatio >= VIEWABLE_THRESHOLD && slotFullyVisible()) {
            viewObserver?.disconnect();
            waitUntilFullyVisibleFor(ADSENSE_STABLE_VISIBLE_MS, requestAdsense);
          }
        },
        { threshold: [VIEWABLE_THRESHOLD] },
      );
      viewObserver.observe(slot);
    } else {
      waitUntilFullyVisible(requestAdsense);
    }

    timers.push(window.setTimeout(() => {
      if (!adRequested && slotFullyVisible()) waitUntilFullyVisibleFor(ADSENSE_STABLE_VISIBLE_MS, requestAdsense);
    }, 1500));

    return () => {
      mutationObserver?.disconnect();
      viewObserver?.disconnect();
      resizeObserver?.disconnect();
      if (adaptRaf !== null) window.cancelAnimationFrame(adaptRaf);
      for (const timer of timers) window.clearTimeout(timer);
      mount.innerHTML = "";
      slot?.removeAttribute("data-ad-state");
      slot?.style.removeProperty("height");
      slot?.style.removeProperty("min-height");
      slot?.style.removeProperty("max-height");
    };
  }, [config?.enabled, html, index, reservedHeight]);

  if (!config?.enabled) return null;

  return (
    <div
      className="gb-ad-slot"
      data-ad-index={index}
      data-ad-compact={reservedHeight < DEFAULT_AD_HEIGHT ? "true" : undefined}
      style={{ "--gb-ad-height": `${reservedHeight}px` } as CSSProperties}
    >
      <div ref={htmlRef} className="gb-ad-frame" />
    </div>
  );
}
