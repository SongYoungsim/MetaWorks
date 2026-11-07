INSERT INTO `departments` (`code`, `name`, `sort_order`, `is_active`)
VALUES
	('T01', '경영지원팀', 1, true),
	('T02', '사업개발(덴탈)', 2, true),
	('T03', '사업개발(미용)', 3, true),
	('T04', '구매(덴탈)', 4, true),
	('T05', '구매(미용)', 5, true),
	('T06', '생산팀', 6, true),
	('T07', '품질경영팀', 7, true),
	('T08', '연구소', 8, true),
	('T09', 'RA팀', 9, true)
ON CONFLICT (`code`) DO UPDATE SET
	`name` = excluded.`name`,
	`sort_order` = excluded.`sort_order`,
	`is_active` = true,
	`updated_at` = (unixepoch('subsec') * 1000);
