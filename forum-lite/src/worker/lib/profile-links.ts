const URL_CHECK_TIMEOUT_MS = 5_000;
const BIO_LINK_LIMIT = 8;

function uniqueUrls(urls: string[]) {
  const seen = new Set<string>();
  return urls.filter((url) => {
    const key = url.trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function cleanCandidateUrl(input: string) {
  return input.trim().replace(/[),.;\]]+$/g, "");
}

export function extractMarkdownUrls(input: string | null | undefined): string[] {
  const text = String(input ?? "");
  const urls: string[] = [];
  const markdownLinkRe = /!?\[[^\]]*]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g;
  let match: RegExpExecArray | null;
  while ((match = markdownLinkRe.exec(text))) {
    urls.push(cleanCandidateUrl(match[1]));
  }

  const rawUrlRe = /https?:\/\/[^\s<>"']+/gi;
  while ((match = rawUrlRe.exec(text))) {
    urls.push(cleanCandidateUrl(match[0]));
  }

  return uniqueUrls(urls);
}

function assertHttpsUrl(rawUrl: string, label: string) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`${label} must be a valid https:// URL`);
  }

  if (url.protocol !== "https:") {
    throw new Error(`${label} must use https://`);
  }

  if (!url.hostname || url.username || url.password) {
    throw new Error(`${label} must be a valid public https:// URL`);
  }

  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".localhost")
  ) {
    throw new Error(`${label} must be a public https:// URL`);
  }

  return url;
}

async function fetchWithTimeout(url: string, init: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), URL_CHECK_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal, redirect: "follow" });
  } finally {
    clearTimeout(timer);
  }
}

export async function assertReachableHttpsUrl(rawUrl: string, label = "URL") {
  const url = assertHttpsUrl(rawUrl, label);

  let response: Response;
  try {
    response = await fetchWithTimeout(url.toString(), { method: "HEAD" });
    if (response.status === 405 || response.status === 403) {
      response = await fetchWithTimeout(url.toString(), {
        method: "GET",
        headers: { Range: "bytes=0-0" },
      });
    }
  } catch {
    throw new Error(`${label} could not be opened`);
  }

  if (!response.ok) {
    throw new Error(`${label} could not be opened`);
  }

  if (response.url) {
    const finalUrl = assertHttpsUrl(response.url, label);
    if (finalUrl.protocol !== "https:") throw new Error(`${label} must stay on https://`);
  }
}

export async function assertValidBioLinks(bio: string | null | undefined) {
  const urls = extractMarkdownUrls(bio);
  if (urls.length > BIO_LINK_LIMIT) throw new Error(`Bio can include at most ${BIO_LINK_LIMIT} links`);

  for (const url of urls) {
    await assertReachableHttpsUrl(url, `Bio link ${url}`);
  }
}
