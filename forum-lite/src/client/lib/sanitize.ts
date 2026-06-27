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

export type InternalMarkdownLink = {
  term: string;
  title: string;
  path: string;
};

type RenderMarkdownOptions = {
  internalLinks?: InternalMarkdownLink[];
};

function escapeHtmlAttr(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function prepareInternalLinks(links: InternalMarkdownLink[] | undefined): InternalMarkdownLink[] {
  const seen = new Set<string>();
  return (links ?? [])
    .map((link) => ({
      term: String(link.term ?? "").trim(),
      title: String(link.title ?? "").trim(),
      path: String(link.path ?? "").trim(),
    }))
    .filter((link) => link.term.length >= 4 && link.path.startsWith("/") && !link.path.startsWith("//"))
    .filter((link) => {
      const key = `${link.term.toLowerCase()}:${link.path}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.term.length - a.term.length || a.term.localeCompare(b.term));
}

function internalTermPattern(term: string): RegExp {
  return new RegExp(`(^|[^A-Za-z0-9])(${escapeRegExp(term).replace(/\s+/g, "\\s+")})(?=$|[^A-Za-z0-9])`, "i");
}

function linkTextChunk(text: string, links: InternalMarkdownLink[], used: Set<string>): string {
  let remaining = text;
  let out = "";

  while (remaining) {
    let best: { link: InternalMarkdownLink; start: number; end: number; text: string } | null = null;

    for (const link of links) {
      const key = `${link.term.toLowerCase()}:${link.path}`;
      if (used.has(key)) continue;
      const match = internalTermPattern(link.term).exec(remaining);
      if (!match) continue;
      const start = match.index + match[1].length;
      const end = start + match[2].length;
      if (!best || start < best.start || (start === best.start && match[2].length > best.text.length)) {
        best = { link, start, end, text: match[2] };
      }
    }

    if (!best) {
      out += remaining;
      break;
    }

    const key = `${best.link.term.toLowerCase()}:${best.link.path}`;
    used.add(key);
    out += remaining.slice(0, best.start);
    out += `<a class="gb-internal-anchor" href="${escapeHtmlAttr(best.link.path)}" title="${escapeHtmlAttr(`Related: ${best.link.title}`)}">${best.text}</a>`;
    remaining = remaining.slice(best.end);
  }

  return out;
}

function injectInternalLinks(html: string, rawLinks: InternalMarkdownLink[] | undefined): string {
  const links = prepareInternalLinks(rawLinks);
  if (!links.length || !html) return html;

  const used = new Set<string>();
  const skipTags = new Set(["a", "code", "pre", "script", "style", "h1", "h2", "h3", "h4", "h5", "h6"]);
  const skipStack: string[] = [];
  let out = "";
  let last = 0;
  const tagRe = /<[^>]*>/g;
  let match: RegExpExecArray | null;

  while ((match = tagRe.exec(html))) {
    const text = html.slice(last, match.index);
    out += skipStack.length ? text : linkTextChunk(text, links, used);

    const tag = match[0];
    out += tag;

    const nameMatch = /^<\s*\/?\s*([a-z0-9]+)/i.exec(tag);
    if (nameMatch) {
      const tagName = nameMatch[1].toLowerCase();
      const closing = /^<\s*\//.test(tag);
      const selfClosing = /\/\s*>$/.test(tag) || /^(br|hr|img|meta|link)$/i.test(tagName);
      if (closing) {
        const idx = skipStack.lastIndexOf(tagName);
        if (idx !== -1) skipStack.splice(idx, 1);
      } else if (!selfClosing && skipTags.has(tagName)) {
        skipStack.push(tagName);
      }
    }

    last = tagRe.lastIndex;
    if (used.size >= links.length) break;
  }

  const tail = html.slice(last);
  out += skipStack.length ? tail : linkTextChunk(tail, links, used);
  return out;
}

function addExternalTargetAttributes(html: string): string {
  return html.replace(/<a\s+([^>]*href=["']https?:\/\/[^"'>\s]+["'][^>]*)>/gi, (full, attrs: string) => {
    let nextAttrs = attrs;
    if (!/\btarget\s*=/.test(nextAttrs)) nextAttrs += ' target="_blank"';
    if (!/\brel\s*=/.test(nextAttrs)) nextAttrs += ' rel="noopener noreferrer nofollow"';
    return `<a ${nextAttrs}>`;
  });
}

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

export function renderMarkdown(md: string, options: RenderMarkdownOptions = {}): string {
  const raw = marked.parse(legacyQuotesToMarkdown(md)) as string;
  const clean = DOMPurify.sanitize(raw, PURIFY_CONFIG) as string;
  const linked = injectInternalLinks(clean, options.internalLinks);

  if (typeof document === "undefined" || typeof window === "undefined") {
    return addExternalTargetAttributes(linked);
  }

  const template = document.createElement("template");
  template.innerHTML = linked;
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
