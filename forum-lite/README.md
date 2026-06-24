# forum-lite

Cloudflare Workers + D1 + R2 üzerinde çalışan, sunucusuz, tam özellikli forum yazılımı.  
VM yok, sunucu yok — her şey Cloudflare'in edge altyapısında çalışır.

> Gruvbox Dark tasarım sistemi — yoğun monospace tablolar, satır numaralı listeler, vim-style arayüz.

---

## Özellikler

- Konu / yanıt sistemi, beğeni
- Kategoriler ve etiketler, tam metin arama
- Üye profilleri, avatar, biyografi
- PBKDF2 ile şifrelenmiş parola, D1-backed oturum yönetimi
- Rol sistemi: `member` / `moderator` / `admin`
- Admin paneli: istatistikler, kullanıcı yönetimi, kategori/etiket CRUD, aktivite logu, site ayarları
- Admin Ads Management: AdSense client/slot, her N postta reklam slotu, dinamik `ads.txt`
- Cloudflare Email Service: welcome mail ve link kullanmadan 8 haneli yeni şifre gönderimi
- R2 dosya ekleri (görsel yükleme, inline render), DOMPurify XSS koruması
- SEO: Open Graph, canonical URL, JSON-LD structured data, sitemap index ve robots.txt
- Tamamen Cloudflare Free / Paid tier üzerinde çalışır — üçüncü taraf servis yok

---

## Teknoloji Yığını

| Katman | Teknoloji |
|---|---|
| Runtime | Cloudflare Workers (V8 isolates) |
| Backend | Hono v4 |
| Veritabanı | Cloudflare D1 (SQLite dialect) |
| ORM | Drizzle ORM |
| Depolama | Cloudflare R2 |
| Frontend | React 18 + Vite 6 |
| Routing | React Router v7 |
| Veri çekme | TanStack Query v5 |
| Validasyon | Zod |
| Auth | PBKDF2 / Web Crypto API, DB-backed session token |
| Stil | Özel CSS (Gruvbox Dark, JetBrains Mono) |

---

## Proje Yapısı

```
forum-lite/
├── src/
│   ├── worker/                  # Hono backend (Cloudflare Worker)
│   │   ├── index.ts             # Giriş noktası
│   │   ├── routes/              # auth, categories, threads, posts,
│   │   │                        #   members, search, tags, attachments, admin
│   │   ├── lib/
│   │   │   ├── auth.ts          # PBKDF2, session token, safeISO()
│   │   │   ├── email.ts         # Email Workers entegrasyonu
│   │   │   └── middleware.ts    # Auth middleware, RBAC
│   │   ├── db/
│   │   │   ├── schema.ts        # Drizzle şeması (tek kaynak)
│   │   │   └── index.ts
│   │   └── types.ts             # Binding tipleri: DB, BUCKET, SEND_EMAIL, ASSETS
│   └── client/                  # React SPA
│       ├── main.tsx             # Route tanımları
│       ├── index.css            # Gruvbox Dark CSS sistemi (gb-* sınıfları)
│       ├── lib/
│       │   ├── api.ts           # Tiplenmiş fetch istemcisi
│       │   ├── sanitize.ts      # DOMPurify markdown renderer
│       │   └── useAuth.ts
│       ├── components/
│       └── pages/               # Tüm sayfalar + admin/
├── migrations/                  # Drizzle D1 SQL migration dosyaları
├── wrangler.jsonc               # Public-safe CF Worker config (placeholder ID)
├── wrangler.local.example.jsonc # Lokal geliştirme şablonu
├── .dev.vars.example            # Lokal secret şablonu (şu an boş)
└── package.json
```

---

## Binding Mimarisi

Tüm dış servis bağlantıları kod içine yazılmaz. Her şey **Cloudflare Worker Bindings** üzerinden yapılır:

| Binding adı | Tür | Açıklama |
|---|---|---|
| `DB` | D1 Database | Tüm forum verisi (zorunlu) |
| `BUCKET` | R2 Bucket | Dosya ekleri (opsiyonel) |
| `SEND_EMAIL` | Email Workers | E-posta gönderimi (opsiyonel) |
| `ASSETS` | Static Assets | React SPA dosyaları (otomatik) |

Kodda `env.DB`, `env.BUCKET`, `env.SEND_EMAIL` şeklinde erişilir — ID, token veya bağlantı dizesi kod içinde **hiç geçmez**.

> **Sır gerekmez:** Oturumlar D1'da saklanan rastgele token ile yönetilir (HMAC imzası yok). Ekstra environment variable veya secret tanımlamanıza gerek yoktur.

---

## Ön Koşullar

- [Node.js](https://nodejs.org) 18+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/): `npm install -g wrangler`
- [Cloudflare hesabı](https://dash.cloudflare.com/sign-up)

---

## Kurulum ve Deploy

### 1. Fork et

GitHub'da sağ üstteki **Fork** butonuna tıklayın. Forku kendi hesabınıza oluşturun:

```
https://github.com/KULLANICI_ADINIZ/forum-lite.git
```

---

### 2. Clone ve kur

```bash
git clone https://github.com/KULLANICI_ADINIZ/forum-lite.git
cd forum-lite/forum-lite
npm install
```

---

### 3. İlk deploy

```bash
npx wrangler login
npm run deploy
```

Worker Cloudflare'e yüklenir. Çıktıda URL'niz görünür:

```
https://forum-lite.HESABINIZ.workers.dev
```

Bu noktada forum henüz çalışmaz — D1 ve diğer binding'ler bağlanmamıştır.

---

### 4. Cloudflare Dashboard — Worker Binding'lerini Ekle

[dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → **forum-lite** → **Settings** sekmesi

---

#### 4a. D1 Veritabanı (Zorunlu)

Önce D1 veritabanını oluşturun:

```bash
npx wrangler d1 create forum-db
```

Çıktıdaki `database_id` değerini not alın — bir sonraki adımda migrations için gerekecek.

Dashboard'da:

**Settings → Bindings → Add**

```
Tür        : D1 Database
Binding adı: DB
Database   : forum-db  (listeden seçin)
```

**Save** butonuna tıklayın.

---

#### 4b. R2 Bucket — Dosya Ekleri (Opsiyonel)

Dosya yükleme özelliği istemiyorsanız bu adımı atlayın.

```bash
npx wrangler r2 bucket create forum-lite-uploads
```

Dashboard'da:

**Settings → Bindings → Add**

```
Tür        : R2 Bucket
Binding adı: BUCKET
Bucket     : forum-lite-uploads  (listeden seçin)
```

**Save** butonuna tıklayın.

---

#### 4c. Cloudflare Email Service — E-posta (Opsiyonel)

Şifre sıfırlama veya bildirim e-postaları için.

Önce gönderim domainini Cloudflare Email Sending'e onboard edin:

```bash
npx wrangler email sending enable siteadiniz.com
npx wrangler email sending dns get siteadiniz.com
```

Dashboard'da:

**Settings → Bindings → Add**

```
Tür        : Send Email
Binding adı: SEND_EMAIL
From       : noreply@siteadiniz.com  (doğrulanmış adresiniz)
```

**Save** butonuna tıklayın.

E-posta binding eklenmezse forum sorunsuz çalışır; yalnızca e-posta özellikleri devre dışı kalır. Public repo için örnek adresleri kendi doğrulanmış domaininizle değiştirin.

---

#### 4d. Public Config Notu

Tracked `wrangler.jsonc` dosyasında yalnızca binding adları, public örnek değerler ve placeholder D1 ID bulunur. Gerçek Cloudflare ID'lerini public dosyalara yazmayın. Dashboard'a da **secret veya variable eklemenize gerek yoktur** — oturumlar D1'da saklandığından SESSION_SECRET gibi bir değer gerekmez.

---

### 5. D1 Migrasyonlarını Uygula

```bash
npx wrangler d1 migrations apply forum-db --remote --migrations-dir=migrations
```

Bu komut `migrations/` klasöründeki SQL dosyalarını Cloudflare D1'a uygular ve tüm tabloları oluşturur.

---

### 6. Yeniden Deploy Et

Binding'ler eklendikten sonra bir kez daha deploy edin:

```bash
npm run deploy
```

Forum artık canlıda: `https://forum-lite.HESABINIZ.workers.dev`

---

### 7. İlk Admin Hesabı

Forumun `/register` sayfasından bir hesap oluşturun. Ardından admin yetkisi verin:

```bash
npx wrangler d1 execute forum-db --remote \
  --command "UPDATE users SET role='admin' WHERE username='KULLANICI_ADINIZ';"
```

Tarayıcıda `/admin` adresine gidin.

---

### 8. Forum Ayarları — Admin Paneli

Tüm forum yapılandırması `/admin/settings` sayfasından yapılır.  
Kod değişikliğine veya yeniden deploy'a gerek yoktur.

**Genel:**

| Ayar | Açıklama |
|---|---|
| `forum_title` | Forum adı (başlık çubuğu ve logo) |
| `forum_description` | Kısa açıklama (SEO) |
| `registration_open` | `true` kayıt açık / `false` kapalı |
| `maintenance_mode` | `true` bakım modu — sadece adminler erişebilir |
| `threads_per_page` | Sayfa başına konu sayısı |
| `posts_per_page` | Sayfa başına yanıt sayısı |

**E-posta** (`SEND_EMAIL` binding eklendiyse):

| Ayar | Açıklama |
|---|---|
| `email_from` | Gönderici adresi — CF'de doğruladığınız adres |
| `site_url` | E-postalardaki linklerde kullanılacak tam URL |

**Dosya Yükleme** (`BUCKET` binding eklendiyse):

| Ayar | Açıklama |
|---|---|
| `uploads_enabled` | `true` yüklemeyi etkinleştir |
| `max_attachment_size_mb` | Tek dosya max boyutu (MB) |
| `allowed_file_types` | İzin verilen uzantılar: `jpg,jpeg,png,gif,webp,pdf` |

---

### 9. Özel Domain (İsteğe Bağlı)

**forum-lite → Settings → Domains & Routes → Add → Custom Domain**

Domain adresinizi girin (ör. `forum.siteadiniz.com`).  
Domain'iniz Cloudflare DNS'deyse otomatik bağlanır.

---

## Lokal Geliştirme

> Bu bölüm **isteğe bağlıdır.** Sadece deploy etmek istiyorsanız yukarıdaki adımlar yeterlidir.  
> Lokal geliştirme; kodu değiştirip test etmek için kullanılır.

`wrangler dev` çalışırken Wrangler, CF servislerini lokal olarak simüle eder:

| Servis | Lokal | Prodüksiyon |
|---|---|---|
| D1 | `.wrangler/state/` içindeki SQLite dosyası | Cloudflare D1 (dashboard binding) |
| R2 | `.wrangler/state/` içindeki dosya sistemi | Cloudflare R2 (dashboard binding) |
| Email | Simüle edilmez (sessizce görmezden gelinir) | Cloudflare Email Workers |
| Secrets | `.dev.vars` dosyası (şu an boş) | Cloudflare Secrets |

### Kurulum

**1. Wrangler yapılandırması:**

```bash
cp wrangler.local.example.jsonc wrangler.local.jsonc
```

`wrangler.local.jsonc` içindeki `PASTE_YOUR_D1_DATABASE_ID_HERE` alanına, Adım 4a'da `wrangler d1 create forum-db` çalıştırdığınızda aldığınız `database_id`'yi yapıştırın.

Bu dosya gitignore altındadır. Lokal geliştirme, remote migration ve repo sahibi deploy'larında kullanılabilir; public repo'ya commit etmeyin.

**2. Migrasyon ve seed:**

```bash
npm run db:migrate:local   # tabloları lokal simülasyona oluştur
npm run seed:local         # örnek veri (opsiyonel)
```

**3. Sunucuyu başlat:**

```bash
npm run dev
```

`http://localhost:5173` adresinde açılır. React SPA ve Hono API aynı portta çalışır.

**4. Lokal admin yetkisi:**

```bash
npx wrangler d1 execute forum-db \
  --local \
  --config wrangler.local.jsonc \
  --command "UPDATE users SET role='admin' WHERE username='KULLANICI_ADINIZ';"
```

---

## Veritabanı Migrasyonları

```bash
# Şema değiştirildikten sonra yeni migrasyon oluştur
npm run db:generate

# Lokal simülasyona uygula
npm run db:migrate:local

# Prodüksiyon D1'a uygula
npm run db:migrate:remote
```

---

## API Rotaları

### Backend (`/api/*`)

| Method | Endpoint | Auth | Açıklama |
|---|---|---|---|
| POST | `/api/auth/register` | — | Hesap oluştur |
| POST | `/api/auth/login` | — | Giriş yap |
| POST | `/api/auth/logout` | oturum | Çıkış yap |
| GET | `/api/auth/me` | — | Aktif kullanıcı |
| GET | `/api/categories` | — | Kategoriler |
| GET | `/api/threads` | — | Konu listesi (sayfalı) |
| POST | `/api/threads` | üye | Konu oluştur |
| GET | `/api/threads/:id` | — | Konu + yanıtlar |
| DELETE | `/api/threads/:id` | admin/mod | Konu sil |
| POST | `/api/posts` | üye | Yanıt ekle |
| POST | `/api/posts/:id/like` | üye | Beğeni toggle |
| GET | `/api/members` | — | Üye listesi |
| GET | `/api/members/:username` | — | Üye profili |
| GET | `/api/search` | — | Arama |
| GET | `/api/tags` | — | Etiket listesi |
| GET | `/api/tags/:slug/threads` | — | Etikete göre konular |
| POST | `/api/attachments` | üye | R2'ye dosya yükle |
| GET | `/api/attachments/:key` | — | R2'den dosya sun |
| GET | `/api/admin/stats` | admin | Dashboard istatistikleri |
| GET/PATCH | `/api/admin/users` | admin | Kullanıcı yönetimi |
| GET/POST/PUT/DELETE | `/api/admin/categories` | admin | Kategori CRUD |
| GET/POST/DELETE | `/api/admin/tags` | admin | Etiket CRUD |
| GET | `/api/admin/logs` | admin | Aktivite logu |
| GET/POST | `/api/admin/settings` | admin | Site ayarları |

### Frontend Sayfaları

| Adres | Sayfa |
|---|---|
| `/` | Ana sayfa |
| `/c/:id` | Kategori konu listesi |
| `/t/:id` | Konu detayı + yanıtlar |
| `/new-thread` | Konu oluşturma |
| `/members` | Üye listesi |
| `/u/:username` | Üye profili |
| `/login` / `/register` | Giriş / Kayıt |
| `/search` | Arama |
| `/tags` / `/tag/:slug` | Etiketler |
| `/admin/*` | Admin paneli |

---

## Mimari Notlar

- **Tek port SPA + API** — `@cloudflare/vite-plugin` geliştirmede React ve Hono'yu aynı portta çalıştırır. Prodüksiyonda aynı Worker bundle; CORS veya ayrı API domain'i gerekmez.
- **D1 timestamp'ları integer** — D1 timestamp kolonlarını Unix epoch integer olarak döndürür. `safeISO(v)` fonksiyonu (`src/worker/lib/auth.ts`) hem integer hem string'i kabul eder.
- **DB-backed session** — Oturumlar D1'da saklanan 64 hex char (256 bit) rastgele token ile yönetilir. HMAC imzası veya session secret gerekmez.
- **XSS koruması** — Tüm markdown çıktısı DOMPurify ile sanitize edilir (`src/client/lib/sanitize.ts`).
- **Binding'ler env üzerinden** — `env.DB`, `env.BUCKET`, `env.SEND_EMAIL`. Kod içinde hiçbir ID, token veya bağlantı dizesi bulunmaz.
- **Public-safe config** — tracked `wrangler.jsonc` placeholder ID kullanır; gerçek `database_id` yalnızca gitignored `wrangler.local.jsonc` veya Cloudflare Dashboard'da tutulur.

---

## Bilinen Sınırlamalar

- Gerçek zamanlı güncelleme yok (WebSocket yok).
- Workers ücretsiz plan: istek başına 10ms CPU. Büyük veri setlerinde ağır admin sorguları ücretli plan gerektirebilir.
- Seed verilerindeki demo kullanıcıların parolaları çalışmaz — giriş için yeni hesap kaydedin.

---

## Lisans

MIT
