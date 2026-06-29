import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";

const WEBMASTERS_SCOPE = "https://www.googleapis.com/auth/webmasters";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DEFAULT_SITE = "https://fstdesk.com/";
const DEFAULT_SITEMAP = "https://fstdesk.com/sitemap.xml";

function parseArgs(argv) {
  const args = {
    site: process.env.GSC_SITE_URL || DEFAULT_SITE,
    sitemap: process.env.GSC_SITEMAP_URL || DEFAULT_SITEMAP,
    urls: [],
    urlsFile: "",
    limit: Number(process.env.GSC_INSPECTION_LIMIT || 100),
    dryRun: false,
    skipSubmit: false,
    skipInspect: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--site" && next) args.site = next, i += 1;
    else if (arg === "--sitemap" && next) args.sitemap = next, i += 1;
    else if (arg === "--urls" && next) args.urls.push(...next.split(",").map((url) => url.trim()).filter(Boolean)), i += 1;
    else if (arg === "--urls-file" && next) args.urlsFile = next, i += 1;
    else if (arg === "--limit" && next) args.limit = Number(next), i += 1;
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--skip-submit") args.skipSubmit = true;
    else if (arg === "--skip-inspect") args.skipInspect = true;
    else if (arg === "--help") {
      console.log([
        "Usage: node scripts/search-console-submit.mjs [options]",
        "",
        "Options:",
        "  --site <url>          Search Console property URL, default https://fstdesk.com/",
        "  --sitemap <url>       Sitemap URL to submit, default https://fstdesk.com/sitemap.xml",
        "  --urls <a,b,c>        URLs to inspect instead of collecting from sitemap",
        "  --urls-file <path>    Newline-delimited URLs to inspect",
        "  --limit <n>           Max URL inspection requests, default 100",
        "  --dry-run             Print planned work without calling Google APIs",
        "  --skip-submit         Do not call sitemaps.submit",
        "  --skip-inspect        Do not call URL Inspection API",
        "",
        "Auth:",
        "  GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS must point to a",
        "  service account that has access to the Search Console property.",
      ].join("\n"));
      process.exit(0);
    }
  }
  args.limit = Number.isFinite(args.limit) && args.limit > 0 ? Math.floor(args.limit) : 100;
  return args;
}

function base64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

async function serviceAccount() {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  }
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return JSON.parse(await readFile(process.env.GOOGLE_APPLICATION_CREDENTIALS, "utf8"));
  }
  throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS");
}

async function accessToken() {
  const account = await serviceAccount();
  if (!account.client_email || !account.private_key) {
    throw new Error("Service account JSON must include client_email and private_key");
  }
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({
    iss: account.client_email,
    scope: WEBMASTERS_SCOPE,
    aud: TOKEN_URL,
    exp: now + 3600,
    iat: now,
  }));
  const unsigned = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const assertion = `${unsigned}.${signer.sign(account.private_key, "base64url")}`;
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  });
  const res = await fetch(TOKEN_URL, { method: "POST", body });
  if (!res.ok) throw new Error(`OAuth token request failed ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return json.access_token;
}

async function googleFetch(url, token, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const message = typeof body === "string" ? body : JSON.stringify(body);
    throw new Error(`Google API ${res.status}: ${message}`);
  }
  return body;
}

function xmlUnescape(text) {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

async function sitemapUrls(url, limit, seen = new Set()) {
  if (seen.has(url) || seen.size > 30) return [];
  seen.add(url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Sitemap fetch failed ${res.status}: ${url}`);
  const xml = await res.text();
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => xmlUnescape(match[1].trim()));
  if (/<sitemapindex[\s>]/i.test(xml)) {
    const out = [];
    for (const loc of locs) {
      if (out.length >= limit) break;
      out.push(...await sitemapUrls(loc, limit - out.length, seen));
    }
    return out.slice(0, limit);
  }
  return locs.filter((loc) => !/\/sitemap-[^/]+\.xml$/i.test(new URL(loc).pathname)).slice(0, limit);
}

async function readUrls(args) {
  const urls = new Set(args.urls);
  if (args.urlsFile) {
    const file = await readFile(args.urlsFile, "utf8");
    for (const line of file.split(/\r?\n/)) {
      const url = line.trim();
      if (url && !url.startsWith("#")) urls.add(url);
    }
  }
  if (!urls.size && !args.skipInspect && !args.dryRun) {
    for (const url of await sitemapUrls(args.sitemap, args.limit)) urls.add(url);
  }
  return [...urls].slice(0, args.limit);
}

function inspectionSummary(url, response) {
  const result = response?.inspectionResult?.indexStatusResult || {};
  return {
    url,
    verdict: result.verdict || null,
    coverageState: result.coverageState || null,
    indexingState: result.indexingState || null,
    robotsTxtState: result.robotsTxtState || null,
    pageFetchState: result.pageFetchState || null,
    lastCrawlTime: result.lastCrawlTime || null,
    userCanonical: result.userCanonical || null,
    googleCanonical: result.googleCanonical || null,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const urls = await readUrls(args);
  const summary = {
    site: args.site,
    sitemap: args.sitemap,
    dryRun: args.dryRun,
    note: "URL Inspection API reports Google index status; it does not request indexing for generic forum URLs.",
    sitemapSubmitted: false,
    inspected: [],
  };

  if (args.dryRun) {
    summary.planned = {
      submitSitemap: !args.skipSubmit,
      inspectUrlCount: args.skipInspect ? 0 : urls.length,
      urls,
    };
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  const token = await accessToken();
  if (!args.skipSubmit) {
    const endpoint = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(args.site)}/sitemaps/${encodeURIComponent(args.sitemap)}`;
    await googleFetch(endpoint, token, { method: "PUT" });
    summary.sitemapSubmitted = true;
  }

  if (!args.skipInspect) {
    for (const url of urls) {
      const response = await googleFetch("https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", token, {
        method: "POST",
        body: JSON.stringify({ inspectionUrl: url, siteUrl: args.site, languageCode: "en-US" }),
      });
      summary.inspected.push(inspectionSummary(url, response));
    }
  }

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
