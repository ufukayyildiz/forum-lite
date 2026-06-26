# forum-lite

**A serverless, SEO-ready forum engine for Cloudflare Workers, D1, R2 and React.**

forum-lite is a compact open-source forum that runs as a single Cloudflare Worker. It ships the React frontend, Hono API, D1 database schema, optional R2 attachments, optional Cloudflare Email, admin tools, ads, sitemaps, dynamic Open Graph images and structured data in one deployable app.

> Terminal-inspired Gruvbox Dark UI with dense tables, numbered lists, monospace content and fast navigation.

---

## Features

- Threads, replies, likes, quotes and markdown rendering
- Categories, tags, member profiles, avatars, bios and search
- PBKDF2 password hashing and D1-backed session storage
- Role system: `member`, `moderator`, `admin`
- Admin dashboard for stats, users, categories, tags, settings, ads and logs
- AdSense-compatible ad management, per-thread ad intervals and dynamic `ads.txt`
- Cloudflare Email support for welcome emails and password reset emails without reset links
- R2 file attachments for images and PDFs, with inline rendering and DOMPurify XSS protection
- SEO routes: Open Graph, canonical URLs, JSON-LD, sitemap index and `robots.txt`
- Public-safe Cloudflare config with placeholder IDs and runtime bindings

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Cloudflare Workers |
| Backend | Hono |
| Database | Cloudflare D1 |
| ORM | Drizzle ORM |
| Storage | Cloudflare R2 |
| Frontend | React 18 + Vite 6 |
| Routing | React Router 7 |
| Data fetching | TanStack Query 5 |
| Validation | Zod |
| Auth | PBKDF2 / Web Crypto API, DB-backed session token |
| Styling | Custom CSS, Gruvbox Dark, JetBrains Mono |

---

## Project Structure

```text
forum-lite/
├── src/
│   ├── worker/                  # Hono backend for Cloudflare Workers
│   │   ├── index.ts             # Worker entry point
│   │   ├── routes/              # auth, categories, threads, posts,
│   │   │                        # members, search, tags, attachments, admin
│   │   ├── lib/
│   │   │   ├── auth.ts          # PBKDF2, session tokens, safeISO()
│   │   │   ├── email.ts         # Cloudflare Email integration
│   │   │   ├── seo.ts           # Server-rendered SEO HTML
│   │   │   └── middleware.ts    # Auth middleware and RBAC
│   │   ├── db/
│   │   │   ├── schema.ts        # Drizzle schema
│   │   │   └── index.ts
│   │   └── types.ts             # DB, BUCKET, SEND_EMAIL, ASSETS bindings
│   └── client/                  # React SPA
│       ├── main.tsx             # Routes
│       ├── index.css            # Gruvbox Dark CSS system
│       ├── lib/
│       │   ├── api.ts           # Typed fetch client
│       │   ├── sanitize.ts      # DOMPurify markdown renderer
│       │   └── useAuth.ts
│       ├── components/
│       └── pages/               # Public pages and admin pages
├── migrations/                  # Drizzle D1 SQL migrations
├── scripts/                     # Local seed, import and OG tooling
├── wrangler.jsonc               # Public-safe Worker config
├── wrangler.local.example.jsonc # Local development template
└── package.json
```

---

## Binding Architecture

External services are accessed through Cloudflare Worker bindings, not hardcoded credentials.

| Binding | Type | Required | Purpose |
|---|---|---|---|
| `DB` | D1 Database | Yes | Forum data |
| `BUCKET` | R2 Bucket | No | Attachments and Open Graph images |
| `SEND_EMAIL` | Send Email | No | Transactional email |
| `ASSETS` | Static Assets | Yes | React SPA assets |

The application reads `env.DB`, `env.BUCKET` and `env.SEND_EMAIL` at runtime. No database password, token or connection string is committed.

For public repositories, keep live Cloudflare IDs, API tokens and environment-specific values in Worker secrets or dashboard variables instead of committed config files.

Sessions are stored in D1 as random tokens. You do not need a `SESSION_SECRET` or any extra secret to run the default setup.

---

## Requirements

- [Node.js](https://nodejs.org) 18+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)
- [Cloudflare account](https://dash.cloudflare.com/sign-up)

---

## Install And Deploy

### 1. Fork

Click **Fork** on GitHub and create your own copy:

```text
https://github.com/YOUR_NAME/forum-lite.git
```

### 2. Clone And Install

```bash
git clone https://github.com/YOUR_NAME/forum-lite.git
cd forum-lite/forum-lite
npm install
```

### 3. First Deploy

```bash
npx wrangler login
npm run deploy
```

Wrangler uploads the Worker and prints a URL similar to:

```text
https://forum-lite.YOUR_ACCOUNT.workers.dev
```

At this point the app still needs D1 and optional service bindings.

---

## Cloudflare Bindings

Open [dash.cloudflare.com](https://dash.cloudflare.com), then go to **Workers & Pages → forum-lite → Settings → Bindings**.

### D1 Database

Create a D1 database:

```bash
npx wrangler d1 create forum-db
```

Copy the returned `database_id` for migrations and local development.

Dashboard binding:

```text
Type: D1 Database
Binding name: DB
Database: forum-db
```

### R2 Bucket

Skip this step if you do not want file uploads.

```bash
npx wrangler r2 bucket create forum-lite-uploads
```

Dashboard binding:

```text
Type: R2 Bucket
Binding name: BUCKET
Bucket: forum-lite-uploads
```

### Cloudflare Email

Use this for password reset emails and welcome emails.

```bash
npx wrangler email sending enable example.com
npx wrangler email sending dns get example.com
```

Dashboard binding:

```text
Type: Send Email
Binding name: SEND_EMAIL
From: noreply@example.com
```

If the email binding is missing, the forum still works. Email features fail silently and never block requests.

### Self-Hosted Email Verification

The admin Email Verify screen always runs local preflight checks: syntax, common typo domains, disposable domains, MX, A and AAAA. For mailbox-level no-send checks, run the included self-hosted SMTP verifier on a server where outbound TCP port 25 is allowed. Cloudflare Workers cannot perform recipient-MX SMTP handshakes directly, so the Worker calls this service over HTTPS.

```bash
EMAIL_VERIFY_SECRET="change-me" \
EMAIL_VERIFY_FROM="verify@example.com" \
EMAIL_VERIFY_HELO="example.com" \
npm run email:verifier
```

Expose the verifier behind HTTPS, then configure the Worker:

```bash
npx wrangler secret put EMAIL_VERIFY_SECRET
npx wrangler secret put EMAIL_VERIFY_FROM
npx wrangler secret put EMAIL_VERIFY_HELO
```

Set `EMAIL_VERIFY_ENDPOINT` as a non-secret dashboard variable, for example:

```text
EMAIL_VERIFY_ENDPOINT=https://verify.example.com/verify
```

No email content is sent by this verifier. It resolves MX records, opens SMTP, runs `EHLO`, `MAIL FROM`, `RCPT TO`, optionally probes catch-all behavior, then quits before `DATA`. Some providers intentionally hide mailbox status or accept all recipients, so those results are marked as review/risky instead of safe.

### Public Config Note

The tracked `wrangler.jsonc` only contains binding names, public example values and a placeholder D1 database ID. Keep real Cloudflare IDs in ignored local files or in the Cloudflare dashboard.

---

## Migrations

Apply D1 migrations after the database exists:

```bash
npx wrangler d1 migrations apply forum-db --remote --migrations-dir=migrations
```

Deploy once more after bindings are connected:

```bash
npm run deploy
```

---

## First Admin User

Create an account from `/register`, then grant admin access:

```bash
npx wrangler d1 execute forum-db --remote \
  --command "UPDATE users SET role='admin' WHERE username='YOUR_USERNAME';"
```

Open `/admin` in the browser.

---

## Admin Settings

Most runtime configuration is managed from `/admin/settings` and does not require a redeploy.

General settings:

| Setting | Description |
|---|---|
| `forum_title` | Forum title used in the UI |
| `forum_description` | Short SEO description |
| `registration_open` | `true` to allow registration |
| `maintenance_mode` | `true` to restrict access to admins |
| `threads_per_page` | Threads per page |
| `posts_per_page` | Replies per page |

Email settings:

| Setting | Description |
|---|---|
| `email_from` | Verified sender address |
| `site_url` | Public site URL used in emails |

Upload settings:

| Setting | Description |
|---|---|
| `uploads_enabled` | `true` to enable uploads |
| `max_attachment_size_mb` | Maximum attachment size |
| `allowed_file_types` | Allowed extensions, for example `jpg,jpeg,png,gif,webp,pdf` |

---

## Custom Domain

Go to **forum-lite → Settings → Domains & Routes → Add → Custom Domain**.

If the domain is already on Cloudflare DNS, Workers can connect it automatically.

---

## Local Development

Local development is optional. It is useful when changing code or testing migrations.

```bash
cp wrangler.local.example.jsonc wrangler.local.jsonc
```

Paste your D1 `database_id` into `wrangler.local.jsonc`. This file is ignored by Git and must not be committed.

Run local migrations and seed data:

```bash
npm run db:migrate:local
npm run seed:local
```

Start the development server:

```bash
npm run dev
```

Open `http://localhost:5173`.

Grant local admin access:

```bash
npx wrangler d1 execute forum-db \
  --local \
  --config wrangler.local.jsonc \
  --command "UPDATE users SET role='admin' WHERE username='YOUR_USERNAME';"
```

---

## Database Commands

```bash
# Generate a migration after schema changes
npm run db:generate

# Apply local migrations
npm run db:migrate:local

# Apply remote migrations
npm run db:migrate:remote
```

---

## API Routes

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/register` | Public | Create account |
| POST | `/api/auth/login` | Public | Sign in |
| POST | `/api/auth/logout` | Session | Sign out |
| POST | `/api/auth/reset-password` | Public | Email a new temporary password |
| GET | `/api/auth/me` | Session | Current user |
| GET | `/api/categories` | Public | Categories |
| GET | `/api/threads` | Public | Thread list |
| POST | `/api/threads` | Member | Create thread |
| GET | `/api/threads/:id` | Public | Thread detail |
| PATCH | `/api/threads/:id` | Admin/mod | Edit thread |
| DELETE | `/api/threads/:id` | Admin/mod | Delete thread |
| GET | `/api/posts` | Public | Replies for a thread |
| POST | `/api/posts` | Member | Add reply |
| PATCH | `/api/posts/:id` | Owner/admin/mod | Edit reply |
| DELETE | `/api/posts/:id` | Owner/admin/mod | Delete reply |
| POST | `/api/posts/:id/like` | Member | Toggle like |
| GET | `/api/members` | Public | Member list |
| GET | `/api/members/:username` | Public | Member profile |
| PATCH | `/api/members/:username` | Owner/admin | Edit profile |
| GET | `/api/search` | Public | Search |
| GET | `/api/tags` | Public | Tag list |
| GET | `/api/tags/:slug` | Public | Threads by tag |
| POST | `/api/attachments/upload` | Member | Upload to R2 |
| GET | `/api/attachments/:id` | Public | Serve attachment |
| GET/PATCH | `/api/admin/users` | Admin | User management |
| GET/POST/PUT/DELETE | `/api/admin/categories` | Admin | Category CRUD |
| GET/POST/DELETE | `/api/admin/tags` | Admin | Tag CRUD |
| GET | `/api/admin/logs` | Admin | Activity logs |
| GET/POST | `/api/admin/settings` | Admin | Site settings |

---

## Frontend Routes

| Route | Page |
|---|---|
| `/` | Thread list |
| `/c/:id` | Category threads |
| `/t/:id` | Thread detail and replies |
| `/new-thread` | Create thread |
| `/members` | Member list |
| `/u/:username` | Member profile |
| `/login` / `/register` | Auth |
| `/search` | Search |
| `/tags` / `/tag/:slug` | Tags |
| `/admin/*` | Admin panel |

---

## SEO

forum-lite includes:

- Server-rendered SEO HTML for crawlers and social previews
- Page-level titles, descriptions and canonical URLs
- Open Graph and Twitter Card metadata
- Dynamic WebP thread cards at `/og/thread/:publicId.webp`
- `DiscussionForumPosting`, `ProfilePage`, `CollectionPage`, `ItemList`, `BreadcrumbList` and `WebSite` JSON-LD
- `/robots.txt`
- `/sitemap.xml` and sitemap index files
- Dynamic `ads.txt`

Run the public launch checklist in the root [SEO.md](../SEO.md) before making a production site public.

---

## Architecture Notes

- **Single Worker app:** React assets and Hono API ship together. No separate API domain is required.
- **D1 timestamps:** D1 values may arrive as Unix epoch integers or strings. `safeISO()` handles both.
- **DB-backed sessions:** Session tokens are stored in D1. No HMAC secret is required for the default session flow.
- **Markdown safety:** Rendered markdown is sanitized with DOMPurify.
- **Runtime bindings:** Cloudflare service access goes through `env.DB`, `env.BUCKET` and `env.SEND_EMAIL`.
- **Public-safe config:** tracked config uses placeholders; real IDs stay out of public source.

---

## Known Limits

- No WebSocket realtime updates.
- Free Workers plans have CPU limits. Large admin queries may need a paid plan.
- Demo seed users have placeholder password hashes. Register a new account to sign in.

---

## License

MIT
