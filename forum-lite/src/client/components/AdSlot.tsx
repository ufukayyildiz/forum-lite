import { useEffect, useRef } from "react";
import type { AdsConfig } from "../lib/api";

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

const FALLBACK_DELAY_MS = 2000;
const VIEWABLE_THRESHOLD = 0.75;
const RESERVED_AD_HEIGHT = 160;
const MAX_AUTO_AD_HEIGHT = 320;

const HOUSE_ADS = [
  {
    title: "ManuFox ERP",
    copy: "Production, stock, purchasing and quality workflows for manufacturers.",
    cta: "Explore",
    tone: "lime",
  },
  {
    title: "Run manufacturing cleaner",
    copy: "Plan orders, track batches and keep operations visible from one system.",
    cta: "See ManuFox",
    tone: "aqua",
  },
  {
    title: "Built for growing factories",
    copy: "A practical ERP layer for teams that need fewer spreadsheets and faster decisions.",
    cta: "Learn more",
    tone: "yellow",
  },
] as const;

function houseAdHtml(index: number, reason: string) {
  const ad = HOUSE_ADS[index % HOUSE_ADS.length];
  const url = new URL("https://manufox.com/about");
  url.searchParams.set("utm_source", "fstdesk");
  url.searchParams.set("utm_medium", "house_ad");
  url.searchParams.set("utm_campaign", "adsense_fallback");
  url.searchParams.set("utm_content", `${ad.tone}_${reason}`);

  return `
    <a class="gb-house-ad gb-house-ad-${ad.tone}" href="${url.toString()}" target="_blank" rel="noopener sponsored">
      <span class="gb-house-ad-main">
        <span class="gb-house-ad-brand">MANUFOX</span>
        <strong>${ad.title}</strong>
        <span>${ad.copy}</span>
      </span>
      <span class="gb-house-ad-cta">${ad.cta}</span>
    </a>
  `;
}

export function AdSlot({ config, index }: { config?: AdsConfig; index: number }) {
  const htmlRef = useRef<HTMLDivElement>(null);
  const html = config?.html?.trim() ?? "";

  useEffect(() => {
    const mount = htmlRef.current;
    if (!config?.enabled || !mount) return;

    const slot = mount.closest<HTMLElement>(".gb-ad-slot");
    let fallbackApplied = false;
    let adRequested = false;
    let mutationObserver: MutationObserver | null = null;
    let viewObserver: IntersectionObserver | null = null;
    let resizeObserver: ResizeObserver | null = null;
    const timers: number[] = [];

    const setCss = (el: HTMLElement, prop: string, value: string) => {
      if (el.style.getPropertyValue(prop) !== value) el.style.setProperty(prop, value);
    };

    const setSlotHeight = (height: number, lockHeight = false) => {
      const clampedHeight = Math.max(RESERVED_AD_HEIGHT, Math.min(MAX_AUTO_AD_HEIGHT, Math.ceil(height)));
      slot?.style.setProperty("--gb-ad-height", `${clampedHeight}px`);
      if (lockHeight) {
        slot?.style.setProperty("height", `${clampedHeight}px`, "important");
        slot?.style.setProperty("min-height", `${clampedHeight}px`, "important");
      } else {
        slot?.style.removeProperty("height");
        slot?.style.removeProperty("min-height");
      }
    };

    const normalizeAdMarkup = () => {
      setCss(mount, "max-width", "100%");
      setCss(mount, "width", "100%");

      for (const el of Array.from(mount.querySelectorAll<HTMLElement>("ins.adsbygoogle, .adsbygoogle"))) {
        setCss(el, "max-width", "100%");
        setCss(el, "width", "100%");
        setCss(el, "display", "block");
        el.style.removeProperty("height");
        el.style.removeProperty("max-height");
        el.style.removeProperty("overflow");
      }

      for (const frame of Array.from(mount.querySelectorAll<HTMLIFrameElement>("iframe"))) {
        setCss(frame, "max-width", "100%");
        setCss(frame, "display", "block");
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

    const adaptToCreative = () => {
      normalizeAdMarkup();
      const frames = Array.from(mount.querySelectorAll<HTMLIFrameElement>("iframe"));
      const maxFrameHeight = frames.reduce((height, frame) => {
        const rect = frame.getBoundingClientRect();
        return Math.max(height, frame.offsetHeight, rect.height);
      }, 0);

      if (maxFrameHeight > 1) {
        setSlotHeight(maxFrameHeight);
        slot?.setAttribute("data-ad-state", "filled");
      }
    };

    const applyFallback = (reason: string) => {
      if (fallbackApplied || adsenseState() === "filled") return;
      fallbackApplied = true;
      mutationObserver?.disconnect();
      resizeObserver?.disconnect();
      slot?.setAttribute("data-ad-state", "house");
      mount.setAttribute("data-ad-fallback", reason);
      mount.innerHTML = houseAdHtml(index, reason);
      setSlotHeight(RESERVED_AD_HEIGHT, true);
      normalizeAdMarkup();
    };

    const requestAdsense = () => {
      if (adRequested || fallbackApplied) return;
      adRequested = true;
      slot?.setAttribute("data-ad-state", "loading");
      mount.setAttribute("data-ad-requested", "true");
      normalizeAdMarkup();

      if (mount.querySelector(".adsbygoogle")) {
        window.adsbygoogle = window.adsbygoogle || [];
        requestAnimationFrame(() => {
          try {
            window.dispatchEvent(new Event("resize"));
            window.adsbygoogle?.push({});
          } catch {
            // Adsense can reject duplicate pushes for the same slot.
          }
        });
      }

      timers.push(window.setTimeout(() => {
        const state = adsenseState();
        if (state === "filled") {
          adaptToCreative();
        } else {
          applyFallback(state);
        }
      }, FALLBACK_DELAY_MS));
    };

    setSlotHeight(RESERVED_AD_HEIGHT);
    slot?.setAttribute("data-ad-state", "waiting");
    mount.removeAttribute("data-ad-fallback");
    mount.removeAttribute("data-ad-requested");

    if (!html) {
      applyFallback("missing-code");
      return () => {
        mount.innerHTML = "";
        slot?.removeAttribute("data-ad-state");
      };
    }

    mount.innerHTML = html;
    normalizeAdMarkup();

    mutationObserver = new MutationObserver(() => {
      adaptToCreative();
      if (adsenseState() === "unfilled") applyFallback("unfilled");
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
      resizeObserver = new ResizeObserver(adaptToCreative);
      resizeObserver.observe(mount);
    }

    for (const delay of [250, 1000, 2500, 5000]) {
      timers.push(window.setTimeout(adaptToCreative, delay));
    }

    if (!mount.querySelector(".adsbygoogle")) {
      timers.push(window.setTimeout(() => {
        if (adsenseState() !== "filled") applyFallback(adsenseState());
      }, FALLBACK_DELAY_MS));
    } else if ("IntersectionObserver" in window && slot) {
      viewObserver = new IntersectionObserver(
        (entries) => {
          const entry = entries[0];
          if (entry?.isIntersecting && entry.intersectionRatio >= VIEWABLE_THRESHOLD) {
            viewObserver?.disconnect();
            requestAdsense();
          }
        },
        { threshold: [VIEWABLE_THRESHOLD] },
      );
      viewObserver.observe(slot);
    } else {
      timers.push(window.setTimeout(requestAdsense, 350));
    }

    timers.push(window.setTimeout(() => {
      if (!adRequested && slot) {
        const rect = slot.getBoundingClientRect();
        const visibleHeight = Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0);
        if (visibleHeight / Math.max(rect.height, 1) >= VIEWABLE_THRESHOLD) {
          requestAdsense();
        }
      }
    }, 1500));

    return () => {
      mutationObserver?.disconnect();
      viewObserver?.disconnect();
      resizeObserver?.disconnect();
      for (const timer of timers) window.clearTimeout(timer);
      mount.innerHTML = "";
      slot?.removeAttribute("data-ad-state");
    };
  }, [config?.enabled, html, index]);

  if (!config?.enabled) return null;

  return (
    <div className="gb-ad-slot" data-ad-index={index}>
      <div ref={htmlRef} className="gb-ad-frame" />
    </div>
  );
}
