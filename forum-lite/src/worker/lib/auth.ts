// Workers-compatible password hashing (PBKDF2 via Web Crypto) and session tokens.

const ITERATIONS = 100_000;
const KEY_LEN = 32;

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" },
    key,
    KEY_LEN * 8,
  );
  return `pbkdf2$${ITERATIONS}$${toHex(salt.buffer)}$${toHex(bits)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [scheme, iterStr, saltHex, hashHex] = stored.split("$");
    if (scheme !== "pbkdf2") return false;
    const iterations = parseInt(iterStr, 10);
    const salt = fromHex(saltHex);
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
      "deriveBits",
    ]);
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt: salt as unknown as ArrayBuffer, iterations, hash: "SHA-256" },
      key,
      KEY_LEN * 8,
    );
    return toHex(bits) === hashHex;
  } catch {
    return false;
  }
}

export function generateToken(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(32)).buffer);
}

export const SESSION_COOKIE = "forum_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function generatePublicId(): string {
  const n = Math.floor(Math.random() * 900_000) + 100_000;
  return String(n);
}

export function generateShortId(): string {
  const n = Math.floor(Math.random() * 9_000) + 1_000;
  return String(n);
}

export function slugify(input: string): string {
  const map: Record<string, string> = {
    ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u",
    Ç: "c", Ğ: "g", İ: "i", Ö: "o", Ş: "s", Ü: "u",
  };
  return input
    .split("")
    .map((ch) => map[ch] ?? ch)
    .join("")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80) || "konu";
}

/** Safely convert a D1/Drizzle timestamp (Date | number | string | null) to ISO string */
export function safeISO(v: Date | number | string | null | undefined): string {
  if (v == null) return new Date(0).toISOString();
  if (v instanceof Date) return isNaN(v.getTime()) ? new Date(0).toISOString() : v.toISOString();
  if (typeof v === "number") return new Date(v * 1000).toISOString();
  return String(v);
}
