let coreSchemaReady = false;
let coreSchemaPromise: Promise<boolean> | null = null;

const nowSeconds = () => Math.floor(Date.now() / 1000);

function ident(name: string) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) throw new Error(`Unsafe SQL identifier: ${name}`);
  return `\`${name}\``;
}

async function run(db: D1Database, sql: string, ...bindings: unknown[]) {
  await db.prepare(sql).bind(...bindings).run();
}

async function columnSet(db: D1Database, table: string): Promise<Set<string>> {
  const info = await db.prepare(`PRAGMA table_info(${ident(table)})`).all<{ name: string }>();
  return new Set((info.results ?? []).map((row) => row.name));
}

async function addColumnIfMissing(db: D1Database, table: string, column: string, definition: string) {
  const columns = await columnSet(db, table);
  if (!columns.has(column)) await run(db, `ALTER TABLE ${ident(table)} ADD COLUMN ${definition}`);
}

async function createCoreTables(db: D1Database) {
  await run(db, `CREATE TABLE IF NOT EXISTS users (
    id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    public_id text,
    username text NOT NULL,
    email text NOT NULL,
    password_hash text NOT NULL,
    display_name text NOT NULL,
    avatar_url text,
    bio text,
    role text DEFAULT 'member' NOT NULL,
    banned integer DEFAULT 0 NOT NULL,
    email_verified_at integer,
    last_login_at integer,
    email_suppressed_at integer,
    email_suppression_reason text,
    post_count integer DEFAULT 0 NOT NULL,
    thread_count integer DEFAULT 0 NOT NULL,
    created_at integer NOT NULL
  )`);
  await run(db, "CREATE INDEX IF NOT EXISTS users_username_idx ON users(username)");
  await run(db, "CREATE INDEX IF NOT EXISTS users_email_idx ON users(email)");
  await run(db, "CREATE INDEX IF NOT EXISTS users_public_id_idx ON users(public_id)");

  await run(db, `CREATE TABLE IF NOT EXISTS sessions (
    token text PRIMARY KEY NOT NULL,
    user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at integer NOT NULL,
    created_at integer NOT NULL
  )`);
  await run(db, "CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id)");

  await run(db, `CREATE TABLE IF NOT EXISTS categories (
    id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    public_id text,
    name text NOT NULL,
    slug text NOT NULL,
    description text,
    color text DEFAULT '#6366f1' NOT NULL,
    icon text DEFAULT 'MessageSquare' NOT NULL,
    position integer DEFAULT 0 NOT NULL,
    created_at integer NOT NULL
  )`);
  await run(db, "CREATE INDEX IF NOT EXISTS categories_slug_idx ON categories(slug)");
  await run(db, "CREATE INDEX IF NOT EXISTS categories_public_id_idx ON categories(public_id)");

  await run(db, `CREATE TABLE IF NOT EXISTS threads (
    id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    public_id text,
    category_id integer NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title text NOT NULL,
    slug text NOT NULL,
    content text NOT NULL,
    pinned integer DEFAULT 0 NOT NULL,
    locked integer DEFAULT 0 NOT NULL,
    featured integer DEFAULT 0 NOT NULL,
    views integer DEFAULT 0 NOT NULL,
    reply_count integer DEFAULT 0 NOT NULL,
    created_at integer NOT NULL,
    updated_at integer NOT NULL,
    last_post_at integer NOT NULL
  )`);
  await run(db, "CREATE INDEX IF NOT EXISTS threads_public_id_idx ON threads(public_id)");
  await run(db, "CREATE INDEX IF NOT EXISTS threads_category_idx ON threads(category_id)");
  await run(db, "CREATE INDEX IF NOT EXISTS threads_user_idx ON threads(user_id)");
  await run(db, "CREATE INDEX IF NOT EXISTS threads_last_post_idx ON threads(last_post_at)");
  await run(db, "CREATE INDEX IF NOT EXISTS threads_pinned_last_post_idx ON threads(pinned, last_post_at)");

  await run(db, `CREATE TABLE IF NOT EXISTS posts (
    id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    thread_id integer NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content text NOT NULL,
    like_count integer DEFAULT 0 NOT NULL,
    edited_at integer,
    created_at integer NOT NULL
  )`);
  await run(db, "CREATE INDEX IF NOT EXISTS posts_thread_idx ON posts(thread_id)");
  await run(db, "CREATE INDEX IF NOT EXISTS posts_user_idx ON posts(user_id)");

  await run(db, `CREATE TABLE IF NOT EXISTS likes (
    id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    post_id integer NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at integer NOT NULL
  )`);
  await run(db, "CREATE INDEX IF NOT EXISTS likes_post_user_idx ON likes(post_id, user_id)");

  await run(db, `CREATE TABLE IF NOT EXISTS tags (
    id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    created_at integer NOT NULL
  )`);
  await run(db, "CREATE INDEX IF NOT EXISTS tags_slug_idx ON tags(slug)");

  await run(db, `CREATE TABLE IF NOT EXISTS thread_tags (
    thread_id integer NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    tag_id integer NOT NULL REFERENCES tags(id) ON DELETE CASCADE
  )`);
  await run(db, "CREATE INDEX IF NOT EXISTS thread_tags_pk ON thread_tags(thread_id, tag_id)");

  await run(db, `CREATE TABLE IF NOT EXISTS attachments (
    id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    key text NOT NULL,
    user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    filename text NOT NULL,
    mime text NOT NULL,
    size integer NOT NULL,
    created_at integer NOT NULL
  )`);
  await run(db, "CREATE INDEX IF NOT EXISTS attachments_key_idx ON attachments(key)");

  await run(db, `CREATE TABLE IF NOT EXISTS activity_log (
    id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    user_id integer REFERENCES users(id) ON DELETE SET NULL,
    type text NOT NULL,
    summary text NOT NULL,
    created_at integer NOT NULL
  )`);

  await run(db, `CREATE TABLE IF NOT EXISTS settings (
    key text PRIMARY KEY NOT NULL,
    value text NOT NULL
  )`);

  await run(db, `CREATE TABLE IF NOT EXISTS auth_attempts (
    id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    action text NOT NULL,
    ip text NOT NULL,
    created_at integer NOT NULL
  )`);
  await run(db, "CREATE INDEX IF NOT EXISTS auth_attempts_ip_action_time_idx ON auth_attempts(ip, action, created_at)");
}

async function createFeatureTables(db: D1Database) {
  await run(db, `CREATE TABLE IF NOT EXISTS email_suppressions (
    email text PRIMARY KEY NOT NULL,
    reason text NOT NULL,
    source text NOT NULL,
    details text,
    cf_suppression_status text,
    cf_suppressed_at integer,
    cf_suppression_error text,
    created_at integer NOT NULL,
    updated_at integer NOT NULL
  )`);
  await run(db, "CREATE INDEX IF NOT EXISTS email_suppressions_created_at_idx ON email_suppressions(created_at)");

  await run(db, `CREATE TABLE IF NOT EXISTS notification_preferences (
    user_id integer PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reply_email integer DEFAULT 1 NOT NULL,
    like_email integer DEFAULT 1 NOT NULL,
    marketing_email integer DEFAULT 1 NOT NULL,
    all_email integer DEFAULT 1 NOT NULL,
    unsubscribe_token text NOT NULL,
    created_at integer NOT NULL,
    updated_at integer NOT NULL
  )`);
  await run(db, "CREATE INDEX IF NOT EXISTS notification_preferences_unsubscribe_token_idx ON notification_preferences(unsubscribe_token)");

  await run(db, `CREATE TABLE IF NOT EXISTS email_events (
    id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    user_id integer REFERENCES users(id) ON DELETE SET NULL,
    email text NOT NULL,
    kind text NOT NULL,
    subject text NOT NULL,
    status text NOT NULL,
    related_type text,
    related_id integer,
    campaign_key text,
    tracking_token text,
    opened_at integer,
    last_opened_at integer,
    open_count integer DEFAULT 0 NOT NULL,
    clicked_at integer,
    last_clicked_at integer,
    click_count integer DEFAULT 0 NOT NULL,
    message text,
    error_code text,
    created_at integer NOT NULL
  )`);
  await run(db, "CREATE INDEX IF NOT EXISTS email_events_created_at_idx ON email_events(created_at)");
  await run(db, "CREATE INDEX IF NOT EXISTS email_events_email_idx ON email_events(email)");
  await run(db, "CREATE INDEX IF NOT EXISTS email_events_kind_idx ON email_events(kind)");
  await run(db, "CREATE INDEX IF NOT EXISTS email_events_user_idx ON email_events(user_id)");
  await run(db, "CREATE INDEX IF NOT EXISTS email_events_tracking_token_idx ON email_events(tracking_token)");

  await run(db, `CREATE TABLE IF NOT EXISTS marketing_sends (
    id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    campaign_key text NOT NULL,
    user_id integer REFERENCES users(id) ON DELETE SET NULL,
    email text NOT NULL,
    status text NOT NULL,
    email_event_id integer REFERENCES email_events(id) ON DELETE SET NULL,
    sent_by_user_id integer REFERENCES users(id) ON DELETE SET NULL,
    created_at integer NOT NULL
  )`);
  await run(db, "CREATE INDEX IF NOT EXISTS marketing_sends_campaign_user_idx ON marketing_sends(campaign_key, user_id)");
  await run(db, "CREATE INDEX IF NOT EXISTS marketing_sends_created_at_idx ON marketing_sends(created_at)");

  await run(db, `CREATE TABLE IF NOT EXISTS analytics_pageviews (
    id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    visitor_id text NOT NULL,
    user_id integer REFERENCES users(id) ON DELETE SET NULL,
    path text NOT NULL,
    route_type text DEFAULT 'other' NOT NULL,
    referrer text,
    referrer_host text,
    source text DEFAULT 'direct' NOT NULL,
    medium text DEFAULT 'none' NOT NULL,
    campaign text,
    country text,
    city text,
    colo text,
    timezone text,
    device_type text DEFAULT 'desktop' NOT NULL,
    browser text DEFAULT 'unknown' NOT NULL,
    os text DEFAULT 'unknown' NOT NULL,
    is_repeat integer DEFAULT 0 NOT NULL,
    is_bot integer DEFAULT 0 NOT NULL,
    duration_ms integer DEFAULT 0 NOT NULL,
    created_at integer NOT NULL,
    last_seen_at integer NOT NULL
  )`);
  await run(db, "CREATE INDEX IF NOT EXISTS analytics_pageviews_created_at_idx ON analytics_pageviews(created_at)");
  await run(db, "CREATE INDEX IF NOT EXISTS analytics_pageviews_visitor_created_at_idx ON analytics_pageviews(visitor_id, created_at)");
  await run(db, "CREATE INDEX IF NOT EXISTS analytics_pageviews_path_created_at_idx ON analytics_pageviews(path, created_at)");
  await run(db, "CREATE INDEX IF NOT EXISTS analytics_pageviews_user_created_at_idx ON analytics_pageviews(user_id, created_at)");
  await run(db, "CREATE INDEX IF NOT EXISTS analytics_pageviews_source_created_at_idx ON analytics_pageviews(source, created_at)");
  await run(db, "CREATE INDEX IF NOT EXISTS analytics_pageviews_country_created_at_idx ON analytics_pageviews(country, created_at)");

  await run(db, `CREATE TABLE IF NOT EXISTS error_events (
    id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    request_id text,
    source text NOT NULL,
    level text NOT NULL DEFAULT 'error',
    kind text NOT NULL,
    message text NOT NULL,
    stack text,
    status integer,
    method text,
    path text,
    url text,
    user_id integer REFERENCES users(id) ON DELETE SET NULL,
    username text,
    ip text,
    country text,
    colo text,
    user_agent text,
    referrer text,
    metadata text,
    created_at integer NOT NULL
  )`);
  await run(db, "CREATE INDEX IF NOT EXISTS error_events_created_at_idx ON error_events(created_at)");
  await run(db, "CREATE INDEX IF NOT EXISTS error_events_level_idx ON error_events(level)");
  await run(db, "CREATE INDEX IF NOT EXISTS error_events_source_idx ON error_events(source)");
  await run(db, "CREATE INDEX IF NOT EXISTS error_events_path_idx ON error_events(path)");
  await run(db, "CREATE INDEX IF NOT EXISTS error_events_status_idx ON error_events(status)");

  await run(db, `CREATE TABLE IF NOT EXISTS anchor_links (
    id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    term text NOT NULL,
    url text NOT NULL,
    title text NOT NULL DEFAULT '',
    enabled integer NOT NULL DEFAULT 1,
    click_count integer NOT NULL DEFAULT 0,
    created_by_user_id integer REFERENCES users(id) ON DELETE SET NULL,
    created_at integer NOT NULL,
    updated_at integer NOT NULL
  )`);
  await run(db, "CREATE INDEX IF NOT EXISTS anchor_links_term_idx ON anchor_links(term)");
  await run(db, "CREATE INDEX IF NOT EXISTS anchor_links_enabled_idx ON anchor_links(enabled)");
  await run(db, "CREATE INDEX IF NOT EXISTS anchor_links_click_count_idx ON anchor_links(click_count)");
}

async function repairColumns(db: D1Database) {
  await addColumnIfMissing(db, "users", "public_id", "public_id TEXT");
  await addColumnIfMissing(db, "users", "email_verified_at", "email_verified_at INTEGER");
  await addColumnIfMissing(db, "users", "last_login_at", "last_login_at INTEGER");
  await addColumnIfMissing(db, "users", "email_suppressed_at", "email_suppressed_at INTEGER");
  await addColumnIfMissing(db, "users", "email_suppression_reason", "email_suppression_reason TEXT");
  await addColumnIfMissing(db, "users", "post_count", "post_count INTEGER NOT NULL DEFAULT 0");
  await addColumnIfMissing(db, "users", "thread_count", "thread_count INTEGER NOT NULL DEFAULT 0");

  await addColumnIfMissing(db, "sessions", "created_at", "created_at INTEGER NOT NULL DEFAULT 0");

  await addColumnIfMissing(db, "categories", "public_id", "public_id TEXT");

  await addColumnIfMissing(db, "threads", "public_id", "public_id TEXT");
  await addColumnIfMissing(db, "threads", "pinned", "pinned INTEGER NOT NULL DEFAULT 0");
  await addColumnIfMissing(db, "threads", "locked", "locked INTEGER NOT NULL DEFAULT 0");
  await addColumnIfMissing(db, "threads", "featured", "featured INTEGER NOT NULL DEFAULT 0");
  await addColumnIfMissing(db, "threads", "views", "views INTEGER NOT NULL DEFAULT 0");
  await addColumnIfMissing(db, "threads", "reply_count", "reply_count INTEGER NOT NULL DEFAULT 0");
  await addColumnIfMissing(db, "threads", "updated_at", "updated_at INTEGER");
  await addColumnIfMissing(db, "threads", "last_post_at", "last_post_at INTEGER");

  await addColumnIfMissing(db, "posts", "like_count", "like_count INTEGER NOT NULL DEFAULT 0");
  await addColumnIfMissing(db, "posts", "edited_at", "edited_at INTEGER");

  await addColumnIfMissing(db, "email_suppressions", "cf_suppression_status", "cf_suppression_status TEXT");
  await addColumnIfMissing(db, "email_suppressions", "cf_suppressed_at", "cf_suppressed_at INTEGER");
  await addColumnIfMissing(db, "email_suppressions", "cf_suppression_error", "cf_suppression_error TEXT");

  await addColumnIfMissing(db, "email_events", "tracking_token", "tracking_token TEXT");
  await addColumnIfMissing(db, "email_events", "opened_at", "opened_at INTEGER");
  await addColumnIfMissing(db, "email_events", "last_opened_at", "last_opened_at INTEGER");
  await addColumnIfMissing(db, "email_events", "open_count", "open_count INTEGER NOT NULL DEFAULT 0");
  await addColumnIfMissing(db, "email_events", "clicked_at", "clicked_at INTEGER");
  await addColumnIfMissing(db, "email_events", "last_clicked_at", "last_clicked_at INTEGER");
  await addColumnIfMissing(db, "email_events", "click_count", "click_count INTEGER NOT NULL DEFAULT 0");

  await addColumnIfMissing(db, "anchor_links", "title", "title TEXT NOT NULL DEFAULT ''");
  await addColumnIfMissing(db, "anchor_links", "enabled", "enabled INTEGER NOT NULL DEFAULT 1");
  await addColumnIfMissing(db, "anchor_links", "click_count", "click_count INTEGER NOT NULL DEFAULT 0");
  await addColumnIfMissing(db, "anchor_links", "created_by_user_id", "created_by_user_id INTEGER");
  await addColumnIfMissing(db, "anchor_links", "created_at", "created_at INTEGER");
  await addColumnIfMissing(db, "anchor_links", "updated_at", "updated_at INTEGER");
}

async function backfillCoreData(db: D1Database) {
  const now = nowSeconds();
  await run(db, "UPDATE users SET public_id = lower(username) WHERE public_id IS NULL OR public_id = ''");
  await run(db, "UPDATE categories SET public_id = printf('%04d', id) WHERE public_id IS NULL OR public_id = ''");
  await run(db, "UPDATE threads SET public_id = printf('%06d', id) WHERE public_id IS NULL OR public_id = ''");
  await run(db, "UPDATE threads SET updated_at = COALESCE(updated_at, created_at, ?) WHERE updated_at IS NULL", now);
  await run(db, "UPDATE threads SET last_post_at = COALESCE(last_post_at, (SELECT MAX(created_at) FROM posts WHERE posts.thread_id = threads.id), created_at, ?) WHERE last_post_at IS NULL", now);
  await run(db, "UPDATE sessions SET created_at = ? WHERE created_at IS NULL OR created_at = 0", now);
  await run(db, "UPDATE anchor_links SET created_at = ? WHERE created_at IS NULL", now);
  await run(db, "UPDATE anchor_links SET updated_at = ? WHERE updated_at IS NULL", now);
}

async function createOrRepairCoreSchema(db: D1Database): Promise<boolean> {
  try {
    await createCoreTables(db);
    await createFeatureTables(db);
    await repairColumns(db);
    await backfillCoreData(db);
    return true;
  } catch (error) {
    console.error("core_schema_unavailable", error);
    return false;
  }
}

export async function ensureCoreSchema(db: D1Database) {
  if (coreSchemaReady) return true;
  if (!coreSchemaPromise) coreSchemaPromise = createOrRepairCoreSchema(db);
  const ready = await coreSchemaPromise;
  coreSchemaPromise = null;
  coreSchemaReady = ready;
  return ready;
}
