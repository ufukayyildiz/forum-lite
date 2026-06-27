import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { X, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { api, type AnchorLink } from "../lib/api";
import { useMe } from "../lib/useAuth";
import { renderMarkdown, type AnchorMarkdownLink } from "../lib/sanitize";

type PdfState = { url: string; title: string };
type AnchorDialogState = { id: number | null; url: string; title: string; label: string };
type AnchorMenuState = { x: number; y: number; term: string; url: string; title: string };

function anchorFromApi(link: AnchorLink): AnchorMarkdownLink {
  return {
    id: link.id,
    term: link.term,
    url: link.url,
    title: link.title || link.term,
  };
}

export function MarkdownContent({
  content,
  anchors,
  className = "gb-post-content",
  style,
}: {
  content: string;
  anchors?: AnchorLink[];
  className?: string;
  style?: CSSProperties;
}) {
  const anchorLinks = useMemo(() => (anchors ?? []).filter((a) => a.enabled).map(anchorFromApi), [anchors]);
  const html = useMemo(() => renderMarkdown(content, { anchors: anchorLinks }), [content, anchorLinks]);
  const [pdf, setPdf] = useState<PdfState | null>(null);
  const [anchorDialog, setAnchorDialog] = useState<AnchorDialogState | null>(null);
  const [anchorMenu, setAnchorMenu] = useState<AnchorMenuState | null>(null);
  const { data: me } = useMe();
  const qc = useQueryClient();
  const canManageAnchors = me?.role === "admin";

  function onClick(e: React.MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;
    const anchorLink = target.closest<HTMLAnchorElement>("a[data-anchor-id]");
    if (anchorLink) {
      e.preventDefault();
      setAnchorMenu(null);
      const id = Number(anchorLink.dataset.anchorId);
      if (Number.isFinite(id) && id > 0) void api.trackAnchorClick(id);
      const label = anchorLink.textContent?.trim() || "anchor";
      setAnchorDialog({
        id: Number.isFinite(id) && id > 0 ? id : null,
        url: anchorLink.getAttribute("href") || anchorLink.href,
        title: anchorLink.getAttribute("title") || label,
        label,
      });
      return;
    }

    const link = target.closest<HTMLAnchorElement>("a[data-pdf-url]");
    if (link) {
      e.preventDefault();
      setAnchorMenu(null);
      setPdf({
        url: link.dataset.pdfUrl || link.href,
        title: link.textContent?.trim() || "PDF attachment",
      });
      return;
    }

    setAnchorMenu(null);
  }

  function onContextMenu(e: React.MouseEvent<HTMLDivElement>) {
    if (!canManageAnchors || typeof window === "undefined") return;
    const selection = window.getSelection();
    const term = selection?.toString().replace(/\s+/g, " ").trim() ?? "";
    const root = e.currentTarget;
    const inside =
      !!selection?.anchorNode &&
      !!selection?.focusNode &&
      root.contains(selection.anchorNode) &&
      root.contains(selection.focusNode);
    if (!inside || term.length < 2 || term.length > 80) return;
    e.preventDefault();
    const url = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const title = document.title.replace(/\s+[-—]\s+FSTDESK.*$/i, "").slice(0, 160) || term;
    setAnchorMenu({ x: e.clientX, y: e.clientY, term, url, title });
  }

  async function createSelectedAnchor() {
    if (!anchorMenu) return;
    try {
      await api.adminCreateAnchor({
        term: anchorMenu.term,
        url: anchorMenu.url,
        title: anchorMenu.title,
        enabled: true,
      });
      setAnchorMenu(null);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["anchors"] }),
        qc.invalidateQueries({ queryKey: ["admin-anchors"] }),
      ]);
      toast.success("Anchor added");
    } catch (error: any) {
      toast.error(error?.message ?? "Anchor could not be added");
    }
  }

  return (
    <>
      <div
        className={className}
        style={style}
        onClick={onClick}
        onContextMenu={onContextMenu}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {anchorMenu && (
        <div
          className="gb-anchor-context-menu"
          style={{ left: anchorMenu.x, top: anchorMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button className="gb-btn gb-btn-primary" onClick={createSelectedAnchor}>
            + add anchor
          </button>
          <span title={anchorMenu.term}>{anchorMenu.term}</span>
        </div>
      )}
      {anchorDialog && (
        <div className="gb-anchor-overlay" onClick={() => setAnchorDialog(null)}>
          <div className="gb-anchor-dialog" onClick={(event) => event.stopPropagation()}>
            <div className="gb-anchor-titlebar">
              <span className="gb-anchor-title" title={anchorDialog.title}>{anchorDialog.title}</span>
              <a className="gb-btn gb-anchor-open" href={anchorDialog.url} target="_blank" rel="noopener noreferrer">
                <ExternalLink size={13} /> open new tab
              </a>
              <button className="gb-btn-icon" onClick={() => setAnchorDialog(null)} title="Close anchor preview">
                <X size={16} />
              </button>
            </div>
            <iframe className="gb-anchor-frame" src={anchorDialog.url} title={anchorDialog.title || anchorDialog.label} />
          </div>
        </div>
      )}
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
