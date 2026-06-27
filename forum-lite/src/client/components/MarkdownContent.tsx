import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { X, ExternalLink } from "lucide-react";
import { api, type AnchorLink } from "../lib/api";
import { renderMarkdown } from "../lib/sanitize";

type PdfState = { url: string; title: string };

export function MarkdownContent({
  content,
  anchors,
  currentPath,
  className = "gb-post-content",
  style,
}: {
  content: string;
  anchors?: AnchorLink[];
  currentPath?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const html = useMemo(() => renderMarkdown(content, { anchors, currentPath }), [content, anchors, currentPath]);
  const [pdf, setPdf] = useState<PdfState | null>(null);

  function onClick(e: React.MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;
    const link = target.closest<HTMLAnchorElement>("a[data-pdf-url]");
    if (link) {
      e.preventDefault();
      setPdf({
        url: link.dataset.pdfUrl || link.href,
        title: link.textContent?.trim() || "PDF attachment",
      });
      return;
    }

    const anchor = target.closest<HTMLAnchorElement>("a[data-anchor-id]");
    if (anchor) {
      const id = Number(anchor.dataset.anchorId);
      if (Number.isInteger(id) && id > 0) void api.trackAnchorClick(id).catch(() => undefined);
    }
  }

  return (
    <>
      <div
        className={className}
        style={style}
        onClick={onClick}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {pdf && (
        <div className="gb-pdf-overlay" onClick={() => setPdf(null)}>
          <div className="gb-pdf-dialog" onClick={(event) => event.stopPropagation()}>
            <div className="gb-pdf-titlebar">
              <span className="gb-pdf-title">{pdf.title}</span>
              <a className="gb-btn gb-pdf-open" href={pdf.url} target="_blank" rel="noopener noreferrer">
                <ExternalLink size={13} /> open
              </a>
              <button className="gb-btn-icon" onClick={() => setPdf(null)} title="Close PDF">
                <X size={16} />
              </button>
            </div>
            <iframe className="gb-pdf-frame" src={pdf.url} title={pdf.title} />
          </div>
        </div>
      )}
    </>
  );
}
