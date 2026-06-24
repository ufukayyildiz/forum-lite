import { Helmet } from "react-helmet-async";

const SITE_NAME = "FSTDESK Forum";
const BASE_URL = typeof window !== "undefined" ? window.location.origin : "";
const DEFAULT_DESC = "Food science, food safety, product development and food technology forum discussions.";
const SITE_LOCALE = "en_US";
const SITE_LANGUAGE = "en-US";

interface Crumb { name: string; url: string; }

interface SEOProps {
  title?: string;
  description?: string;
  canonical?: string;
  noindex?: boolean;
  image?: string;
  type?: "website" | "article" | "profile";
  structuredData?: object | object[];
  breadcrumbs?: Crumb[];
}

function websiteSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: BASE_URL,
    inLanguage: SITE_LANGUAGE,
    publisher: {
      "@type": "Organization",
      name: "FSTDESK",
      url: BASE_URL,
    },
    potentialAction: {
      "@type": "SearchAction",
      target: { "@type": "EntryPoint", urlTemplate: `${BASE_URL}/search?q={search_term_string}` },
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
  structuredData,
  breadcrumbs,
}: SEOProps) {
  const fullTitle = title ? `${title} — ${SITE_NAME}` : SITE_NAME;
  const canonicalUrl = canonical ? `${BASE_URL}${canonical}` : BASE_URL;
  const ogImage = image || `${BASE_URL}/og/default.webp`;

  const schemas: object[] = [websiteSchema()];
  if (breadcrumbs && breadcrumbs.length > 0) schemas.push(breadcrumbSchema(breadcrumbs));
  if (structuredData) {
    if (Array.isArray(structuredData)) schemas.push(...structuredData);
    else schemas.push(structuredData);
  }

  return (
    <Helmet>
      <title>{fullTitle}</title>
      <meta name="description" content={description} />
      <meta name="application-name" content={SITE_NAME} />
      <meta name="theme-color" content="#282828" />
      <link rel="canonical" href={canonicalUrl} />
      {noindex && <meta name="robots" content="noindex,nofollow" />}

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
      <meta property="og:locale" content={SITE_LOCALE} />

      {/* Twitter Card */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={ogImage} />

      {/* Structured Data — one <script> per schema for max compatibility */}
      {schemas.map((s, i) => (
        <script key={i} type="application/ld+json">
          {JSON.stringify(s)}
        </script>
      ))}
    </Helmet>
  );
}
