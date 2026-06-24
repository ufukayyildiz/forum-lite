/**
 * Local dev seed script.
 * Runs against local D1 via wrangler d1 execute.
 * Usage: npm run seed:local
 */

import { execSync } from "child_process";

const DB = "forum-db";
const CFG = "--local --config wrangler.local.jsonc";
const now = Math.floor(Date.now() / 1000);
const day = 86400;

function exec(sql: string) {
  const safe = sql.replace(/'/g, `'\\''`).replace(/\n/g, " ");
  execSync(
    `npx wrangler d1 execute ${DB} ${CFG} --command '${safe}'`,
    { stdio: "inherit", cwd: process.cwd() },
  );
}

function batch(statements: string[]) {
  for (const s of statements) exec(s);
}

console.log("Seeding local D1...");

// --- Users (password hashes are dummy placeholders — use /register for real login) ---
batch([
  `INSERT OR IGNORE INTO users (public_id, username, email, password_hash, display_name, role, post_count, thread_count, created_at) VALUES
    ('194358', 'admin',      'admin@forum.local',   'pbkdf2$100000$dummy$dummy', 'Admin',      'admin',     42, 15, ${now - 30 * day}),
    ('264035', 'vimmer',     'vimmer@forum.local',  'pbkdf2$100000$dummy$dummy', 'Vimmer',     'moderator', 38, 12, ${now - 25 * day}),
    ('333712', 'rustacean',  'rust@forum.local',    'pbkdf2$100000$dummy$dummy', 'Rustacean',  'member',    27,  9, ${now - 20 * day}),
    ('403389', 'linuxuser',  'linux@forum.local',   'pbkdf2$100000$dummy$dummy', 'Linux User', 'member',    19,  6, ${now - 15 * day}),
    ('473066', 'devopsguru', 'devops@forum.local',  'pbkdf2$100000$dummy$dummy', 'DevOps Guru','member',    11,  4, ${now - 10 * day})`,

  `UPDATE users SET bio = 'Forum yöneticisi. Vim ve terminal tabanlı araçlar hakkında her şeyi bilirim.' WHERE username = 'admin'`,
  `UPDATE users SET bio = 'Vim''i her şey için kullanıyorum. Yazı yazmak, kod geliştirmek, e-posta okumak...' WHERE username = 'vimmer'`,
  `UPDATE users SET bio = 'Rust ile sistem programlama yapıyorum. Bellek güvenliği hayat kurtarır.' WHERE username = 'rustacean'`,
  `UPDATE users SET bio = 'Arch Linux kullanıcısı. BTW.' WHERE username = 'linuxuser'`,
  `UPDATE users SET bio = 'Kubernetes, Docker, CI/CD. Altyapıyı kod olarak yönetiyorum.' WHERE username = 'devopsguru'`,
]);

// --- Categories ---
batch([
  `INSERT OR IGNORE INTO categories (public_id, name, slug, description, color, icon, position, created_at) VALUES
    ('9932', 'Genel Tartışma',   'genel',      'Her konudan serbest tartışma.',                          '#fabd2f', 'MessageSquare', 0, ${now - 30 * day}),
    ('8851', 'Linux & Sistem',   'linux',      'Linux, kabuk betikleri, sistem yönetimi.',              '#83a598', 'Terminal',      1, ${now - 30 * day}),
    ('7770', 'Programlama',      'programlama','Diller, çerçeveler, algoritma tartışmaları.',           '#b8bb26', 'Code',          2, ${now - 30 * day}),
    ('6689', 'DevOps & Bulut',   'devops',     'CI/CD, konteyner, altyapı yönetimi.',                  '#fe8019', 'Cloud',         3, ${now - 30 * day}),
    ('5608', 'Proje Tanıtımı',   'projeler',   'Kendi projelerinizi tanıtın ve geri bildirim alın.',   '#d3869b', 'Rocket',        4, ${now - 30 * day})`,
]);

// --- Tags ---
batch([
  `INSERT OR IGNORE INTO tags (name, slug, created_at) VALUES
    ('vim',        'vim',        ${now - 30 * day}),
    ('rust',       'rust',       ${now - 28 * day}),
    ('linux',      'linux',      ${now - 27 * day}),
    ('terminal',   'terminal',   ${now - 26 * day}),
    ('docker',     'docker',     ${now - 25 * day}),
    ('kubernetes', 'kubernetes', ${now - 24 * day}),
    ('typescript', 'typescript', ${now - 23 * day}),
    ('python',     'python',     ${now - 22 * day}),
    ('cloudflare', 'cloudflare', ${now - 20 * day}),
    ('arch',       'arch',       ${now - 18 * day})`,
]);

// --- Threads (with first post = content) ---
// Thread 1: Vim yapılandırması
exec(
  `INSERT OR IGNORE INTO threads (public_id, category_id, user_id, title, slug, content, pinned, views, reply_count, created_at, updated_at, last_post_at) VALUES
  ('160616', 1, 2, 'Vim yapılandırmanızı paylaşın', 'vim-yapilandirma',
   'Herkese merhaba! Bu konuda Vim yapılandırmalarımızı paylaşabiliriz. Ben yıllardır aynı .vimrc ile çalışıyorum ama hâlâ iyileştirme arayışındayım.

**Benim kurulumum:**
- Plugin yöneticisi: vim-plug
- Renk teması: gruvbox
- Eklentiler: NERDTree, vim-airline, fzf.vim, coc.nvim

Sizinki nasıl?',
  1, 247, 4, ${now - 20 * day}, ${now - 2 * day}, ${now - 2 * day})`,
);

// Thread 2: Rust öğrenme
exec(
  `INSERT OR IGNORE INTO threads (public_id, category_id, user_id, title, slug, content, views, reply_count, created_at, updated_at, last_post_at) VALUES
  ('208887', 3, 3, 'Rust öğrenmek için en iyi kaynaklar', 'rust-ogrenme-kaynaklari',
   'Rust öğrenmek isteyenler için bir kaynak listesi hazırladım. Başlangıç seviyesinden ileri seviyeye kadar önerim olan her şeyi paylaşıyorum.

1. **The Rust Programming Language** (resmi kitap) - ücretsiz online
2. **Rustlings** - küçük egzersizler
3. **Rust by Example** - pratik örnekler
4. **Zero to Production in Rust** - web uygulaması geliştirme

Siz nereden başladınız?',
  0, 189, 3, ${now - 18 * day}, ${now - 3 * day}, ${now - 3 * day})`,
);

// Thread 3: Docker ipuçları
exec(
  `INSERT OR IGNORE INTO threads (public_id, category_id, user_id, title, slug, content, featured, views, reply_count, created_at, updated_at, last_post_at) VALUES
  ('257158', 4, 5, 'Docker imaj boyutunu küçültme teknikleri', 'docker-imaj-boyutu',
   'Production ortamlarında Docker imaj boyutu büyük önem taşır. İşte kullandığım teknikler:

**Multi-stage build:**
\`\`\`dockerfile
FROM rust:1.75 AS builder
WORKDIR /app
COPY . .
RUN cargo build --release

FROM debian:bookworm-slim
COPY --from=builder /app/target/release/myapp /usr/local/bin/
CMD ["myapp"]
\`\`\`

Bu yöntemle 1.2 GB imajı 45 MB''ye indirdim.',
  1, 312, 5, ${now - 15 * day}, ${now - 1 * day}, ${now - 1 * day})`,
);

// Thread 4: Arch Linux kurulum
exec(
  `INSERT OR IGNORE INTO threads (public_id, category_id, user_id, title, slug, content, views, reply_count, created_at, updated_at, last_post_at) VALUES
  ('305429', 2, 4, 'Arch Linux kurulum rehberi 2025', 'arch-linux-kurulum-2025',
   'Her yıl güncellediğim Arch Linux kurulum notlarımı paylaşıyorum. archinstall scripti artık çok daha iyi olsa da manuel kurulum hâlâ öğretici.

**Temel adımlar:**
1. ISO indir, boot USB hazırla
2. Disk bölümlendirme (GPT + EFI)
3. Base sistem kurulumu
4. Bootloader (systemd-boot öneriyorum)
5. Kullanıcı oluşturma ve sudo ayarları

Detaylı komutları aşağıda paylaşacağım.',
  0, 156, 2, ${now - 12 * day}, ${now - 4 * day}, ${now - 4 * day})`,
);

// Thread 5: TypeScript ipuçları
exec(
  `INSERT OR IGNORE INTO threads (public_id, category_id, user_id, title, slug, content, views, reply_count, created_at, updated_at, last_post_at) VALUES
  ('353700', 3, 1, 'TypeScript''te az bilinen özellikler', 'typescript-az-bilinen-ozellikler',
   'Günlük TypeScript kullanımımda çok işe yarayan ama çoğu kişinin bilmediği bazı özellikler:

**Template literal types:**
\`\`\`typescript
type EventName = \`on\${Capitalize<string>}\`;
// onLoad, onClick, onSubmit...
\`\`\`

**Satisfies operatörü (TS 4.9+):**
\`\`\`typescript
const config = {
  port: 3000,
  host: "localhost"
} satisfies Record<string, string | number>;
\`\`\`

Başka önerileriniz var mı?',
  0, 203, 3, ${now - 8 * day}, ${now - 5 * day}, ${now - 5 * day})`,
);

// Thread 6: Cloudflare Workers
exec(
  `INSERT OR IGNORE INTO threads (public_id, category_id, user_id, title, slug, content, views, reply_count, created_at, updated_at, last_post_at) VALUES
  ('401971', 5, 1, 'Cloudflare Workers ile serverless forum', 'cloudflare-workers-forum',
   'Bu forumun kendisi Cloudflare Workers üzerinde çalışıyor. Geliştirme sürecinde öğrendiklerimi paylaşmak istedim.

**Neden Workers?**
- Global edge ağı, düşük gecikme
- Ücretsiz tier oldukça cömert (100k istek/gün)
- D1 ile SQLite veritabanı
- R2 ile object storage
- Wrangler ile kolay deploy

Sorularınız varsa yanıtlamaya çalışırım.',
  0, 278, 4, ${now - 5 * day}, ${now - 1 * day}, ${now - 1 * day})`,
);

// --- Posts (replies) ---
batch([
  // Thread 1 replies
  `INSERT OR IGNORE INTO posts (thread_id, user_id, content, like_count, created_at) VALUES
    (1, 1, 'Ben de gruvbox kullanıyorum! Buna ek olarak vim-surround ve vim-commentary eklentileri olmadan çalışamıyorum artık. Özellikle cs"'' komutu hayat kurtarıcı.', 5, ${now - 19 * day})`,
  `INSERT OR IGNORE INTO posts (thread_id, user_id, content, like_count, created_at) VALUES
    (1, 3, 'Neovim''e geçmeyi düşünüyor musunuz? Lua konfigürasyonu başta karmaşık geliyor ama lazy.nvim ile plugin yönetimi çok kolaylaşıyor. LSP entegrasyonu da Vim''e göre çok daha iyi.', 8, ${now - 18 * day})`,
  `INSERT OR IGNORE INTO posts (thread_id, user_id, content, like_count, created_at) VALUES
    (1, 4, 'Benim .vimrc''im 500 satırı geçti, bir türlü Neovim''e taşıyamadım. Belki bu konu beni motive eder. fzf.vim önerisi için teşekkürler, deneyeceğim.', 3, ${now - 15 * day})`,
  `INSERT OR IGNORE INTO posts (thread_id, user_id, content, like_count, created_at) VALUES
    (1, 5, 'Vim yerine Helix editörünü denemek istiyorum. Kaytex ile built-in LSP desteği varmış, plugin gerekmiyormuş. Birisi kullanıyor mu?', 2, ${now - 2 * day})`,

  // Thread 2 replies
  `INSERT OR IGNORE INTO posts (thread_id, user_id, content, like_count, created_at) VALUES
    (2, 2, 'Harika bir liste! Buna ek olarak "Programming Rust" kitabını da öneririm, O''Reilly yayınından. Özellikle lifetime ve ownership konularını çok iyi anlatıyor.', 6, ${now - 17 * day})`,
  `INSERT OR IGNORE INTO posts (thread_id, user_id, content, like_count, created_at) VALUES
    (2, 4, 'Rust öğrenirken en çok borrow checker ile savaştım. Şimdi geriye dönüp bakınca neden bu kadar uğraştığımı anlamıyorum. Pratik yapınca oturuyor.', 4, ${now - 16 * day})`,
  `INSERT OR IGNORE INTO posts (thread_id, user_id, content, like_count, created_at) VALUES
    (2, 1, 'async/await kısmı için Tokio dökümantasyonu da çok güzel. Mini projeler yaparak öğrenmek en etkili yöntem bence — bir CLI aracı ya da küçük bir web sunucusu.', 7, ${now - 3 * day})`,

  // Thread 3 replies
  `INSERT OR IGNORE INTO posts (thread_id, user_id, content, like_count, created_at) VALUES
    (3, 1, 'Distroless base imajları da denemeye değer. Google''ın sağladığı bu imajlar shell bile içermiyor, saldırı yüzeyi minimuma iniyor.', 9, ${now - 14 * day})`,
  `INSERT OR IGNORE INTO posts (thread_id, user_id, content, like_count, created_at) VALUES
    (3, 2, '.dockerignore dosyasını da atlamayın. node_modules, .git, test dosyaları build context''ine girmesin. Büyük projelerde build süresini yarıya indirebilir.', 11, ${now - 13 * day})`,
  `INSERT OR IGNORE INTO posts (thread_id, user_id, content, like_count, created_at) VALUES
    (3, 3, 'cargo-chef ile Rust projelerinde layer cache''leme yapabilirsiniz. Bağımlılıkları ayrı katmana koyunca sadece kod değiştiğinde derleme yapılıyor, CI süreleri dramatik düşüyor.', 13, ${now - 12 * day})`,
  `INSERT OR IGNORE INTO posts (thread_id, user_id, content, like_count, created_at) VALUES
    (3, 4, 'Alpine yerine Debian slim tercih ediyorum artık. Alpine''in musl libc''si bazen glibc bağımlılıklarıyla çakışıyor ve debugging cehenneme dönüyor.', 8, ${now - 11 * day})`,
  `INSERT OR IGNORE INTO posts (thread_id, user_id, content, like_count, created_at) VALUES
    (3, 5, 'Buildkit''i etkinleştirmeyi unutmayın: DOCKER_BUILDKIT=1. Paralel build ve gelişmiş cache özelliklerini açıyor. Docker 23+''ta zaten varsayılan ama eski sürümlerde gerekli.', 10, ${now - 1 * day})`,

  // Thread 4 replies
  `INSERT OR IGNORE INTO posts (thread_id, user_id, content, like_count, created_at) VALUES
    (4, 2, 'systemd-boot gerçekten GRUB''a göre çok daha hızlı. EFI stub ile neredeyse anında geçiyor kernel''e. Konfigürasyon da daha basit.', 5, ${now - 11 * day})`,
  `INSERT OR IGNORE INTO posts (thread_id, user_id, content, like_count, created_at) VALUES
    (4, 1, 'reflector ile mirror listesini güncel tutmayı da ekleyin rehbere. Ülkeye yakın hızlı mirror''lar kurulum ve güncelleme hızını ciddi artırıyor.', 4, ${now - 4 * day})`,

  // Thread 5 replies
  `INSERT OR IGNORE INTO posts (thread_id, user_id, content, like_count, created_at) VALUES
    (5, 2, 'Infer utility type''ı da çok kullanışlı. Zod şemasından tip türetmek için mükemmel: type User = z.infer<typeof userSchema>', 7, ${now - 7 * day})`,
  `INSERT OR IGNORE INTO posts (thread_id, user_id, content, like_count, created_at) VALUES
    (5, 4, 'Discriminated union''lar hakkında bir şey ekleyebilir misiniz? API response''larını modellemek için çok güçlü ama anlatımı zor.', 3, ${now - 6 * day})`,
  `INSERT OR IGNORE INTO posts (thread_id, user_id, content, like_count, created_at) VALUES
    (5, 3, 'const assertion (as const) da az kullanılıyor. readonly tuple ve literal type''lar için güzel: const ROLES = ["admin","mod","member"] as const', 9, ${now - 5 * day})`,

  // Thread 6 replies
  `INSERT OR IGNORE INTO posts (thread_id, user_id, content, like_count, created_at) VALUES
    (6, 2, 'Workers KV için de bir konu açsanız iyi olur. Session yönetimi için KV mi D1 mi tercih edersiniz?', 4, ${now - 4 * day})`,
  `INSERT OR IGNORE INTO posts (thread_id, user_id, content, like_count, created_at) VALUES
    (6, 3, 'D1 SQL desteği beklenenden iyi. Drizzle ile birlikte kullanınca gerçekten güzel bir geliştirme deneyimi sunuyor. Sadece transaction desteğinin sınırlı olduğunu unutmayın.', 11, ${now - 3 * day})`,
  `INSERT OR IGNORE INTO posts (thread_id, user_id, content, like_count, created_at) VALUES
    (6, 4, 'Wrangler 4.x ile local geliştirme çok kolaylaştı. D1, R2, KV hepsini local simulate ediyor. Production''a deploy etmeden önce neredeyse her şeyi test edebiliyorsunuz.', 8, ${now - 2 * day})`,
  `INSERT OR IGNORE INTO posts (thread_id, user_id, content, like_count, created_at) VALUES
    (6, 5, 'Free tier sınırları için Workers Analytics Engine da bakılmaya değer. Ücretli plan olmadan basic metrikler toplayabilirsiniz.', 6, ${now - 1 * day})`,
]);

// --- Thread-Tag associations ---
batch([
  `INSERT OR IGNORE INTO thread_tags (thread_id, tag_id) SELECT 1, id FROM tags WHERE slug IN ('vim','terminal')`,
  `INSERT OR IGNORE INTO thread_tags (thread_id, tag_id) SELECT 2, id FROM tags WHERE slug IN ('rust')`,
  `INSERT OR IGNORE INTO thread_tags (thread_id, tag_id) SELECT 3, id FROM tags WHERE slug IN ('docker','devops')`,
  `INSERT OR IGNORE INTO thread_tags (thread_id, tag_id) SELECT 4, id FROM tags WHERE slug IN ('linux','arch')`,
  `INSERT OR IGNORE INTO thread_tags (thread_id, tag_id) SELECT 5, id FROM tags WHERE slug IN ('typescript')`,
  `INSERT OR IGNORE INTO thread_tags (thread_id, tag_id) SELECT 6, id FROM tags WHERE slug IN ('cloudflare')`,
]);

// --- Settings ---
exec(
  `INSERT OR IGNORE INTO settings (key, value) VALUES
    ('forum_title',           'forum-lite'),
    ('forum_description',     'Cloudflare Workers üzerinde çalışan açık kaynak forum yazılımı.'),
    ('registration_open',     'true'),
    ('maintenance_mode',      'false'),
    ('threads_per_page',      '20'),
    ('posts_per_page',        '20'),
    ('uploads_enabled',       'true'),
    ('max_attachment_size_mb','5'),
    ('allowed_file_types',    'jpg,jpeg,png,gif,webp,pdf'),
    ('email_from',            'noreply@forum.local'),
    ('site_url',              'http://localhost:5173'),
    ('forum_contact_email',   'admin@forum.local')`,
);

console.log("Seed complete.");
console.log("");
console.log("Demo users (dummy password hashes — register a new account to log in):");
console.log("  admin      role: admin");
console.log("  vimmer     role: moderator");
console.log("  rustacean  role: member");
console.log("  linuxuser  role: member");
console.log("  devopsguru role: member");
console.log("");
console.log("To grant admin to your own account:");
console.log(
  '  npx wrangler d1 execute forum-db --local --config wrangler.local.jsonc --command "UPDATE users SET role=\'admin\' WHERE username=\'YOUR_NAME\';"',
);
