CREATE TABLE `club_logos` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace` text NOT NULL,
	`club_id` text NOT NULL,
	`website` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `club_logos_workspace` ON `club_logos` (`workspace`);