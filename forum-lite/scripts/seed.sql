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
   'Admin',      'Forum yoneticisi. Vim ve terminal tabanli araclar hakkinda her seyi bilirim.',
   'admin',      42, 15, strftime('%s','now','-30 days')),
  ('264035', 'vimmer',     'vimmer@forum.local',  'pbkdf2$100000$dummy$dummy',
   'Vimmer',     'Vim''i her sey icin kullaniyorum. Yazi yazmak, kod gelistirmek, e-posta okumak...',
   'moderator',  38, 12, strftime('%s','now','-25 days')),
  ('333712', 'rustacean',  'rust@forum.local',    'pbkdf2$100000$dummy$dummy',
   'Rustacean',  'Rust ile sistem programlama yapiyorum. Bellek guvenligi hayat kurtarir.',
   'member',     27,  9, strftime('%s','now','-20 days')),
  ('403389', 'linuxuser',  'linux@forum.local',   'pbkdf2$100000$dummy$dummy',
   'Linux User', 'Arch Linux kullanicisi. BTW.',
   'member',     19,  6, strftime('%s','now','-15 days')),
  ('473066', 'devopsguru', 'devops@forum.local',  'pbkdf2$100000$dummy$dummy',
   'DevOps Guru','Kubernetes, Docker, CI/CD. Altyapiyi kod olarak yonetiyorum.',
   'member',     11,  4, strftime('%s','now','-10 days'));

-- Categories
INSERT OR IGNORE INTO categories
  (public_id, name, slug, description, color, icon, position, created_at)
VALUES
  ('9932', 'Genel Tartisma', 'genel',      'Her konudan serbest tartisma.',                       '#fabd2f', 'MessageSquare', 0, strftime('%s','now','-30 days')),
  ('8851', 'Linux & Sistem', 'linux',       'Linux, kabuk betikleri, sistem yonetimi.',            '#83a598', 'Terminal',      1, strftime('%s','now','-30 days')),
  ('7770', 'Programlama',    'programlama', 'Diller, cerceveler, algoritma tartismalari.',         '#b8bb26', 'Code',          2, strftime('%s','now','-30 days')),
  ('6689', 'DevOps & Bulut', 'devops',      'CI/CD, konteyner, altyapi yonetimi.',                 '#fe8019', 'Cloud',         3, strftime('%s','now','-30 days')),
  ('5608', 'Proje Tanitimi', 'projeler',    'Kendi projelerinizi tanitin ve geri bildirim alin.', '#d3869b', 'Rocket',        4, strftime('%s','now','-30 days'));

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
   (SELECT id FROM categories WHERE slug='genel'), (SELECT id FROM users WHERE username='vimmer'),
   'Vim yapilandirmanizi paylasin', 'vim-yapilandirma',
   'Herkese merhaba! Bu konuda Vim yapilandirmalarimizi paylasabiliriz. Ben yillardir ayni .vimrc ile calisiyorum ama hala iyilestirme arayisindayim.

**Benim kurulumum:**
- Plugin yoneticisi: vim-plug
- Renk temasi: gruvbox
- Eklentiler: NERDTree, vim-airline, fzf.vim, coc.nvim

Sizinki nasil?',
   1, 0, 247, 4,
   strftime('%s','now','-20 days'), strftime('%s','now','-2 days'), strftime('%s','now','-2 days')),

  ('208887',
   (SELECT id FROM categories WHERE slug='programlama'), (SELECT id FROM users WHERE username='rustacean'),
   'Rust ogrenmek icin en iyi kaynaklar', 'rust-ogrenme-kaynaklari',
   'Rust ogrenmek isteyenler icin bir kaynak listesi hazirladim.

1. **The Rust Programming Language** (resmi kitap) - ucretsiz online
2. **Rustlings** - kucuk egzersizler
3. **Rust by Example** - pratik ornekler
4. **Zero to Production in Rust** - web uygulamasi gelistirme

Siz nereden basladinis?',
   0, 0, 189, 3,
   strftime('%s','now','-18 days'), strftime('%s','now','-3 days'), strftime('%s','now','-3 days')),

  ('257158',
   (SELECT id FROM categories WHERE slug='devops'), (SELECT id FROM users WHERE username='devopsguru'),
   'Docker imaj boyutunu kucultme teknikleri', 'docker-imaj-boyutu',
   'Production ortamlarinda Docker imaj boyutu buyuk onem tasir. Kullandigim teknikler:

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

Bu yontemle 1.2 GB imaji 45 MB''ye indirdim.',
   0, 1, 312, 5,
   strftime('%s','now','-15 days'), strftime('%s','now','-1 days'), strftime('%s','now','-1 days')),

  ('305429',
   (SELECT id FROM categories WHERE slug='linux'), (SELECT id FROM users WHERE username='linuxuser'),
   'Arch Linux kurulum rehberi 2025', 'arch-linux-kurulum-2025',
   'Her yil guncelledigim Arch Linux kurulum notlarimi paylasiyorum.

**Temel adimlar:**
1. ISO indir, boot USB hazirla
2. Disk bolümlendirme (GPT + EFI)
3. Base sistem kurulumu
4. Bootloader (systemd-boot oneriyorum)
5. Kullanici olusturma ve sudo ayarlari',
   0, 0, 156, 2,
   strftime('%s','now','-12 days'), strftime('%s','now','-4 days'), strftime('%s','now','-4 days')),

  ('353700',
   (SELECT id FROM categories WHERE slug='programlama'), (SELECT id FROM users WHERE username='admin'),
   'TypeScript''te az bilinen ozellikler', 'typescript-az-bilinen-ozellikler',
   'Gunluk TypeScript kullanimimda cok ise yarayan ama cogu kisinin bilmedigi bazi ozellikler:

**Template literal types:**
```typescript
type EventName = `on${Capitalize<string>}`;
```

**Satisfies operatoru (TS 4.9+):**
```typescript
const config = { port: 3000, host: "localhost" } satisfies Record<string, string | number>;
```',
   0, 0, 203, 3,
   strftime('%s','now','-8 days'), strftime('%s','now','-5 days'), strftime('%s','now','-5 days')),

  ('401971',
   (SELECT id FROM categories WHERE slug='projeler'), (SELECT id FROM users WHERE username='admin'),
   'Cloudflare Workers ile serverless forum', 'cloudflare-workers-forum',
   'Bu forumun kendisi Cloudflare Workers uzerinde calisiyor. Gelistirme surecinde ogrendiklerimi paylasmak istedim.

**Neden Workers?**
- Global edge agi, dusuk gecikme
- Ucretsiz tier oldukca comert (100k istek/gun)
- D1 ile SQLite veritabani
- R2 ile object storage
- Wrangler ile kolay deploy',
   0, 0, 278, 4,
   strftime('%s','now','-5 days'), strftime('%s','now','-1 days'), strftime('%s','now','-1 days'));

-- Posts (replies)
INSERT OR IGNORE INTO posts (thread_id, user_id, content, like_count, created_at) VALUES
  (1, (SELECT id FROM users WHERE username='admin'),
   'Ben de gruvbox kullaniyorum! Buna ek olarak vim-surround ve vim-commentary eklentileri olmadan calisanim artik.',
   5, strftime('%s','now','-19 days')),
  (1, (SELECT id FROM users WHERE username='rustacean'),
   'Neovim''e gecmeyi dusunuyor musunuz? Lua konfigurasyonu basta karmisik geliyor ama lazy.nvim ile plugin yonetimi cok kolaylasiyor.',
   8, strftime('%s','now','-18 days')),
  (1, (SELECT id FROM users WHERE username='linuxuser'),
   'Benim .vimrc''im 500 satiri gecti, bir turlu Neovim''e tasiyadim. fzf.vim onerisi icin tesekkurler.',
   3, strftime('%s','now','-15 days')),
  (1, (SELECT id FROM users WHERE username='devopsguru'),
   'Helix editorunu denemek istiyorum. Built-in LSP destegi varmis, plugin gerekmiyor. Birisi kullaniyor mu?',
   2, strftime('%s','now','-2 days')),

  (2, (SELECT id FROM users WHERE username='vimmer'),
   '"Programming Rust" kitabini da oneririm, O''Reilly yayinindan. Ozellikle lifetime ve ownership konularini cok iyi anlatiyor.',
   6, strftime('%s','now','-17 days')),
  (2, (SELECT id FROM users WHERE username='linuxuser'),
   'Rust ogrenirken en cok borrow checker ile savastim. Pratik yapinca oturuyor.',
   4, strftime('%s','now','-16 days')),
  (2, (SELECT id FROM users WHERE username='admin'),
   'async/await kismi icin Tokio dokumantasyonu da cok guzel. Mini projeler yaparak ogrenmek en etkili yontem.',
   7, strftime('%s','now','-3 days')),

  (3, (SELECT id FROM users WHERE username='admin'),
   'Distroless base imajlari da denemeye deger. Shell bile icermiyorlar, saldiri yuzeyi minimuma iniyor.',
   9, strftime('%s','now','-14 days')),
  (3, (SELECT id FROM users WHERE username='vimmer'),
   '.dockerignore dosyasini da atlamayin. node_modules, .git, test dosyalari build context''e girmesin.',
   11, strftime('%s','now','-13 days')),
  (3, (SELECT id FROM users WHERE username='rustacean'),
   'cargo-chef ile Rust projelerinde layer cache''leme yapabilirsiniz. Bagimliliklar ayri katmanda, CI sureleri dusuyor.',
   13, strftime('%s','now','-12 days')),
  (3, (SELECT id FROM users WHERE username='linuxuser'),
   'Alpine yerine Debian slim tercih ediyorum artik. musl libc bazen glibc bagimliliklaariyla cakisiyor.',
   8, strftime('%s','now','-11 days')),
  (3, (SELECT id FROM users WHERE username='devopsguru'),
   'Buildkit''i etkinlestirmeyi unutmayin: DOCKER_BUILDKIT=1. Paralel build ve gelismis cache ozellikleri.',
   10, strftime('%s','now','-1 days')),

  (4, (SELECT id FROM users WHERE username='vimmer'),
   'systemd-boot gercekten GRUB''a gore cok daha hizli. EFI stub ile neredeyse aninda gecis.',
   5, strftime('%s','now','-11 days')),
  (4, (SELECT id FROM users WHERE username='admin'),
   'reflector ile mirror listesini guncel tutmayi da ekleyin rehbere. Kurulum hizini ciddi artiriyor.',
   4, strftime('%s','now','-4 days')),

  (5, (SELECT id FROM users WHERE username='vimmer'),
   'Infer utility type''i da cok kullanisli. Zod semasından tip turetmek icin: type User = z.infer<typeof userSchema>',
   7, strftime('%s','now','-7 days')),
  (5, (SELECT id FROM users WHERE username='linuxuser'),
   'Discriminated union''lar hakkinda bir sey ekleyebilir misiniz? API response''larini modellemek icin guclu.',
   3, strftime('%s','now','-6 days')),
  (5, (SELECT id FROM users WHERE username='rustacean'),
   'const assertion (as const) da az kullaniliyor. readonly tuple ve literal type''lar icin guzel.',
   9, strftime('%s','now','-5 days')),

  (6, (SELECT id FROM users WHERE username='vimmer'),
   'Workers KV icin de bir konu acabilirsiniz. Session yonetimi icin KV mi D1 mi tercih edersiniz?',
   4, strftime('%s','now','-4 days')),
  (6, (SELECT id FROM users WHERE username='rustacean'),
   'D1 SQL destegi beklenenden iyi. Drizzle ile birlikte kullaninca guzel bir gelistirme deneyimi sunuyor.',
   11, strftime('%s','now','-3 days')),
  (6, (SELECT id FROM users WHERE username='linuxuser'),
   'Wrangler 4.x ile local gelistirme cok kolaylasti. D1, R2, KV hepsini local simulate ediyor.',
   8, strftime('%s','now','-2 days')),
  (6, (SELECT id FROM users WHERE username='devopsguru'),
   'Free tier sinirlari icin Workers Analytics Engine da bakilmaya deger. Basic metrikler toplayabilirsiniz.',
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
  ('forum_description',     'Cloudflare Workers uzerinde calisan acik kaynak forum yazilimi.'),
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
