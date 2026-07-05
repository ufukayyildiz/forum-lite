import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import type { AdsConfig } from "../lib/api";
import { activeAdHtml } from "../lib/ads";
import { useMe } from "../lib/useAuth";

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

const FALLBACK_DELAY_MS = 4000;
const ADSENSE_STABLE_VISIBLE_MS = 1000;
const VIEWABLE_THRESHOLD = 0.01;
const VIEWPORT_TOLERANCE_PX = 1;
const DEFAULT_AD_HEIGHT = 160;
const MAX_AD_HEIGHT = 600;
const HOUSE_AD_SIDEBAR_INDEX = 9000;
type AdSlotFormat = "horizontal" | "rectangle" | "vertical" | "auto";
type HouseAdBrand = "manufox" | "brix";
type HouseAdVariant = {
  brand: HouseAdBrand;
  brandLabel: string;
  title: string;
  copy: string;
  cta: string;
  tone: "lime" | "aqua" | "yellow" | "blue" | "orange" | "green";
  layout: "bar" | "focus" | "split";
  href: string;
};

const MANUFOX_HOUSE_ADS: HouseAdVariant[] = [
  {
    brand: "manufox",
    brandLabel: "MANUFOX",
    title: "ManuFox ERP",
    copy: "Production, stock, purchasing and quality workflows for manufacturers.",
    cta: "Explore",
    tone: "lime",
    layout: "bar",
    href: "https://manufox.com/about",
  },
  {
    brand: "manufox",
    brandLabel: "MANUFOX",
    title: "Run manufacturing cleaner",
    copy: "Plan orders, track batches and keep operations visible from one system.",
    cta: "See ManuFox",
    tone: "aqua",
    layout: "focus",
    href: "https://manufox.com/about",
  },
  {
    brand: "manufox",
    brandLabel: "MANUFOX",
    title: "Built for growing factories",
    copy: "A practical ERP layer for teams that need fewer spreadsheets and faster decisions.",
    cta: "Learn more",
    tone: "yellow",
    layout: "split",
    href: "https://manufox.com/about",
  },
];

const BRIX_HOUSE_ADS: HouseAdVariant[] = [
  {
    brand: "brix",
    brandLabel: "BRIX",
    title: "Food Engineering Services",
    copy: "Product development, process, shelf life, labeling and production consulting.",
    cta: "View services",
    tone: "orange",
    layout: "bar",
    href: "https://brix.tr/en/solutions",
  },
  {
    brand: "brix",
    brandLabel: "BRIX",
    title: "Build new food products",
    copy: "Formulation, recipe development and market-ready technical support.",
    cta: "Start project",
    tone: "blue",
    layout: "focus",
    href: "https://brix.tr/en/solutions/new-product-development",
  },
  {
    brand: "brix",
    brandLabel: "BRIX",
    title: "Process development help",
    copy: "Optimize production processes, scale recipes and improve efficiency.",
    cta: "Improve process",
    tone: "green",
    layout: "split",
    href: "https://brix.tr/en/solutions/process-development",
  },
  {
    brand: "brix",
    brandLabel: "BRIX",
    title: "Shelf life studies",
    copy: "Stability tests and practical plans for safer product shelf life.",
    cta: "Plan study",
    tone: "blue",
    layout: "bar",
    href: "https://brix.tr/en/solutions/food-shelf-life-studies",
  },
  {
    brand: "brix",
    brandLabel: "BRIX",
    title: "Labeling and regulation",
    copy: "Food label, claim and compliance consulting for technical teams.",
    cta: "Check labels",
    tone: "orange",
    layout: "focus",
    href: "https://brix.tr/en/solutions/food-labeling-consulting",
  },
  {
    brand: "brix",
    brandLabel: "BRIX",
    title: "Factory setup consulting",
    copy: "Facility setup, feasibility and production technology integration.",
    cta: "Talk to Brix",
    tone: "green",
    layout: "split",
    href: "https://brix.tr/en/solutions/food-facility-setup-consulting",
  },
];

function houseAdsForBrand(brand: HouseAdBrand) {
  return brand === "brix" ? BRIX_HOUSE_ADS : MANUFOX_HOUSE_ADS;
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function primaryHouseAdBrand() {
  if (typeof window === "undefined") return "manufox";
  const key = `${window.location.hostname}${window.location.pathname}`;
  return stableHash(key) % 2 === 0 ? "manufox" : "brix";
}

function oppositeHouseAdBrand(brand: HouseAdBrand): HouseAdBrand {
  return brand === "brix" ? "manufox" : "brix";
}

function houseAdBrandForSlot(index: number) {
  const primary = primaryHouseAdBrand();
  if (index >= HOUSE_AD_SIDEBAR_INDEX) return oppositeHouseAdBrand(primary);
  if (index === 0) return primary;
  if (typeof window === "undefined") return primary;
  const key = `${window.location.hostname}${window.location.pathname}:${index}`;
  return stableHash(key) % 2 === 0 ? "manufox" : "brix";
}

function randomHouseAdIndex(seed: number, reason: string, size: number) {
  if (globalThis.crypto?.getRandomValues) {
    const values = new Uint32Array(1);
    globalThis.crypto.getRandomValues(values);
    return values[0] % size;
  }
  return Math.abs((seed * 1103515245 + reason.length * 12345) % size);
}

function houseAdHtml(brand: HouseAdBrand, variant: number, reason: string) {
  const ads = houseAdsForBrand(brand);
  const ad = ads[variant % ads.length];
  const url = new URL(ad.href);
  url.searchParams.set("utm_source", "fstdesk");
  url.searchParams.set("utm_medium", "house_ad");
  url.searchParams.set("utm_campaign", "adsense_fallback");
  url.searchParams.set("utm_content", `${ad.brand}_${ad.tone}_${reason}`);

  return `
    <a class="gb-house-ad gb-house-ad-${ad.brand} gb-house-ad-${ad.tone} gb-house-ad-${ad.layout}" href="${url.toString()}" target="_blank" rel="noopener sponsored" data-house-ad-brand="${ad.brand}">
      <span class="gb-house-ad-brand">${ad.brandLabel}</span>
      <strong>${ad.title}</strong>
      <span class="gb-house-ad-copy">${ad.copy}</span>
      <span class="gb-house-ad-cta">${ad.cta}</span>
    </a>
  `;
}

export function AdSlot({
  config,
  index,
  height = DEFAULT_AD_HEIGHT,
  format = "horizontal",
}: {
  config?: AdsConfig;
  index: number;
  height?: number;
  format?: AdSlotFormat;
}) {
  const htmlRef = useRef<HTMLDivElement>(null);
  const houseVariantRef = useRef<number | null>(null);
  const { data: me } = useMe();
  const adminRoute = typeof window !== "undefined" && window.location.pathname.startsWith("/admin");
  const holdForAdminCheck = Boolean(config?.disableAdsenseForAdmins && !adminRoute && me === undefined);
  const suppressAdsenseForAdmin = Boolean(
    config?.disableAdsenseForAdmins &&
    (adminRoute || me?.role === "admin" || config?.adsenseSuppressedForAdmin || holdForAdminCheck),
  );
  const html = suppressAdsenseForAdmin ? "" : activeAdHtml(config);
  const reservedHeight = Math.max(60, Math.min(MAX_AD_HEIGHT, Math.round(Number(height) || DEFAULT_AD_HEIGHT)));

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

    const slotVisible = () => {
      if (!slot) return false;
      const rect = slot.getBoundingClientRect();
      const width = window.innerWidth || document.documentElement.clientWidth;
      const height = window.innerHeight || document.documentElement.clientHeight;
      if (rect.width <= 1 || rect.height <= 1) return false;
      return (
        rect.bottom >= -VIEWPORT_TOLERANCE_PX &&
        rect.right >= -VIEWPORT_TOLERANCE_PX &&
        rect.top <= height + VIEWPORT_TOLERANCE_PX &&
        rect.left <= width + VIEWPORT_TOLERANCE_PX
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
        el.setAttribute("data-ad-format", format);
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
      if (adsenseState() === "filled") {
        if (fallbackTimer !== null) {
          window.clearTimeout(fallbackTimer);
          fallbackTimer = null;
        }
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
      const brand = houseAdBrandForSlot(index);
      const ads = houseAdsForBrand(brand);
      if (houseVariantRef.current === null) {
        houseVariantRef.current = randomHouseAdIndex(index, `${brand}_${reason}`, ads.length);
      }
      mount.innerHTML = houseAdHtml(brand, houseVariantRef.current, reason);
      setSlotHeight();
      normalizeAdMarkup();
    };

    const scheduleFallback = (reason: string) => {
      if (fallbackApplied || adsenseState() === "filled" || !slotVisible()) return;
      if (!fallbackVisibleStartedAt) fallbackVisibleStartedAt = Date.now();
      if (fallbackTimer !== null) return;
      const remainingMs = Math.max(FALLBACK_DELAY_MS - (Date.now() - fallbackVisibleStartedAt), 0);
      fallbackTimer = window.setTimeout(() => {
        fallbackTimer = null;
        if (!slotVisible()) {
          fallbackVisibleStartedAt = 0;
          waitUntilVisible(() => scheduleFallback(reason));
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

    const waitUntilVisibleFor = (durationMs: number, onVisible: () => void, visibleSince = 0) => {
      if (!slotVisible()) {
        timers.push(window.setTimeout(() => waitUntilVisibleFor(durationMs, onVisible, 0), 250));
        return;
      }
      const since = visibleSince || Date.now();
      const elapsed = Date.now() - since;
      if (elapsed >= durationMs) {
        onVisible();
        return;
      }
      timers.push(window.setTimeout(
        () => waitUntilVisibleFor(durationMs, onVisible, since),
        Math.min(250, durationMs - elapsed),
      ));
    };
    const waitUntilVisible = (onVisible: () => void) => waitUntilVisibleFor(0, onVisible);

    const requestAdsense = () => {
      if (adRequested || fallbackApplied || !slotVisible()) return;
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
      waitUntilVisible(() => scheduleFallback("missing-code"));
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
          if (entry?.isIntersecting && entry.intersectionRatio >= VIEWABLE_THRESHOLD && slotVisible()) {
            viewObserver?.disconnect();
            waitUntilVisibleFor(ADSENSE_STABLE_VISIBLE_MS, requestAdsense);
          }
        },
        { threshold: [VIEWABLE_THRESHOLD] },
      );
      viewObserver.observe(slot);
    } else {
      waitUntilVisible(requestAdsense);
    }

    timers.push(window.setTimeout(() => {
      if (!adRequested && slotVisible()) waitUntilVisibleFor(ADSENSE_STABLE_VISIBLE_MS, requestAdsense);
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
