ALTER TABLE `users` ADD `email_verified_at` integer;
--> statement-breakpoint
ALTER TABLE `users` ADD `last_login_at` integer;
--> statement-breakpoint
ALTER TABLE `users` ADD `email_suppressed_at` integer;
--> statement-breakpoint
ALTER TABLE `users` ADD `email_suppression_reason` text;
--> statement-breakpoint
CREATE TABLE `email_suppressions` (
	`email` text PRIMARY KEY NOT NULL,
	`reason` text NOT NULL,
	`source` text NOT NULL,
	`details` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `email_suppressions_created_at_idx` ON `email_suppressions` (`created_at`);
