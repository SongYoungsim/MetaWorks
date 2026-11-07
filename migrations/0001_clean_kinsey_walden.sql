ALTER TABLE `action_progress` ADD `due_date` text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE `action_progress` SET `due_date` = `progress_date` WHERE `due_date` = '';
