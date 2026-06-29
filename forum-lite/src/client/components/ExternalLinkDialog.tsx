import { useEffect, useState } from "react";
import { X } from "lucide-react";

type DialogState = {
  url: string;
  title: string;
};

const EXTERNAL_LINK_SKIP_SELECTOR = [
  "[data-external-dialog-skip]",
  ".gb-ad-slot",
  ".gb-house-ad",
  ".adsbygoogle",
].join(",");

function previewUrl(url: string) {
  try {
    const next = new URL(url, window.location.origin);
    if (next.origin !== window.location.origin) return next.toString();
    next.searchParams.set("embed", "1");
    return `${next.pathname}${next.search}${next.hash}`;
  } catch {
    return url;
  }
}

function linkTitle(anchor: HTMLAnchorElement, url: URL) {
  return (
    anchor.getAttribute("title")?.trim() ||
    anchor.textContent?.trim() ||
    url.hostname ||
    url.toString()
  );
}

export function ExternalLinkDialog() {
  const [dialog, setDialog] = useState<DialogState | null>(null);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const target = event.target as Element | null;
      const anchor = target?.closest<HTMLAnchorElement>("a[href]");
      if (!anchor) return;
      if (anchor.closest(EXTERNAL_LINK_SKIP_SELECTOR)) return;
      if (anchor.hasAttribute("download")) return;

      let url: URL;
      try {
        url = new URL(anchor.href, window.location.origin);
      } catch {
        return;
      }

      if (!["http:", "https:"].includes(url.protocol)) return;
      if (url.origin === window.location.origin) return;

      event.preventDefault();
      setDialog({ url: url.toString(), title: linkTitle(anchor, url) });
    }

    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  if (!dialog) return null;

  return (
    <div className="gb-anchor-overlay" onClick={() => setDialog(null)}>
      <div className="gb-anchor-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="gb-anchor-titlebar">
          <span className="gb-anchor-title">{dialog.title}</span>
          <button className="gb-btn-icon" onClick={() => setDialog(null)} title="Close link preview">
            <X size={16} />
          </button>
        </div>
        <iframe className="gb-anchor-frame" src={previewUrl(dialog.url)} title={dialog.title} />
      </div>
    </div>
  );
}
