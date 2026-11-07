INSERT INTO `codes` (`group_code`, `code`, `name`, `sort_order`, `is_active`)
VALUES
	('POSITION', 'P01', '대표', 1, true),
	('POSITION', 'P02', '상무', 2, true),
	('POSITION', 'P03', '이사', 3, true),
	('POSITION', 'P04', '본부장', 4, true),
	('POSITION', 'P05', '부장', 5, true),
	('POSITION', 'P06', '차장', 6, true),
	('POSITION', 'P07', '과장', 7, true),
	('POSITION', 'P08', '대리', 8, true),
	('POSITION', 'P09', '사원', 9, true)
ON CONFLICT (`group_code`, `code`) DO UPDATE SET
	`name` = excluded.`name`,
	`sort_order` = excluded.`sort_order`,
	`is_active` = true,
	`updated_at` = (unixepoch('subsec') * 1000);
