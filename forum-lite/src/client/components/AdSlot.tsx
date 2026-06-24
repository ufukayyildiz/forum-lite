import { useEffect, useRef } from "react";
import type { AdsConfig } from "../lib/api";

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

export function AdSlot({ config, index }: { config?: AdsConfig; index: number }) {
  const htmlRef = useRef<HTMLDivElement>(null);
  const html = config?.html?.trim() ?? "";
  const maxAdInnerHeight = "116px";

  useEffect(() => {
    const mount = htmlRef.current;
    if (!config?.enabled || !html || !mount) return;

    mount.innerHTML = html;

    const setCss = (el: HTMLElement, prop: string, value: string) => {
      if (el.style.getPropertyValue(prop) !== value) el.style.setProperty(prop, value);
    };

    const clampAdSize = () => {
      setCss(mount, "max-width", "100%");
      setCss(mount, "max-height", maxAdInnerHeight);
      setCss(mount, "min-height", "0");
      setCss(mount, "overflow", "hidden");

      for (const el of Array.from(mount.querySelectorAll<HTMLElement>("ins.adsbygoogle, .adsbygoogle, iframe"))) {
        setCss(el, "max-width", "100%");
        setCss(el, "max-height", maxAdInnerHeight);
        setCss(el, "min-height", "0");
        setCss(el, "overflow", "hidden");
        setCss(el, "display", "block");
        if (el.matches("ins.adsbygoogle, .adsbygoogle, iframe")) {
          setCss(el, "height", maxAdInnerHeight);
        }
        if (el instanceof HTMLIFrameElement) {
          el.scrolling = "no";
        }
      }
    };
    clampAdSize();

    const observer = new MutationObserver(clampAdSize);
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
    if (mount.querySelector(".adsbygoogle") && !hasInlinePush) {
      window.adsbygoogle = window.adsbygoogle || [];
      const pushAd = () => {
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
      observer.disconnect();
      for (const timer of timers) window.clearTimeout(timer);
      mount.innerHTML = "";
    };
  }, [config?.enabled, html, index]);

  if (!config?.enabled) return null;
  if (!html) return null;

  return (
    <div className="gb-ad-slot" data-ad-index={index}>
      <div className="gb-ad-label">ADVERTISEMENT</div>
      <div ref={htmlRef} className="gb-ad-frame" />
    </div>
  );
}
