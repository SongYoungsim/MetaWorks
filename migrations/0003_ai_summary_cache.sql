CREATE TABLE `ai_summary_cache` (
	`key` text PRIMARY KEY NOT NULL,
	`content` text NOT NULL,
	`sources` text NOT NULL,
	`generated_at` integer NOT NULL
);
