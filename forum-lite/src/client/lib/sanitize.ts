import DOMPurify from "dompurify";
import { marked } from "marked";

marked.setOptions({ breaks: true, gfm: true });

const PURIFY_CONFIG = {
  ALLOWED_TAGS: [
    "p", "br", "strong", "em", "b", "i", "u", "s", "del", "ins",
    "h1", "h2", "h3", "h4", "h5", "h6",
    "ul", "ol", "li",
    "blockquote", "pre", "code",
    "a", "hr", "img",
    "table", "thead", "tbody", "tr", "th", "td",
  ],
  ALLOWED_ATTR: ["href", "title", "rel", "src", "alt", "width", "height"],
  ALLOW_DATA_ATTR: false,
  FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "input", "button"],
  FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "onfocus", "onblur"],
  RETURN_AS_STRING: true as const,
};

function quoteAuthor(meta: string | undefined): string {
  if (!meta) return "quote";
  const author = meta
    .split(",")[0]
    .replace(/^["']|["']$/g, "")
    .trim();
  return author || "quote";
}

function quoteBody(body: string): string {
  return body
    .trim()
    .split(/\r?\n/)
    .map((line) => (line.trim() ? `> ${line}` : ">"))
    .join("\n");
}

function legacyQuotesToMarkdown(md: string): string {
  let next = md;
  const quoteRe = /\[quote(?:=(?:"([^"]*)"|'([^']*)'|([^\]]+)))?\]\s*([\s\S]*?)\s*\[\/quote\]/gi;

  for (let i = 0; i < 12; i++) {
    const prev = next;
    next = next.replace(quoteRe, (_match, dquoted, squoted, rawMeta, body) => {
      const author = quoteAuthor(dquoted ?? squoted ?? rawMeta);
      return `\n> **${author} wrote:**\n${quoteBody(body)}\n`;
    });
    if (next === prev) break;
  }

  return next;
}

export function renderMarkdown(md: string): string {
  const raw = marked.parse(legacyQuotesToMarkdown(md)) as string;
  const clean = DOMPurify.sanitize(raw, PURIFY_CONFIG) as string;

  if (typeof document === "undefined" || typeof window === "undefined") {
    return clean.replace(/<a\s/gi, '<a target="_blank" rel="noopener noreferrer nofollow" ');
  }

  const template = document.createElement("template");
  template.innerHTML = clean;
  const origin = window.location.origin;

  template.content.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((a) => {
    const rawHref = a.getAttribute("href");
    if (!rawHref) return;

    let url: URL;
    try {
      url = new URL(rawHref, origin);
    } catch {
      return;
    }

    if (!["http:", "https:"].includes(url.protocol)) return;

    const isSameOrigin = url.origin === origin;
    const isPdfMarker =
      url.searchParams.get("type") === "pdf" ||
      (a.textContent ?? "").toLowerCase().includes(".pdf") ||
      (a.getAttribute("title") ?? "").toLowerCase() === "pdf";
    const isAttachmentPdf =
      isSameOrigin &&
      /^\/api\/attachments\/\d+$/.test(url.pathname) &&
      isPdfMarker;

    if (isAttachmentPdf) {
      a.dataset.pdfUrl = `${url.pathname}${url.search}`;
      a.classList.add("gb-pdf-link");
      a.setAttribute("role", "button");
      a.setAttribute("title", "Open PDF");
    }

    if (!isSameOrigin) {
      url.searchParams.set("utm_source", "fstdesk");
      url.searchParams.set("utm_medium", "forum");
      url.searchParams.set("utm_campaign", "outbound_link");
      a.setAttribute("href", url.toString());
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener noreferrer nofollow");
    }
  });

  return template.innerHTML;
}
