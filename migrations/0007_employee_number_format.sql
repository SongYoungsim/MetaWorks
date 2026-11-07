UPDATE `employees`
SET `emp_no` = 'S' || printf('%06d', CAST(substr(`emp_no`, 2) AS integer))
WHERE `emp_no` GLOB 'E[0-9]*';
--> statement-breakpoint
DELETE FROM `sequences` WHERE `name` = 'EMP_NO';
