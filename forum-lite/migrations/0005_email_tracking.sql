ALTER TABLE `email_events` ADD `tracking_token` text;
--> statement-breakpoint
ALTER TABLE `email_events` ADD `opened_at` integer;
--> statement-breakpoint
ALTER TABLE `email_events` ADD `last_opened_at` integer;
--> statement-breakpoint
ALTER TABLE `email_events` ADD `open_count` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `email_events` ADD `clicked_at` integer;
--> statement-breakpoint
ALTER TABLE `email_events` ADD `last_clicked_at` integer;
--> statement-breakpoint
ALTER TABLE `email_events` ADD `click_count` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `email_events_tracking_token_idx` ON `email_events` (`tracking_token`);
