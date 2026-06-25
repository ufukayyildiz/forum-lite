ALTER TABLE `email_suppressions` ADD `cf_suppression_status` text;
--> statement-breakpoint
ALTER TABLE `email_suppressions` ADD `cf_suppressed_at` integer;
--> statement-breakpoint
ALTER TABLE `email_suppressions` ADD `cf_suppression_error` text;
--> statement-breakpoint
CREATE TABLE `notification_preferences` (
	`user_id` integer PRIMARY KEY NOT NULL,
	`reply_email` integer DEFAULT true NOT NULL,
	`like_email` integer DEFAULT true NOT NULL,
	`marketing_email` integer DEFAULT true NOT NULL,
	`all_email` integer DEFAULT true NOT NULL,
	`unsubscribe_token` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_preferences_unsubscribe_token_idx` ON `notification_preferences` (`unsubscribe_token`);
--> statement-breakpoint
CREATE TABLE `email_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer,
	`email` text NOT NULL,
	`kind` text NOT NULL,
	`subject` text NOT NULL,
	`status` text NOT NULL,
	`related_type` text,
	`related_id` integer,
	`campaign_key` text,
	`message` text,
	`error_code` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `email_events_created_at_idx` ON `email_events` (`created_at`);
--> statement-breakpoint
CREATE INDEX `email_events_kind_idx` ON `email_events` (`kind`);
--> statement-breakpoint
CREATE INDEX `email_events_user_idx` ON `email_events` (`user_id`);
--> statement-breakpoint
CREATE TABLE `marketing_sends` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`campaign_key` text NOT NULL,
	`user_id` integer,
	`email` text NOT NULL,
	`status` text NOT NULL,
	`email_event_id` integer,
	`sent_by_user_id` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`email_event_id`) REFERENCES `email_events`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`sent_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `marketing_sends_campaign_user_idx` ON `marketing_sends` (`campaign_key`,`user_id`);
--> statement-breakpoint
CREATE INDEX `marketing_sends_created_at_idx` ON `marketing_sends` (`created_at`);
