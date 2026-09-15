CREATE TABLE `assistant_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace` text NOT NULL,
	`created` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `assistant_jobs_workspace_created` ON `assistant_jobs` (`workspace`,`created`);