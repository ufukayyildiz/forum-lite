CREATE TABLE `analytics_pageviews` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`visitor_id` text NOT NULL,
	`user_id` integer,
	`path` text NOT NULL,
	`route_type` text DEFAULT 'other' NOT NULL,
	`referrer` text,
	`referrer_host` text,
	`source` text DEFAULT 'direct' NOT NULL,
	`medium` text DEFAULT 'none' NOT NULL,
	`campaign` text,
	`country` text,
	`city` text,
	`colo` text,
	`timezone` text,
	`device_type` text DEFAULT 'desktop' NOT NULL,
	`browser` text DEFAULT 'unknown' NOT NULL,
	`os` text DEFAULT 'unknown' NOT NULL,
	`is_repeat` integer DEFAULT false NOT NULL,
	`is_bot` integer DEFAULT false NOT NULL,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `analytics_pageviews_created_at_idx` ON `analytics_pageviews` (`created_at`);
--> statement-breakpoint
CREATE INDEX `analytics_pageviews_visitor_created_at_idx` ON `analytics_pageviews` (`visitor_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `analytics_pageviews_path_created_at_idx` ON `analytics_pageviews` (`path`,`created_at`);
--> statement-breakpoint
CREATE INDEX `analytics_pageviews_user_created_at_idx` ON `analytics_pageviews` (`user_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `analytics_pageviews_source_created_at_idx` ON `analytics_pageviews` (`source`,`created_at`);
--> statement-breakpoint
CREATE INDEX `analytics_pageviews_country_created_at_idx` ON `analytics_pageviews` (`country`,`created_at`);
