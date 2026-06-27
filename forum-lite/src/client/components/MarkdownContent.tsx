import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { X, ExternalLink } from "lucide-react";
import { renderMarkdown, type InternalMarkdownLink } from "../lib/sanitize";

type PdfState = { url: string; title: string };

export function MarkdownContent({
  content,
  internalLinks,
  className = "gb-post-content",
  style,
}: {
  content: string;
  internalLinks?: InternalMarkdownLink[];
  className?: string;
  style?: CSSProperties;
}) {
  const html = useMemo(() => renderMarkdown(content, { internalLinks }), [content, internalLinks]);
  const [pdf, setPdf] = useState<PdfState | null>(null);

  function onClick(e: React.MouseEvent<HTMLDivElement>) {
    const link = (e.target as HTMLElement).closest<HTMLAnchorElement>("a[data-pdf-url]");
    if (!link) return;
    e.preventDefault();
    setPdf({
      url: link.dataset.pdfUrl || link.href,
      title: link.textContent?.trim() || "PDF attachment",
    });
  }

  return (
    <>
      <div className={className} style={style} onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
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
