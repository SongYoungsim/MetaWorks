CREATE TABLE `ai_risk_notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`action_id` integer NOT NULL,
	`recipient_id` integer NOT NULL,
	`sent_by` integer NOT NULL,
	`sent_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`action_id`) REFERENCES `action_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recipient_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sent_by`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_ai_risk_action_sent` ON `ai_risk_notifications` (`action_id`,`sent_at`);
