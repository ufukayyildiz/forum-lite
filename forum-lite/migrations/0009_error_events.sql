CREATE TABLE IF NOT EXISTS `error_events` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `request_id` text,
  `source` text NOT NULL,
  `level` text NOT NULL DEFAULT 'error',
  `kind` text NOT NULL,
  `message` text NOT NULL,
  `stack` text,
  `status` integer,
  `method` text,
  `path` text,
  `url` text,
  `user_id` integer REFERENCES `users`(`id`) ON DELETE SET NULL,
  `username` text,
  `ip` text,
  `country` text,
  `colo` text,
  `user_agent` text,
  `referrer` text,
  `metadata` text,
  `created_at` integer NOT NULL
);

CREATE INDEX IF NOT EXISTS `error_events_created_at_idx` ON `error_events` (`created_at`);
CREATE INDEX IF NOT EXISTS `error_events_level_idx` ON `error_events` (`level`);
CREATE INDEX IF NOT EXISTS `error_events_source_idx` ON `error_events` (`source`);
CREATE INDEX IF NOT EXISTS `error_events_path_idx` ON `error_events` (`path`);
CREATE INDEX IF NOT EXISTS `error_events_status_idx` ON `error_events` (`status`);
