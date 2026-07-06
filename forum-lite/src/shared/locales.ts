export const DEFAULT_LOCALE = "en";

export const LOCALIZED_LOCALES = [
  "tr",
  "ru",
  "de",
  "fr",
  "es",
  "pt",
  "it",
  "nl",
  "ar",
  "fa",
] as const;

export const SUPPORTED_LOCALES = [DEFAULT_LOCALE, ...LOCALIZED_LOCALES] as const;

export type LocalizedLocale = (typeof LOCALIZED_LOCALES)[number];
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const LOCALE_DETAILS: Record<SupportedLocale, {
  label: string;
  htmlLang: string;
  contentLanguage: string;
  ogLocale: string;
  dir: "ltr" | "rtl";
}> = {
  en: { label: "English", htmlLang: "en", contentLanguage: "en-US", ogLocale: "en_US", dir: "ltr" },
  tr: { label: "Turkish", htmlLang: "tr", contentLanguage: "tr-TR", ogLocale: "tr_TR", dir: "ltr" },
  ru: { label: "Russian", htmlLang: "ru", contentLanguage: "ru-RU", ogLocale: "ru_RU", dir: "ltr" },
  de: { label: "German", htmlLang: "de", contentLanguage: "de-DE", ogLocale: "de_DE", dir: "ltr" },
  fr: { label: "French", htmlLang: "fr", contentLanguage: "fr-FR", ogLocale: "fr_FR", dir: "ltr" },
  es: { label: "Spanish", htmlLang: "es", contentLanguage: "es-ES", ogLocale: "es_ES", dir: "ltr" },
  pt: { label: "Portuguese", htmlLang: "pt", contentLanguage: "pt-PT", ogLocale: "pt_PT", dir: "ltr" },
  it: { label: "Italian", htmlLang: "it", contentLanguage: "it-IT", ogLocale: "it_IT", dir: "ltr" },
  nl: { label: "Dutch", htmlLang: "nl", contentLanguage: "nl-NL", ogLocale: "nl_NL", dir: "ltr" },
  ar: { label: "Arabic", htmlLang: "ar", contentLanguage: "ar", ogLocale: "ar_AR", dir: "rtl" },
  fa: { label: "Persian", htmlLang: "fa", contentLanguage: "fa-IR", ogLocale: "fa_IR", dir: "rtl" },
};

const LOCALIZED_SET = new Set<string>(LOCALIZED_LOCALES);
const SUPPORTED_SET = new Set<string>(SUPPORTED_LOCALES);
const NON_LOCALIZED_FIRST_SEGMENTS = new Set([
  "admin",
  "api",
  "assets",
  "cdn-cgi",
  "login",
  "new-thread",
  "register",
]);

function normalizeSegment(part: string): string {
  try {
    return encodeURIComponent(decodeURIComponent(part));
  } catch {
    return part;
  }
}

export function isSupportedLocale(value: string | null | undefined): value is SupportedLocale {
  return SUPPORTED_SET.has(String(value ?? ""));
}

export function isLocalizedLocale(value: string | null | undefined): value is LocalizedLocale {
  return LOCALIZED_SET.has(String(value ?? ""));
}

function splitPath(path: string) {
  const match = /^([^?#]*)([\s\S]*)$/.exec(path);
  return {
    pathname: match?.[1] || "/",
    suffix: match?.[2] || "",
  };
}

export function normalizePathname(pathname: string): string {
  if (!pathname) return "/";
  const value = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return value.length > 1 ? value.replace(/\/+$/, "") : "/";
}

export function parseLocalePath(pathnameWithMaybeSuffix: string): {
  locale: SupportedLocale;
  prefix: "" | `/${LocalizedLocale}`;
  path: string;
  isLocalized: boolean;
} {
  const { pathname } = splitPath(pathnameWithMaybeSuffix);
  const normalized = normalizePathname(pathname);
  const parts = normalized.split("/").filter(Boolean);
  const first = parts[0] ?? "";
  if (isLocalizedLocale(first)) {
    const rest = parts.slice(1).map(normalizeSegment);
    return {
      locale: first,
      prefix: `/${first}`,
      path: rest.length ? `/${rest.join("/")}` : "/",
      isLocalized: true,
    };
  }
  return { locale: DEFAULT_LOCALE, prefix: "", path: normalized, isLocalized: false };
}

export function shouldLocalizePath(pathnameWithMaybeSuffix: string): boolean {
  const { pathname } = splitPath(pathnameWithMaybeSuffix);
  const { path } = parseLocalePath(pathname);
  if (/\.[a-zA-Z0-9]{2,8}$/.test(path)) return false;
  const first = path.split("/").filter(Boolean)[0] ?? "";
  return !NON_LOCALIZED_FIRST_SEGMENTS.has(first);
}

export function localizePath(pathWithMaybeSuffix: string, locale: SupportedLocale): string {
  if (!pathWithMaybeSuffix || /^[a-z][a-z0-9+.-]*:/i.test(pathWithMaybeSuffix) || pathWithMaybeSuffix.startsWith("#")) {
    return pathWithMaybeSuffix;
  }
  const { pathname, suffix } = splitPath(pathWithMaybeSuffix);
  const parsed = parseLocalePath(pathname);
  const cleanPath = parsed.path;
  if (locale === DEFAULT_LOCALE || !shouldLocalizePath(cleanPath)) return `${cleanPath}${suffix}`;
  return `/${locale}${cleanPath === "/" ? "" : cleanPath}${suffix}`;
}

export function localizedAlternates(pathname: string): Array<{ locale: SupportedLocale | "x-default"; hreflang: string; path: string }> {
  const { path } = parseLocalePath(pathname);
  if (!shouldLocalizePath(path)) return [];
  return [
    { locale: DEFAULT_LOCALE, hreflang: LOCALE_DETAILS.en.htmlLang, path: localizePath(path, DEFAULT_LOCALE) },
    ...LOCALIZED_LOCALES.map((locale) => ({
      locale,
      hreflang: LOCALE_DETAILS[locale].htmlLang,
      path: localizePath(path, locale),
    })),
    { locale: "x-default" as const, hreflang: "x-default", path: localizePath(path, DEFAULT_LOCALE) },
  ];
}
