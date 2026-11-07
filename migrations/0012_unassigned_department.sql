INSERT INTO `departments` (`code`, `name`, `sort_order`, `is_active`)
VALUES ('T00', '소속없음', 0, true)
ON CONFLICT (`code`) DO UPDATE SET
	`name` = excluded.`name`,
	`sort_order` = excluded.`sort_order`,
	`is_active` = true,
	`updated_at` = (unixepoch('subsec') * 1000);
