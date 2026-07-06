CREATE TABLE IF NOT EXISTS content_translations (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  locale text NOT NULL,
  path text NOT NULL,
  source_hash text NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  content_html text NOT NULL,
  schemas_json text,
  article_section text,
  article_tags_json text,
  provider text,
  model text,
  status text NOT NULL DEFAULT 'complete',
  error text,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS content_translations_locale_path_hash_idx ON content_translations(locale, path, source_hash);
CREATE INDEX IF NOT EXISTS content_translations_locale_path_status_idx ON content_translations(locale, path, status);
CREATE INDEX IF NOT EXISTS content_translations_updated_at_idx ON content_translations(updated_at);

CREATE TABLE IF NOT EXISTS translation_jobs (
  id text PRIMARY KEY NOT NULL,
  locale text NOT NULL,
  path text NOT NULL,
  source_hash text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  attempts integer NOT NULL DEFAULT 0,
  locked_until integer,
  error_message text,
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  finished_at integer
);

CREATE UNIQUE INDEX IF NOT EXISTS translation_jobs_locale_path_hash_idx ON translation_jobs(locale, path, source_hash);
CREATE INDEX IF NOT EXISTS translation_jobs_status_idx ON translation_jobs(status, updated_at);
CREATE INDEX IF NOT EXISTS translation_jobs_locked_until_idx ON translation_jobs(locked_until);
