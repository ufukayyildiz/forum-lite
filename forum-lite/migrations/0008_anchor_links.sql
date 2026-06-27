CREATE TABLE IF NOT EXISTS `anchor_links` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `term` text NOT NULL,
  `url` text NOT NULL,
  `title` text NOT NULL DEFAULT '',
  `enabled` integer NOT NULL DEFAULT 1,
  `click_count` integer NOT NULL DEFAULT 0,
  `created_by_user_id` integer REFERENCES `users`(`id`) ON DELETE SET NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);

CREATE INDEX IF NOT EXISTS `anchor_links_term_idx` ON `anchor_links` (`term`);
CREATE INDEX IF NOT EXISTS `anchor_links_enabled_idx` ON `anchor_links` (`enabled`);
CREATE INDEX IF NOT EXISTS `anchor_links_click_count_idx` ON `anchor_links` (`click_count`);
