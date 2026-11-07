ALTER TABLE `report_titles` ADD `hidden_on_hold` integer DEFAULT false NOT NULL;
UPDATE `report_titles` SET `hidden_on_hold` = 1 WHERE `resume_year_week` IS NOT NULL;
UPDATE `report_titles` SET `resume_year_week` = NULL;
