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

export type AnchorMarkdownLink = {
  id?: number;
  term: string;
  title: string;
  url: string;
};

type RenderMarkdownOptions = {
  anchors?: AnchorMarkdownLink[];
  currentPath?: string;
};

type PreparedAnchorGroup = {
  key: string;
  term: string;
  pattern: RegExp;
  links: AnchorMarkdownLink[];
};

const MAX_ANCHOR_TERMS_PER_RENDER = 80;
const MAX_ANCHOR_TARGETS_PER_TERM = 20;
const MAX_ANCHORS_PER_DOCUMENT = 8;

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

function isSafeAnchorUrl(url: string): boolean {
  if (url.startsWith("/") && !url.startsWith("//")) return true;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeInternalPath(url: string | undefined): string {
  if (!url) return "";
  try {
    if (url.startsWith("/") && !url.startsWith("//")) {
      const path = url.split("#")[0].split("?")[0];
      return path.length > 1 ? path.replace(/\/+$/, "") : path;
    }
    const parsed = new URL(url);
    return parsed.pathname.length > 1 ? parsed.pathname.replace(/\/+$/, "") : parsed.pathname;
  } catch {
    return "";
  }
}

function hashString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function prepareAnchorGroups(links: AnchorMarkdownLink[] | undefined, currentPath?: string): PreparedAnchorGroup[] {
  const seen = new Set<string>();
  const current = normalizeInternalPath(currentPath);
  const prepared = (links ?? [])
    .map((link) => ({
      id: Number(link.id) || undefined,
      term: String(link.term ?? "").trim(),
      title: String(link.title ?? "").trim(),
      url: String(link.url ?? "").trim(),
    }))
    .filter((link) => link.term.length >= 3 && isSafeAnchorUrl(link.url))
    .filter((link) => normalizeInternalPath(link.url) !== current)
    .filter((link) => {
      const key = `${link.term.toLowerCase()}:${link.url}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.term.length - a.term.length || a.term.localeCompare(b.term));

  const groups = new Map<string, AnchorMarkdownLink[]>();
  for (const link of prepared) {
    const key = link.term.toLowerCase();
    const bucket = groups.get(key) ?? [];
    if (bucket.length < MAX_ANCHOR_TARGETS_PER_TERM) {
      bucket.push(link);
      groups.set(key, bucket);
    }
  }

  return Array.from(groups.entries())
    .map(([key, bucket]) => ({
      key,
      term: bucket[0].term,
      pattern: internalTermPattern(bucket[0].term),
      links: bucket,
    }))
    .sort((a, b) => b.term.length - a.term.length || a.term.localeCompare(b.term))
    .slice(0, MAX_ANCHOR_TERMS_PER_RENDER);
}

function internalTermPattern(term: string): RegExp {
  return new RegExp(`(^|[^A-Za-z0-9])(${escapeRegExp(term).replace(/\s+/g, "\\s+")})(?=$|[^A-Za-z0-9])`, "i");
}

function linkTextChunk(text: string, groups: PreparedAnchorGroup[], usedTerms: Set<string>): string {
  let remaining = text;
  let out = "";

  while (remaining && usedTerms.size < MAX_ANCHORS_PER_DOCUMENT) {
    let best: { group: PreparedAnchorGroup; start: number; end: number; text: string } | null = null;

    for (const group of groups) {
      if (usedTerms.has(group.key)) continue;
      const match = group.pattern.exec(remaining);
      if (!match) continue;
      const start = match.index + match[1].length;
      const end = start + match[2].length;
      if (!best || start < best.start || (start === best.start && match[2].length > best.text.length)) {
        best = { group, start, end, text: match[2] };
      }
    }

    if (!best) {
      out += remaining;
      break;
    }

    usedTerms.add(best.group.key);
    const candidates = best.group.links;
    const link = candidates[hashString(`${text}:${best.text}:${best.start}`) % candidates.length];
    out += remaining.slice(0, best.start);
    const idAttr = link.id ? ` data-anchor-id="${link.id}"` : "";
    out += `<a class="gb-internal-anchor" href="${escapeHtmlAttr(link.url)}"${idAttr} title="${escapeHtmlAttr(link.title || link.term)}">${best.text}</a>`;
    remaining = remaining.slice(best.end);
  }

  if (remaining) out += remaining;
  return out;
}

function injectAnchorLinks(html: string, rawLinks: AnchorMarkdownLink[] | undefined, currentPath?: string): string {
  const groups = prepareAnchorGroups(rawLinks, currentPath);
  if (!groups.length || !html) return html;

  const usedTerms = new Set<string>();
  const skipTags = new Set(["a", "code", "pre", "script", "style", "h1", "h2", "h3", "h4", "h5", "h6"]);
  const skipStack: string[] = [];
  let out = "";
  let last = 0;
  const tagRe = /<[^>]*>/g;
  let match: RegExpExecArray | null;

  while ((match = tagRe.exec(html))) {
    const text = html.slice(last, match.index);
    out += skipStack.length ? text : linkTextChunk(text, groups, usedTerms);

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
    if (usedTerms.size >= MAX_ANCHORS_PER_DOCUMENT) break;
  }

  const tail = html.slice(last);
  out += skipStack.length ? tail : linkTextChunk(tail, groups, usedTerms);
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
  const linked = injectAnchorLinks(clean, options.anchors, options.currentPath);

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
