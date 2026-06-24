# SEO And Public Launch Checklist

This file covers two surfaces:

1. **Application SEO** for deployed forum sites.
2. **GitHub discovery SEO** for getting more stars, forks and search traffic.

## Application SEO

forum-lite already ships with the core technical SEO pieces a public forum needs:

- Page-level `<title>`, meta description and canonical URL via `react-helmet-async`
- Server-rendered fallback HTML for crawlers and social previews
- Open Graph and Twitter Card metadata
- Dynamic WebP social images for threads: `/og/thread/:publicId.webp`
- Fallback social image: `forum-lite/public/og-default.webp`
- JSON-LD structured data:
  - `WebSite`
  - `CollectionPage`
  - `ItemList`
  - `DiscussionForumPosting`
  - `ProfilePage`
  - `BreadcrumbList`
- Sitemap index:
  - `/sitemap.xml`
  - `/sitemap-index.xml`
- Split sitemap files:
  - `/sitemap-general.xml`
  - `/sitemap-categories.xml`
  - `/sitemap-threads.xml`
  - `/sitemap-users.xml`
  - `/sitemap-tags.xml`
- `/robots.txt` with host-aware absolute sitemap URL
- `/ads.txt` generated from Admin Ads settings

## Application Launch Checklist

1. Connect the custom domain.
2. Open `/robots.txt` and confirm the sitemap URL uses the final domain.
3. Open `/sitemap.xml` and confirm every child sitemap returns `200`.
4. Open a thread page source and confirm:
   - canonical URL is clean
   - `og:image` is a WebP URL
   - `DiscussionForumPosting` JSON-LD exists
5. Open a profile page source and confirm `ProfilePage` JSON-LD exists.
6. Replace `forum-lite/public/og-default.webp` with a branded default card if needed.
7. Regenerate thread cards after bulk imports:

   ```bash
   npm --prefix forum-lite run og:webp:upload -- --clean
   ```

8. Configure Google Search Console and submit `https://YOUR_DOMAIN/sitemap.xml`.
9. Configure Bing Webmaster Tools if organic search is important.
10. If AdSense is enabled, set `ads.txt` and ad HTML under `/admin/ads`.
11. Remove old demo/test URLs from Search Console if they were indexed.

## Page Type Matrix

| Page | Canonical | Structured data | Index |
|---|---|---|---|
| `/` | Yes | `CollectionPage`, `ItemList`, `WebSite` | Yes |
| `/c/:id` | Yes | `CollectionPage`, `ItemList`, breadcrumb | Yes |
| `/t/:id` | Yes | `DiscussionForumPosting`, breadcrumb | Yes |
| `/members` | Yes | `CollectionPage`, breadcrumb | Yes |
| `/u/:username` | Yes | `ProfilePage`, breadcrumb | Yes |
| `/tag/:slug` | Yes | `CollectionPage`, `ItemList`, breadcrumb | Yes |
| `/search` | Yes | `WebSite` | Yes |
| `/admin/*` | No | None | No |
| `/api/*` | No | None | No |

## Content SEO Rules

- Write thread titles like search queries people would actually type.
- Put the best summary in the first post; it becomes the search snippet.
- Keep category names short and descriptive.
- Avoid empty categories on public launch.
- Audit public profiles if user pages are indexable.
- Keep tag names normalized and useful; do not create spammy tag pages.

## GitHub README SEO

The root README should target these search phrases naturally:

- Cloudflare Workers forum
- serverless forum software
- Cloudflare D1 forum
- React forum app
- Hono Cloudflare Worker starter
- SEO-ready open-source forum
- forum with Open Graph images
- forum with sitemap and structured data

The first 160 characters matter. Recommended GitHub repo description:

> Serverless forum software for Cloudflare Workers, D1, R2 and React. SEO-ready, open-source, with admin tools, ads, sitemaps and dynamic Open Graph images.

Recommended topics:

`cloudflare-workers`, `cloudflare-d1`, `cloudflare-r2`, `hono`, `react`, `vite`, `forum`, `discussion-forum`, `serverless`, `seo`, `open-graph`, `sqlite`, `drizzle-orm`, `typescript`

## Star Strategy

- Keep the README first screen visual: short value prop, badges, preview image, fast install.
- Add a pinned demo link once the public demo is stable.
- Add screenshots or a short GIF under the intro.
- Add a concise architecture diagram if the repo starts getting technical traffic.
- Add `good first issue` and `help wanted` labels after public launch.
- Write one launch post focused on the angle: “A full forum on one Cloudflare Worker.”
- Submit to communities where Cloudflare, Hono, D1 and serverless builders hang out.

## Public Safety Notes

- Do not commit `wrangler.local.jsonc`, `.dev.vars`, `.wrangler/`, `dist/`, `node_modules/` or SQL dumps.
- Keep real Cloudflare IDs in local ignored files or the Cloudflare dashboard.
- D1 database IDs are not passwords, but they still do not belong in public tracked files.
- If an old private history contains real IDs or generated artifacts, publish a clean orphan public branch before making the repo public.
