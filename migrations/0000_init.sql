CREATE TABLE `action_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`display_no` text NOT NULL,
	`meeting_id` integer,
	`meeting_type_code` text NOT NULL,
	`meeting_date` text NOT NULL,
	`department_id` integer NOT NULL,
	`subject` text NOT NULL,
	`request` text NOT NULL,
	`status` text DEFAULT 'unregistered' NOT NULL,
	`completed_date` text,
	`is_completed` integer DEFAULT false NOT NULL,
	`latest_progress_text` text,
	`latest_progress_date` text,
	`created_by` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`meeting_id`) REFERENCES `meetings`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `action_items_display_no_unique` ON `action_items` (`display_no`);--> statement-breakpoint
CREATE INDEX `idx_actions_dept_status` ON `action_items` (`department_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_actions_meeting_date` ON `action_items` (`meeting_date`);--> statement-breakpoint
CREATE TABLE `action_progress` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`action_id` integer NOT NULL,
	`progress_date` text NOT NULL,
	`status` text NOT NULL,
	`content` text NOT NULL,
	`author_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`action_id`) REFERENCES `action_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`author_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_progress_action` ON `action_progress` (`action_id`);--> statement-breakpoint
CREATE TABLE `ai_conversations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`title` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_ai_conv_employee` ON `ai_conversations` (`employee_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `ai_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`conversation_id` integer NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`sources` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `ai_conversations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_ai_msg_conv` ON `ai_messages` (`conversation_id`);--> statement-breakpoint
CREATE TABLE `attachments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_type` text NOT NULL,
	`owner_id` integer,
	`r2_key` text NOT NULL,
	`file_name` text NOT NULL,
	`mime_type` text NOT NULL,
	`size` integer NOT NULL,
	`uploaded_by` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attachments_r2_key_unique` ON `attachments` (`r2_key`);--> statement-breakpoint
CREATE INDEX `idx_attachments_owner` ON `attachments` (`owner_type`,`owner_id`);--> statement-breakpoint
CREATE TABLE `attendances` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`type` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`note` text,
	`created_by` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_attendances_period` ON `attendances` (`start_date`,`end_date`);--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`actor_id` integer,
	`action` text NOT NULL,
	`target_type` text,
	`target_id` text,
	`before` text,
	`after` text,
	`ip` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_audit_target` ON `audit_logs` (`target_type`,`target_id`);--> statement-breakpoint
CREATE INDEX `idx_audit_created` ON `audit_logs` (`created_at`);--> statement-breakpoint
CREATE TABLE `codes` (
	`group_code` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	PRIMARY KEY(`group_code`, `code`)
);
--> statement-breakpoint
CREATE TABLE `decision_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entry_id` integer NOT NULL,
	`title_id` integer NOT NULL,
	`department_id` integer NOT NULL,
	`content` text NOT NULL,
	`desired_date` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`requested_by` integer NOT NULL,
	`requested_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`decided_by` integer,
	`decided_at` integer,
	`comment` text,
	FOREIGN KEY (`entry_id`) REFERENCES `title_week_entries`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`title_id`) REFERENCES `report_titles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_decisions_status` ON `decision_requests` (`status`);--> statement-breakpoint
CREATE TABLE `departments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`leader_id` integer,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `departments_code_unique` ON `departments` (`code`);--> statement-breakpoint
CREATE UNIQUE INDEX `departments_name_unique` ON `departments` (`name`);--> statement-breakpoint
CREATE TABLE `employees` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`emp_no` text NOT NULL,
	`login_id` text NOT NULL,
	`name` text NOT NULL,
	`department_id` integer,
	`position` text DEFAULT '' NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`is_clerk` integer DEFAULT false NOT NULL,
	`is_admin` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`password_hash` text NOT NULL,
	`must_change_password` integer DEFAULT true NOT NULL,
	`failed_login_count` integer DEFAULT 0 NOT NULL,
	`locked_until` integer,
	`last_login_at` integer,
	`password_changed_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `employees_emp_no_unique` ON `employees` (`emp_no`);--> statement-breakpoint
CREATE UNIQUE INDEX `employees_login_id_unique` ON `employees` (`login_id`);--> statement-breakpoint
CREATE INDEX `idx_employees_department` ON `employees` (`department_id`);--> statement-breakpoint
CREATE TABLE `meeting_attendees` (
	`meeting_id` integer NOT NULL,
	`employee_id` integer NOT NULL,
	PRIMARY KEY(`meeting_id`, `employee_id`),
	FOREIGN KEY (`meeting_id`) REFERENCES `meetings`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `meetings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`display_no` text,
	`type_code` text NOT NULL,
	`meeting_date` text NOT NULL,
	`time_place` text,
	`chair` text,
	`body` text,
	`body_text` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`clerk_id` integer NOT NULL,
	`published_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`clerk_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `meetings_display_no_unique` ON `meetings` (`display_no`);--> statement-breakpoint
CREATE INDEX `idx_meetings_date` ON `meetings` (`meeting_date`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`recipient_id` integer NOT NULL,
	`type` text NOT NULL,
	`message` text NOT NULL,
	`link` text,
	`is_read` integer DEFAULT false NOT NULL,
	`dedupe_key` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`recipient_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_notifications_recipient` ON `notifications` (`recipient_id`,`is_read`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_notifications_dedupe` ON `notifications` (`recipient_id`,`dedupe_key`);--> statement-breakpoint
CREATE TABLE `report_categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_system` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `report_categories_code_unique` ON `report_categories` (`code`);--> statement-breakpoint
CREATE TABLE `report_details` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`department_id` integer NOT NULL,
	`category_id` integer NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `report_categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_report_details_dept` ON `report_details` (`department_id`,`category_id`,`sort_order`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_report_details_name` ON `report_details` (`department_id`,`category_id`,`name`);--> statement-breakpoint
CREATE TABLE `report_member_completions` (
	`report_id` integer NOT NULL,
	`employee_id` integer NOT NULL,
	`completed_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	PRIMARY KEY(`report_id`, `employee_id`),
	FOREIGN KEY (`report_id`) REFERENCES `weekly_reports`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `report_titles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`department_id` integer NOT NULL,
	`detail_id` integer NOT NULL,
	`number` integer,
	`name` text NOT NULL,
	`owner_id` integer NOT NULL,
	`start_year_week` integer NOT NULL,
	`end_year_week` integer,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_by` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`detail_id`) REFERENCES `report_details`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_report_titles_detail` ON `report_titles` (`detail_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `sequences` (
	`name` text PRIMARY KEY NOT NULL,
	`value` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`last_seen_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`expires_at` integer NOT NULL,
	`ip` text,
	`user_agent` text,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_sessions_employee` ON `sessions` (`employee_id`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_by` integer
);
--> statement-breakpoint
CREATE TABLE `title_week_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title_id` integer NOT NULL,
	`report_id` integer NOT NULL,
	`year_week` integer NOT NULL,
	`detail_id` integer NOT NULL,
	`owner_id` integer NOT NULL,
	`this_week_body` text,
	`this_week_text` text,
	`perform_schedule` text,
	`result` text,
	`next_plan_body` text,
	`next_plan_text` text,
	`due_schedule` text,
	`carried_over` integer DEFAULT false NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_by` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`title_id`) REFERENCES `report_titles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`report_id`) REFERENCES `weekly_reports`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_title_week` ON `title_week_entries` (`title_id`,`year_week`);--> statement-breakpoint
CREATE INDEX `idx_entries_report` ON `title_week_entries` (`report_id`);--> statement-breakpoint
CREATE TABLE `weekly_reports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`department_id` integer NOT NULL,
	`year_week` integer NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`submitted_at` integer,
	`submitted_by` integer,
	`confirmed_at` integer,
	`confirmed_by` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_weekly_reports` ON `weekly_reports` (`department_id`,`year_week`);