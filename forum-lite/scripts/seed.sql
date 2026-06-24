-- Local dev seed data. Apply with:
--   npx wrangler d1 execute forum-db --local --config wrangler.local.jsonc --file=scripts/seed.sql
--
-- NOTE: Demo users have placeholder password hashes.
--       Register a new account at /register to get a working login.

-- Users
INSERT OR IGNORE INTO users
  (public_id, username, email, password_hash, display_name, bio, role, post_count, thread_count, created_at)
VALUES
  ('194358', 'admin',      'admin@forum.local',   'pbkdf2$100000$dummy$dummy',
   'Admin',      'Forum administrator. I keep the demo instance tidy and test moderation flows.',
   'admin',      42, 15, strftime('%s','now','-30 days')),
  ('264035', 'terminalist','terminal@forum.local','pbkdf2$100000$dummy$dummy',
   'Terminalist', 'I write, code and read email in terminal-first tools.',
   'moderator',  38, 12, strftime('%s','now','-25 days')),
  ('333712', 'rustacean',  'rust@forum.local',    'pbkdf2$100000$dummy$dummy',
   'Rustacean',  'Systems programming, memory safety and practical backend work.',
   'member',     27,  9, strftime('%s','now','-20 days')),
  ('403389', 'linuxuser',  'linux@forum.local',   'pbkdf2$100000$dummy$dummy',
   'Linux User', 'Linux, shells and small reliable tools.',
   'member',     19,  6, strftime('%s','now','-15 days')),
  ('473066', 'edgebuilder','edge@forum.local',    'pbkdf2$100000$dummy$dummy',
   'Edge Builder','Cloudflare Workers, D1, R2, CI/CD and infrastructure as code.',
   'member',     11,  4, strftime('%s','now','-10 days'));

-- Categories
INSERT OR IGNORE INTO categories
  (public_id, name, slug, description, color, icon, position, created_at)
VALUES
  ('9932', 'General',          'general',     'Open discussion for forum members.',                         '#fabd2f', 'MessageSquare', 0, strftime('%s','now','-30 days')),
  ('8851', 'Linux & Systems',  'linux',       'Linux, shell scripts and system administration.',             '#83a598', 'Terminal',      1, strftime('%s','now','-30 days')),
  ('7770', 'Programming',      'programming', 'Languages, frameworks, architecture and algorithms.',         '#b8bb26', 'Code',          2, strftime('%s','now','-30 days')),
  ('6689', 'DevOps & Cloud',   'devops',      'CI/CD, containers, deployments and cloud infrastructure.',    '#fe8019', 'Cloud',         3, strftime('%s','now','-30 days')),
  ('5608', 'Showcase',         'showcase',    'Share projects and collect feedback from the community.',     '#d3869b', 'Rocket',        4, strftime('%s','now','-30 days'));

-- Tags
INSERT OR IGNORE INTO tags (name, slug, created_at) VALUES
  ('vim',        'vim',        strftime('%s','now','-30 days')),
  ('rust',       'rust',       strftime('%s','now','-28 days')),
  ('linux',      'linux',      strftime('%s','now','-27 days')),
  ('terminal',   'terminal',   strftime('%s','now','-26 days')),
  ('docker',     'docker',     strftime('%s','now','-25 days')),
  ('kubernetes', 'kubernetes', strftime('%s','now','-24 days')),
  ('typescript', 'typescript', strftime('%s','now','-23 days')),
  ('python',     'python',     strftime('%s','now','-22 days')),
  ('cloudflare', 'cloudflare', strftime('%s','now','-20 days')),
  ('arch',       'arch',       strftime('%s','now','-18 days'));

-- Threads
INSERT OR IGNORE INTO threads
  (public_id, category_id, user_id, title, slug, content, pinned, featured, views, reply_count, created_at, updated_at, last_post_at)
VALUES
  ('160616',
   (SELECT id FROM categories WHERE slug='general'), (SELECT id FROM users WHERE username='terminalist'),
   'Share your Vim setup', 'share-your-vim-setup',
   'Hello everyone! This thread is for sharing Vim and terminal editor setups. I have used the same .vimrc for years, but I am still looking for small improvements.

**My setup:**
- Plugin manager: vim-plug
- Color scheme: gruvbox
- Plugins: NERDTree, vim-airline, fzf.vim, coc.nvim

What does your setup look like?',
   1, 0, 247, 4,
   strftime('%s','now','-20 days'), strftime('%s','now','-2 days'), strftime('%s','now','-2 days')),

  ('208887',
   (SELECT id FROM categories WHERE slug='programming'), (SELECT id FROM users WHERE username='rustacean'),
   'Best resources for learning Rust', 'best-resources-for-learning-rust',
   'I put together a short resource list for people learning Rust.

1. **The Rust Programming Language** - the official free book
2. **Rustlings** - small exercises
3. **Rust by Example** - practical snippets
4. **Zero to Production in Rust** - web application development

Where did you start?',
   0, 0, 189, 3,
   strftime('%s','now','-18 days'), strftime('%s','now','-3 days'), strftime('%s','now','-3 days')),

  ('257158',
   (SELECT id FROM categories WHERE slug='devops'), (SELECT id FROM users WHERE username='edgebuilder'),
   'Techniques for smaller Docker images', 'techniques-for-smaller-docker-images',
   'Docker image size matters in production. These are the techniques I use most often:

**Multi-stage build:**
```dockerfile
FROM rust:1.75 AS builder
WORKDIR /app
COPY . .
RUN cargo build --release

FROM debian:bookworm-slim
COPY --from=builder /app/target/release/myapp /usr/local/bin/
CMD ["myapp"]
```

This approach reduced one image from 1.2 GB to 45 MB.',
   0, 1, 312, 5,
   strftime('%s','now','-15 days'), strftime('%s','now','-1 days'), strftime('%s','now','-1 days')),

  ('305429',
   (SELECT id FROM categories WHERE slug='linux'), (SELECT id FROM users WHERE username='linuxuser'),
   'Arch Linux install notes for 2025', 'arch-linux-install-notes-2025',
   'I update my Arch Linux install notes every year. The archinstall script is much better now, but a manual install is still useful for learning.

**Basic steps:**
1. Download the ISO and prepare a boot USB
2. Partition the disk (GPT + EFI)
3. Install the base system
4. Configure the bootloader
5. Create a user and sudo rules',
   0, 0, 156, 2,
   strftime('%s','now','-12 days'), strftime('%s','now','-4 days'), strftime('%s','now','-4 days')),

  ('353700',
   (SELECT id FROM categories WHERE slug='programming'), (SELECT id FROM users WHERE username='admin'),
   'Underused TypeScript features', 'underused-typescript-features',
   'A few TypeScript features have been especially useful in everyday work:

**Template literal types:**
```typescript
type EventName = `on${Capitalize<string>}`;
```

**The satisfies operator (TS 4.9+):**
```typescript
const config = { port: 3000, host: "localhost" } satisfies Record<string, string | number>;
```',
   0, 0, 203, 3,
   strftime('%s','now','-8 days'), strftime('%s','now','-5 days'), strftime('%s','now','-5 days')),

  ('401971',
   (SELECT id FROM categories WHERE slug='showcase'), (SELECT id FROM users WHERE username='admin'),
   'A serverless forum on Cloudflare Workers', 'serverless-forum-cloudflare-workers',
   'This forum runs on Cloudflare Workers. A few reasons the architecture works well:

**Why Workers?**
- Global edge network and low latency
- Generous free tier
- D1 for SQLite-style relational data
- R2 for object storage
- Wrangler for straightforward deployments',
   0, 0, 278, 4,
   strftime('%s','now','-5 days'), strftime('%s','now','-1 days'), strftime('%s','now','-1 days'));

-- Posts (replies)
INSERT OR IGNORE INTO posts (thread_id, user_id, content, like_count, created_at) VALUES
  ((SELECT id FROM threads WHERE public_id='160616'), (SELECT id FROM users WHERE username='admin'),
   'I use gruvbox too. vim-surround and vim-commentary are the two plugins I miss immediately on a clean machine.',
   5, strftime('%s','now','-19 days')),
  ((SELECT id FROM threads WHERE public_id='160616'), (SELECT id FROM users WHERE username='rustacean'),
   'Are you considering Neovim? Lua config feels strange at first, but lazy.nvim makes plugin management pleasant.',
   8, strftime('%s','now','-18 days')),
  ((SELECT id FROM threads WHERE public_id='160616'), (SELECT id FROM users WHERE username='linuxuser'),
   'My .vimrc passed 500 lines and I still have not moved it to Neovim. This thread may finally motivate me.',
   3, strftime('%s','now','-15 days')),
  ((SELECT id FROM threads WHERE public_id='160616'), (SELECT id FROM users WHERE username='edgebuilder'),
   'I have been testing Helix. Built-in LSP support is refreshing when you want fewer plugins.',
   2, strftime('%s','now','-2 days')),

  ((SELECT id FROM threads WHERE public_id='208887'), (SELECT id FROM users WHERE username='terminalist'),
   '"Programming Rust" from O''Reilly is also excellent, especially for ownership and lifetime explanations.',
   6, strftime('%s','now','-17 days')),
  ((SELECT id FROM threads WHERE public_id='208887'), (SELECT id FROM users WHERE username='linuxuser'),
   'The borrow checker was the hardest part for me. It makes more sense once you build a few small tools.',
   4, strftime('%s','now','-16 days')),
  ((SELECT id FROM threads WHERE public_id='208887'), (SELECT id FROM users WHERE username='admin'),
   'Tokio documentation is helpful for async Rust. A tiny CLI tool or web service is the best learning path.',
   7, strftime('%s','now','-3 days')),

  ((SELECT id FROM threads WHERE public_id='257158'), (SELECT id FROM users WHERE username='admin'),
   'Distroless base images are worth testing. Removing shells and package managers shrinks the attack surface.',
   9, strftime('%s','now','-14 days')),
  ((SELECT id FROM threads WHERE public_id='257158'), (SELECT id FROM users WHERE username='terminalist'),
   'Do not skip .dockerignore. Keeping node_modules, .git and test fixtures out of the build context matters.',
   11, strftime('%s','now','-13 days')),
  ((SELECT id FROM threads WHERE public_id='257158'), (SELECT id FROM users WHERE username='rustacean'),
   'cargo-chef is very good for Rust image caching. Dependencies can live in a separate layer.',
   13, strftime('%s','now','-12 days')),
  ((SELECT id FROM threads WHERE public_id='257158'), (SELECT id FROM users WHERE username='linuxuser'),
   'I prefer Debian slim over Alpine now. musl/glibc differences can make debugging harder than expected.',
   8, strftime('%s','now','-11 days')),
  ((SELECT id FROM threads WHERE public_id='257158'), (SELECT id FROM users WHERE username='edgebuilder'),
   'Enable BuildKit when you can: DOCKER_BUILDKIT=1. Parallel build and improved cache behavior help a lot.',
   10, strftime('%s','now','-1 days')),

  ((SELECT id FROM threads WHERE public_id='305429'), (SELECT id FROM users WHERE username='terminalist'),
   'systemd-boot is much simpler than GRUB for many EFI setups. The configuration is easy to read.',
   5, strftime('%s','now','-11 days')),
  ((SELECT id FROM threads WHERE public_id='305429'), (SELECT id FROM users WHERE username='admin'),
   'Add reflector to the guide. A fresh mirror list can make install and update speed dramatically better.',
   4, strftime('%s','now','-4 days')),

  ((SELECT id FROM threads WHERE public_id='353700'), (SELECT id FROM users WHERE username='terminalist'),
   'The Infer utility type is another good one. It is perfect for deriving types from Zod schemas.',
   7, strftime('%s','now','-7 days')),
  ((SELECT id FROM threads WHERE public_id='353700'), (SELECT id FROM users WHERE username='linuxuser'),
   'Could you add discriminated unions? They are powerful for modeling API responses.',
   3, strftime('%s','now','-6 days')),
  ((SELECT id FROM threads WHERE public_id='353700'), (SELECT id FROM users WHERE username='rustacean'),
   'Const assertions are underrated too. readonly tuples and literal types become much easier.',
   9, strftime('%s','now','-5 days')),

  ((SELECT id FROM threads WHERE public_id='401971'), (SELECT id FROM users WHERE username='terminalist'),
   'A Workers KV thread would be useful too. For sessions, would you choose KV or D1?',
   4, strftime('%s','now','-4 days')),
  ((SELECT id FROM threads WHERE public_id='401971'), (SELECT id FROM users WHERE username='rustacean'),
   'D1 SQL support is better than I expected. Drizzle makes the developer experience clean.',
   11, strftime('%s','now','-3 days')),
  ((SELECT id FROM threads WHERE public_id='401971'), (SELECT id FROM users WHERE username='linuxuser'),
   'Wrangler 4 local development is smooth. D1, R2 and KV simulation covers most cases before deploy.',
   8, strftime('%s','now','-2 days')),
  ((SELECT id FROM threads WHERE public_id='401971'), (SELECT id FROM users WHERE username='edgebuilder'),
   'Workers Analytics Engine is worth exploring for lightweight metrics without adding a separate service.',
   6, strftime('%s','now','-1 days'));

-- Thread-Tag associations
INSERT OR IGNORE INTO thread_tags (thread_id, tag_id)
SELECT t.id, tg.id FROM threads t, tags tg
WHERE t.public_id='160616' AND tg.slug IN ('vim','terminal');

INSERT OR IGNORE INTO thread_tags (thread_id, tag_id)
SELECT t.id, tg.id FROM threads t, tags tg
WHERE t.public_id='208887' AND tg.slug='rust';

INSERT OR IGNORE INTO thread_tags (thread_id, tag_id)
SELECT t.id, tg.id FROM threads t, tags tg
WHERE t.public_id='257158' AND tg.slug IN ('docker','kubernetes');

INSERT OR IGNORE INTO thread_tags (thread_id, tag_id)
SELECT t.id, tg.id FROM threads t, tags tg
WHERE t.public_id='305429' AND tg.slug IN ('linux','arch');

INSERT OR IGNORE INTO thread_tags (thread_id, tag_id)
SELECT t.id, tg.id FROM threads t, tags tg
WHERE t.public_id='353700' AND tg.slug='typescript';

INSERT OR IGNORE INTO thread_tags (thread_id, tag_id)
SELECT t.id, tg.id FROM threads t, tags tg
WHERE t.public_id='401971' AND tg.slug='cloudflare';

-- Settings
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('forum_title',           'forum-lite'),
  ('forum_description',     'Open-source forum software running on Cloudflare Workers.'),
  ('registration_open',     'true'),
  ('maintenance_mode',      'false'),
  ('threads_per_page',      '20'),
  ('posts_per_page',        '20'),
  ('uploads_enabled',       'true'),
  ('max_attachment_size_mb','5'),
  ('allowed_file_types',    'jpg,jpeg,png,gif,webp,pdf'),
  ('email_from',            'noreply@forum.local'),
  ('site_url',              'http://localhost:5173'),
  ('forum_contact_email',   'admin@forum.local');
