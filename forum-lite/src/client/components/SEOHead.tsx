import { Helmet } from "react-helmet-async";
import {
  LOCALE_DETAILS,
  localizedAlternates,
  localizePath,
  parseLocalePath,
  type SupportedLocale,
} from "../../shared/locales";

const SITE_NAME = "FSTDESK";
const SITE_TAGLINE = "Food Science and Technology Desk";
const BASE_URL = typeof window !== "undefined" ? window.location.origin : "";
const DEFAULT_DESC = `${SITE_TAGLINE} for food science, food safety, product development and food technology discussions.`;

interface Crumb { name: string; url: string; }

interface SEOProps {
  title?: string;
  description?: string;
  canonical?: string;
  noindex?: boolean;
  image?: string;
  type?: "website" | "article" | "profile";
  articlePublishedTime?: string;
  articleModifiedTime?: string;
  articleSection?: string;
  articleTags?: string[];
  structuredData?: object | object[];
  breadcrumbs?: Crumb[];
}

function currentLocale(): SupportedLocale {
  if (typeof window === "undefined") return "en";
  return parseLocalePath(window.location.pathname).locale;
}

function currentLocaleStatus(locale: SupportedLocale): { metaLocale: SupportedLocale; translated: boolean } {
  if (locale === "en" || typeof document === "undefined") return { metaLocale: locale, translated: true };
  const raw = document.getElementById("__FSTDESK_LOCALE_STATUS__")?.textContent;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { metaLocale?: SupportedLocale; translated?: boolean };
      if (parsed.translated) return { metaLocale: parsed.metaLocale ?? locale, translated: true };
    } catch {
      // SSR owns the safe fallback when this script is absent or malformed.
    }
  }
  const translated = document.documentElement.dataset.fstdeskTranslated === "1";
  return { metaLocale: translated ? locale : "en", translated };
}

function absoluteUrl(pathOrUrl: string): string {
  if (!pathOrUrl) return BASE_URL;
  if (/^[a-z][a-z0-9+.-]*:/i.test(pathOrUrl)) return pathOrUrl;
  if (!BASE_URL) return pathOrUrl;
  return `${BASE_URL}${pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`}`;
}

function localizeUrlString(value: string, locale: SupportedLocale): string {
  if (!value) return value;
  if (BASE_URL && value.startsWith(BASE_URL)) {
    try {
      const url = new URL(value);
      return `${url.origin}${localizePath(`${url.pathname}${url.search}${url.hash}`, locale)}`;
    } catch {
      return value;
    }
  }
  if (value.startsWith("/")) return localizePath(value, locale);
  return value;
}

function localizeSchema(value: unknown, locale: SupportedLocale): unknown {
  if (Array.isArray(value)) return value.map((item) => localizeSchema(item, locale));
  if (!value || typeof value !== "object") return typeof value === "string" ? localizeUrlString(value, locale) : value;
  const details = LOCALE_DETAILS[locale];
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => {
      if (key === "inLanguage") return [key, details.contentLanguage];
      return [key, localizeSchema(item, locale)];
    }),
  );
}

function isConcreteLocale(value: SupportedLocale | "x-default"): value is SupportedLocale {
  return value !== "x-default";
}

function websiteSchema(locale: SupportedLocale) {
  const details = LOCALE_DETAILS[locale];
  const rootUrl = absoluteUrl(localizePath("/", locale));
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    alternateName: SITE_TAGLINE,
    description: DEFAULT_DESC,
    url: rootUrl,
    inLanguage: details.contentLanguage,
    publisher: {
      "@type": "Organization",
      name: "FSTDESK",
      alternateName: SITE_TAGLINE,
      slogan: SITE_TAGLINE,
      description: DEFAULT_DESC,
      url: rootUrl,
    },
    potentialAction: {
      "@type": "SearchAction",
      target: { "@type": "EntryPoint", urlTemplate: `${absoluteUrl(localizePath("/search", locale))}?q={search_term_string}` },
      "query-input": "required name=search_term_string",
    },
  };
}

function breadcrumbSchema(crumbs: Crumb[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      item: c.url,
    })),
  };
}

export function SEOHead({
  title,
  description = DEFAULT_DESC,
  canonical,
  noindex = false,
  image,
  type = "website",
  articlePublishedTime,
  articleModifiedTime,
  articleSection,
  articleTags = [],
  structuredData,
  breadcrumbs,
}: SEOProps) {
  const locale = currentLocale();
  const localeStatus = currentLocaleStatus(locale);
  const metaLocale = localeStatus.metaLocale;
  const effectiveNoindex = noindex || (locale !== "en" && !localeStatus.translated);
  const details = LOCALE_DETAILS[metaLocale];
  const fullTitle = title ? `${title} — ${SITE_NAME}` : SITE_NAME;
  const canonicalPath = localizePath(canonical || "/", metaLocale);
  const canonicalUrl = absoluteUrl(canonicalPath);
  const ogImage = image || `${BASE_URL}/og/default.webp`;
  const alternates = !effectiveNoindex && canonical ? localizedAlternates(canonical) : [];
  const keywords = Array.from(
    new Set(
      [
        SITE_NAME,
        SITE_TAGLINE,
        "food science",
        "food technology",
        "food safety",
        "product development",
        articleSection,
        ...articleTags,
      ]
        .map((item) => String(item ?? "").trim())
        .filter(Boolean),
    ),
  ).join(", ");

  const schemas: object[] = [websiteSchema(metaLocale)];
  if (breadcrumbs && breadcrumbs.length > 0) schemas.push(breadcrumbSchema(breadcrumbs));
  if (structuredData) {
    if (Array.isArray(structuredData)) schemas.push(...structuredData);
    else schemas.push(structuredData);
  }

  return (
    <Helmet>
      <html lang={details.htmlLang} dir={details.dir} data-fstdesk-translated={localeStatus.translated ? "1" : "0"} />
      <title>{fullTitle}</title>
      <meta name="description" content={description} />
      <meta name="application-name" content={SITE_NAME} />
      <meta name="apple-mobile-web-app-title" content={SITE_NAME} />
      <meta name="author" content={SITE_NAME} />
      <meta name="publisher" content={SITE_NAME} />
      <meta name="keywords" content={keywords} />
      <meta name="theme-color" content="#282828" />
      <meta httpEquiv="content-language" content={details.contentLanguage} />
      <link rel="canonical" href={canonicalUrl} />
      {alternates.map((alternate) => (
        <link
          key={alternate.hreflang}
          rel="alternate"
          hrefLang={alternate.hreflang}
          href={absoluteUrl(alternate.path)}
        />
      ))}
      {effectiveNoindex && <meta name="robots" content="noindex,follow" />}

      {/* Open Graph */}
      <meta property="og:site_name" content={SITE_NAME} />
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={canonicalUrl} />
      <meta property="og:type" content={type === "article" ? "article" : type === "profile" ? "profile" : "website"} />
      <meta property="og:image" content={ogImage} />
      <meta property="og:image:secure_url" content={ogImage} />
      <meta property="og:image:type" content={ogImage.endsWith(".webp") ? "image/webp" : "image/svg+xml"} />
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />
      <meta property="og:locale" content={details.ogLocale} />
      {alternates
        .filter((alternate): alternate is { locale: SupportedLocale; hreflang: string; path: string } =>
          isConcreteLocale(alternate.locale) && alternate.locale !== metaLocale,
        )
        .map((alternate) => (
          <meta key={`og-locale-${alternate.hreflang}`} property="og:locale:alternate" content={LOCALE_DETAILS[alternate.locale].ogLocale} />
        ))}

      {type === "article" && articlePublishedTime && <meta property="article:published_time" content={articlePublishedTime} />}
      {type === "article" && articleModifiedTime && <meta property="article:modified_time" content={articleModifiedTime} />}
      {type === "article" && articleSection && <meta property="article:section" content={articleSection} />}
      {type === "article" && articleTags.map((tag) => <meta key={tag} property="article:tag" content={tag} />)}

      {/* Twitter Card */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={ogImage} />

      {/* Structured Data — one <script> per schema for max compatibility */}
      {schemas.map((s, i) => (
        <script key={i} type="application/ld+json">
          {JSON.stringify(localizeSchema(s, metaLocale))}
        </script>
      ))}
    </Helmet>
  );
}
