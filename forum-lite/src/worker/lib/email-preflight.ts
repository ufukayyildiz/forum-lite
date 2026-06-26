import type { EmailFailureClassification } from "./email-classification";

type DnsAnswer = {
  name?: string;
  type?: number;
  TTL?: number;
  data?: string;
};

type DnsJson = {
  Status?: number;
  Answer?: DnsAnswer[];
  Comment?: string;
};

export type EmailPreflightResult = {
  input: string;
  email: string;
  local: string;
  domain: string;
  validSyntax: boolean;
  disposable: boolean;
  typoSuggestion: string | null;
  hasMx: boolean;
  hasA: boolean;
  hasAaaa: boolean;
  domainExists: boolean;
  canSend: boolean;
  mxRecords: string[];
  errors: string[];
};

const COMMON_DOMAINS = [
  "gmail.com",
  "googlemail.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "ymail.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
];

const TYPO_DOMAINS: Record<string, string> = {
  "gmai.com": "gmail.com",
  "gmial.com": "gmail.com",
  "gmal.com": "gmail.com",
  "gamil.com": "gmail.com",
  "gnail.com": "gmail.com",
  "gmail.con": "gmail.com",
  "gmail.co": "gmail.com",
  "gmail.cm": "gmail.com",
  "gmail.comm": "gmail.com",
  "hotmial.com": "hotmail.com",
  "hotmai.com": "hotmail.com",
  "hotmal.com": "hotmail.com",
  "hotnail.com": "hotmail.com",
  "hotmali.com": "hotmail.com",
  "homtail.com": "hotmail.com",
  "hotmail.con": "hotmail.com",
  "outlok.com": "outlook.com",
  "outloo.com": "outlook.com",
  "outloook.com": "outlook.com",
  "outlook.con": "outlook.com",
  "yaho.com": "yahoo.com",
  "yhaoo.com": "yahoo.com",
  "yahho.com": "yahoo.com",
  "yahoo.con": "yahoo.com",
  "icloud.con": "icloud.com",
  "iclod.com": "icloud.com",
  "icoud.com": "icloud.com",
  "iclould.com": "icloud.com",
};

const DISPOSABLE_DOMAINS = new Set([
  "10minutemail.com",
  "10minutemail.net",
  "20minutemail.com",
  "anonaddy.com",
  "burnermail.io",
  "dispostable.com",
  "emailondeck.com",
  "fakeinbox.com",
  "getnada.com",
  "guerrillamail.com",
  "guerrillamail.net",
  "guerrillamail.org",
  "inboxkitten.com",
  "maildrop.cc",
  "mailinator.com",
  "mailnesia.com",
  "mintemail.com",
  "moakt.com",
  "sharklasers.com",
  "spam4.me",
  "tempmail.com",
  "temp-mail.org",
  "throwawaymail.com",
  "trashmail.com",
  "yopmail.com",
]);

function normalizeDomain(value: string): string {
  const trimmed = value.trim().toLowerCase().replace(/\.+$/, "");
  try {
    return new URL(`http://${trimmed}`).hostname.toLowerCase().replace(/\.+$/, "");
  } catch {
    return trimmed;
  }
}

function parseEmail(input: string) {
  const raw = input.trim().replace(/^mailto:/i, "");
  const match = /^([^@\s]+)@([^@\s]+)$/.exec(raw);
  if (!match) return { email: raw.toLowerCase(), local: "", domain: "", validSyntax: false };
  const local = match[1].toLowerCase();
  const domain = normalizeDomain(match[2]);
  const email = `${local}@${domain}`;
  const labels = domain.split(".");
  const validSyntax = Boolean(
    local.length > 0 &&
    local.length <= 64 &&
    email.length <= 254 &&
    domain.length > 3 &&
    domain.includes(".") &&
    !local.startsWith(".") &&
    !local.endsWith(".") &&
    !local.includes("..") &&
    labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)),
  );
  return { email, local, domain, validSyntax };
}

function isDisposableDomain(domain: string): boolean {
  return DISPOSABLE_DOMAINS.has(domain) || [...DISPOSABLE_DOMAINS].some((item) => domain.endsWith(`.${item}`));
}

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) dp[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[a.length][b.length];
}

function typoSuggestion(domain: string): string | null {
  if (TYPO_DOMAINS[domain]) return TYPO_DOMAINS[domain];
  if (COMMON_DOMAINS.includes(domain)) return null;
  let best: { domain: string; distance: number } | null = null;
  for (const common of COMMON_DOMAINS) {
    const distance = editDistance(domain, common);
    if (distance <= 2 && (!best || distance < best.distance)) best = { domain: common, distance };
  }
  return best?.domain ?? null;
}

async function dnsQuery(domain: string, type: "MX" | "A" | "AAAA"): Promise<{ answers: DnsAnswer[]; error?: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3500);
  try {
    const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=${type}`;
    const res = await fetch(url, {
      headers: { Accept: "application/dns-json" },
      signal: controller.signal,
    });
    if (!res.ok) return { answers: [], error: `${type} lookup HTTP ${res.status}` };
    const body = await res.json() as DnsJson;
    const answers = (body.Answer ?? []).filter((answer) => {
      if (type === "MX") return answer.type === 15;
      if (type === "A") return answer.type === 1;
      return answer.type === 28;
    });
    if (body.Status && body.Status !== 0 && answers.length === 0) {
      return { answers, error: `${type} lookup status ${body.Status}` };
    }
    return { answers };
  } catch (error) {
    return { answers: [], error: `${type} lookup ${error instanceof Error ? error.message : "failed"}` };
  } finally {
    clearTimeout(timeout);
  }
}

export async function preflightEmail(input: string): Promise<EmailPreflightResult> {
  const parsed = parseEmail(input);
  const errors: string[] = [];
  if (!parsed.validSyntax) {
    return {
      input,
      email: parsed.email,
      local: parsed.local,
      domain: parsed.domain,
      validSyntax: false,
      disposable: false,
      typoSuggestion: parsed.domain ? typoSuggestion(parsed.domain) : null,
      hasMx: false,
      hasA: false,
      hasAaaa: false,
      domainExists: false,
      canSend: false,
      mxRecords: [],
      errors: ["invalid email syntax"],
    };
  }

  const disposable = isDisposableDomain(parsed.domain);
  const suggestion = typoSuggestion(parsed.domain);
  const [mx, a, aaaa] = await Promise.all([
    dnsQuery(parsed.domain, "MX"),
    dnsQuery(parsed.domain, "A"),
    dnsQuery(parsed.domain, "AAAA"),
  ]);
  for (const result of [mx, a, aaaa]) {
    if (result.error) errors.push(result.error);
  }
  const hasMx = mx.answers.length > 0;
  const hasA = a.answers.length > 0;
  const hasAaaa = aaaa.answers.length > 0;
  const domainExists = hasMx || hasA || hasAaaa;
  const canSend = parsed.validSyntax && !disposable && !suggestion && domainExists;

  return {
    input,
    email: parsed.email,
    local: parsed.local,
    domain: parsed.domain,
    validSyntax: parsed.validSyntax,
    disposable,
    typoSuggestion: suggestion,
    hasMx,
    hasA,
    hasAaaa,
    domainExists,
    canSend,
    mxRecords: mx.answers.map((answer) => String(answer.data ?? "")).filter(Boolean).slice(0, 8),
    errors,
  };
}

export function classificationForPreflight(result: EmailPreflightResult): EmailFailureClassification {
  if (!result.validSyntax) {
    return {
      email: result.email,
      category: "invalid_syntax",
      label: "invalid syntax",
      risk: "critical",
      action: "suppress",
      score: 98,
      temporary: false,
      reason: "The email address syntax is invalid.",
      evidence: result.errors,
    };
  }
  if (result.typoSuggestion) {
    return {
      email: result.email,
      category: "domain_typo",
      label: "domain typo",
      risk: "high",
      action: "review",
      score: 88,
      temporary: false,
      reason: `The domain looks like a typo. Suggested domain: ${result.typoSuggestion}.`,
      evidence: [`domain=${result.domain}`, `suggestion=${result.typoSuggestion}`],
    };
  }
  if (result.disposable) {
    return {
      email: result.email,
      category: "disposable_email",
      label: "disposable email",
      risk: "high",
      action: "suppress",
      score: 86,
      temporary: false,
      reason: "The recipient domain is a known disposable or temporary email provider.",
      evidence: [`domain=${result.domain}`],
    };
  }
  if (!result.domainExists) {
    return {
      email: result.email,
      category: "domain_no_dns",
      label: "domain has no DNS",
      risk: "critical",
      action: "suppress",
      score: 96,
      temporary: false,
      reason: "The recipient domain has no MX, A or AAAA records.",
      evidence: result.errors.length ? result.errors : [`domain=${result.domain}`],
    };
  }
  if (!result.hasMx) {
    return {
      email: result.email,
      category: "domain_no_mx",
      label: "domain has no MX",
      risk: "medium",
      action: "review",
      score: 60,
      temporary: false,
      reason: "The domain has no MX record. A/AAAA fallback exists, but mail delivery may be unreliable.",
      evidence: [`A=${result.hasA}`, `AAAA=${result.hasAaaa}`],
    };
  }
  return {
    email: result.email,
    category: "domain_deliverable",
    label: "domain deliverable",
    risk: "low",
    action: "ignore",
    score: 10,
    temporary: false,
    reason: "Syntax, domain and MX checks passed.",
    evidence: result.mxRecords.length ? result.mxRecords.map((record) => `MX ${record}`) : ["MX present"],
  };
}
