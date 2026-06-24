ALTER TABLE `categories` ADD `public_id` text NOT NULL DEFAULT '';--> statement-breakpoint
CREATE UNIQUE INDEX `categories_public_id_unique` ON `categories` (`public_id`);--> statement-breakpoint
ALTER TABLE `threads` ADD `public_id` text NOT NULL DEFAULT '';--> statement-breakpoint
CREATE UNIQUE INDEX `threads_public_id_unique` ON `threads` (`public_id`);--> statement-breakpoint
ALTER TABLE `users` ADD `public_id` text NOT NULL DEFAULT '';--> statement-breakpoint
CREATE UNIQUE INDEX `users_public_id_unique` ON `users` (`public_id`);
