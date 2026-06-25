import { useEffect, useRef } from "react";
import type { AdsConfig } from "../lib/api";

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

const FALLBACK_DELAY_MS = 2000;

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
  const adHeight = "160px";

  useEffect(() => {
    const mount = htmlRef.current;
    if (!config?.enabled || !mount) return;

    const slot = mount.closest<HTMLElement>(".gb-ad-slot");
    let fallbackApplied = false;
    let observer: MutationObserver | null = null;

    const setCss = (el: HTMLElement, prop: string, value: string) => {
      if (el.style.getPropertyValue(prop) !== value) el.style.setProperty(prop, value);
    };

    const clampAdSize = () => {
      setCss(mount, "max-width", "100%");
      setCss(mount, "height", adHeight);
      setCss(mount, "max-height", adHeight);
      setCss(mount, "min-height", adHeight);
      setCss(mount, "overflow", "hidden");
      slot?.style.setProperty("--gb-ad-height", adHeight);

      for (const el of Array.from(mount.querySelectorAll<HTMLElement>("ins.adsbygoogle, .adsbygoogle, iframe"))) {
        setCss(el, "max-width", "100%");
        setCss(el, "width", "100%");
        setCss(el, "height", adHeight);
        setCss(el, "max-height", adHeight);
        setCss(el, "min-height", adHeight);
        setCss(el, "overflow", "hidden");
        setCss(el, "display", "block");
        if (el instanceof HTMLIFrameElement) {
          el.scrolling = "no";
        }
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

    const applyFallback = (reason: string) => {
      if (fallbackApplied || adsenseState() === "filled") return;
      fallbackApplied = true;
      observer?.disconnect();
      slot?.setAttribute("data-ad-state", "house");
      mount.setAttribute("data-ad-fallback", reason);
      mount.innerHTML = houseAdHtml(index, reason);
      clampAdSize();
    };

    slot?.setAttribute("data-ad-state", "adsense");
    mount.removeAttribute("data-ad-fallback");

    if (!html) {
      applyFallback("missing-code");
      return () => {
        mount.innerHTML = "";
        slot?.removeAttribute("data-ad-state");
      };
    }

    mount.innerHTML = html;
    clampAdSize();

    observer = new MutationObserver(() => {
      clampAdSize();
      if (adsenseState() === "unfilled") applyFallback("unfilled");
    });
    observer.observe(mount, { childList: true, subtree: true });

    const scripts = Array.from(mount.querySelectorAll("script"));
    const hasInlinePush = scripts.some(
      (script) => !script.src && /adsbygoogle[\s\S]*\.push\s*\(/.test(script.textContent ?? ""),
    );
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
        const clone = document.createElement("script");
        for (const attr of Array.from(script.attributes)) clone.setAttribute(attr.name, attr.value);
        clone.text = script.textContent ?? "";
        script.replaceWith(clone);
      }
    }

    const timers: number[] = [];
    for (const delay of [0, 250, 1000, 2500, 5000]) {
      timers.push(window.setTimeout(clampAdSize, delay));
    }
    timers.push(window.setTimeout(() => {
      if (adsenseState() !== "filled") applyFallback(adsenseState());
    }, FALLBACK_DELAY_MS));
    if (mount.querySelector(".adsbygoogle") && !hasInlinePush) {
      window.adsbygoogle = window.adsbygoogle || [];
      const pushAd = () => {
        if (fallbackApplied) return;
        try {
          window.adsbygoogle?.push({});
        } catch {
          // Adsense can reject duplicate pushes for the same slot.
        }
      };
      timers.push(window.setTimeout(pushAd, 0));
      timers.push(window.setTimeout(pushAd, 1200));
    }

    return () => {
      observer?.disconnect();
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
