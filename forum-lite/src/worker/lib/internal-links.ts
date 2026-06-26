export type InternalLinkTarget = {
  term: string;
  title: string;
  path: string;
  categoryName: string;
  categoryPath: string;
  publicId: string;
  excerpt: string;
};

type RawThreadTarget = {
  id: number;
  publicId: string;
  title: string;
  content: string;
  replyCount: number;
  views: number;
  categoryName: string;
  categoryPublicId: string;
};

const STOPWORDS = new Set([
  "about", "above", "after", "again", "against", "also", "another", "because", "before", "being",
  "below", "between", "could", "does", "doing", "during", "each", "from", "have", "having",
  "here", "into", "just", "like", "more", "most", "much", "need", "only", "other", "over",
  "please", "same", "should", "some", "such", "than", "that", "their", "them", "then", "there",
  "these", "they", "this", "those", "through", "under", "very", "want", "what", "when", "where",
  "which", "while", "with", "without", "would", "your", "yours", "thanks", "thank", "hello",
  "good", "great", "best", "anyone", "question", "answer", "help", "using", "used", "make",
  "made", "work", "works", "working", "product", "products", "food", "foods", "forum", "thread",
  "reply", "topic", "page", "link", "email", "contact", "people", "company", "companies",
]);

const DOMAIN_TERMS = [
  "acidity", "additive", "additives", "aflatoxin", "alginate", "allergen", "antioxidant",
  "anthocyanin", "aseptic", "bakery", "beverage", "biscuit", "brix", "caffeine", "caramel",
  "casein", "cheese", "chocolate", "choclate", "cocoa", "colloid", "colloids", "coloid", "coating", "coconut",
  "confectionery", "dairy", "emulsifier", "emulsifying", "emulsion", "enzyme", "enzymes",
  "extrusion", "fermentation", "fortification", "gelatin", "gelling", "gluten", "gummy",
  "gummies", "gum", "haccp", "hydrocolloid", "hydrocolloids", "hydrocoloid", "ingredient", "ingredients",
  "inulin", "jam", "jelly", "lactose", "lecithin", "maillard", "mayonnaise", "microbiology",
  "moisture", "mold", "mould", "pectin", "preservative", "preservatives", "protein", "proteins",
  "rancidity", "rheology", "salmonella", "shelf life", "stabilizer", "stabilizers", "starch",
  "sterilization", "surfactant", "texture", "thickener", "viscosity", "water activity", "xanthan",
  "yoghurt", "yogurt",
];

const DOMAIN_TERM_SET = new Set(DOMAIN_TERMS);

function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/g, " ")
    .replace(/[^a-z0-9+.\-\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count++;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

function scoreToken(token: string): number {
  if (DOMAIN_TERM_SET.has(token)) return 20;
  if (/^(?:micro|hydro|thermo|poly|bio|anti|de|re)[a-z]{5,}$/.test(token)) return 8;
  if (/(?:ase|ose|ide|ate|ene|ine|ol|ium|tion|sion|ity|ics|ology|genic|ation|active|activity)$/.test(token)) return 7;
  if (token.length >= 8) return 3;
  if (token.length >= 6) return 1;
  return 0;
}

export function extractTechnicalTerms(input: string, limit = 10): string[] {
  const text = normalizeText(input);
  if (!text) return [];

  const counts = new Map<string, number>();

  for (const phrase of DOMAIN_TERMS) {
    if (!phrase.includes(" ")) continue;
    const hits = countOccurrences(text, phrase);
    if (hits > 0) counts.set(phrase, hits * 30 + phrase.length);
  }

  for (const term of DOMAIN_TERMS) {
    if (term.includes(" ")) continue;
    const hits = countOccurrences(text, term);
    if (hits > 0) counts.set(term, (counts.get(term) ?? 0) + hits * 25 + term.length);
  }

  const tokens = text.match(/[a-z][a-z0-9+.-]{3,}/g) ?? [];
  for (const raw of tokens) {
    const token = raw.replace(/^[.-]+|[.-]+$/g, "");
    if (!token || STOPWORDS.has(token) || /^\d+$/.test(token)) continue;
    const score = scoreToken(token);
    if (score <= 0) continue;
    counts.set(token, (counts.get(token) ?? 0) + score);
  }

  return [...counts.entries()]
    .filter(([term]) => !STOPWORDS.has(term) && (DOMAIN_TERM_SET.has(term) || term.length >= 4))
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([term]) => term);
}

function stableHash(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function stablePick<T>(items: T[], seed: string): T | null {
  if (!items.length) return null;
  return items[stableHash(seed) % items.length] ?? null;
}

function cleanSnippet(input: string, max = 140): string {
  const text = input
    .replace(/<[^>]*>/g, " ")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/[`*_>#|~=]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1)).trim()}...` : text;
}

export async function loadInternalLinkTargets(
  db: D1Database,
  input: {
    sourceThreadId: number;
    sourcePublicId: string;
    text: string;
    maxTerms?: number;
    maxLinks?: number;
  },
): Promise<InternalLinkTarget[]> {
  const terms = extractTechnicalTerms(input.text, input.maxTerms ?? 10);
  const links: InternalLinkTarget[] = [];
  const usedThreadIds = new Set<number>();

  for (const term of terms) {
    if (links.length >= (input.maxLinks ?? 8)) break;
    const pattern = `%${term}%`;
    const rows = await db.prepare(
      `SELECT t.id, t.public_id AS publicId, t.title, t.content, t.reply_count AS replyCount, t.views,
        c.name AS categoryName, c.public_id AS categoryPublicId
       FROM threads t
       INNER JOIN categories c ON c.id = t.category_id
       WHERE t.id != ?
         AND (
           LOWER(t.title) LIKE ?
           OR LOWER(t.content) LIKE ?
           OR EXISTS (
             SELECT 1
             FROM posts p
             WHERE p.thread_id = t.id AND LOWER(p.content) LIKE ?
             LIMIT 1
           )
         )
       ORDER BY
         CASE WHEN LOWER(t.title) LIKE ? THEN 0 ELSE 1 END,
         t.reply_count DESC,
         t.views DESC,
         t.last_post_at DESC
       LIMIT 16`,
    )
      .bind(input.sourceThreadId, pattern, pattern, pattern, pattern)
      .all<RawThreadTarget>();

    const candidates = (rows.results ?? []).filter((row) => !usedThreadIds.has(Number(row.id)));
    const picked = stablePick(candidates, `${input.sourcePublicId}:${term}`);
    if (!picked) continue;

    usedThreadIds.add(Number(picked.id));
    links.push({
      term,
      title: String(picked.title ?? ""),
      path: `/t/${picked.publicId}`,
      categoryName: String(picked.categoryName ?? ""),
      categoryPath: `/c/${picked.categoryPublicId}`,
      publicId: String(picked.publicId ?? ""),
      excerpt: cleanSnippet(String(picked.content ?? "")),
    });
  }

  return links;
}
