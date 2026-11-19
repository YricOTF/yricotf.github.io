CREATE TABLE `race_players` (
	`code` text NOT NULL,
	`id` text NOT NULL,
	`secret` text NOT NULL,
	`name` text NOT NULL,
	`skin` text NOT NULL,
	`joined` integer NOT NULL,
	`seen` integer NOT NULL,
	`ready` integer DEFAULT 0 NOT NULL,
	`round` integer DEFAULT 0 NOT NULL,
	`seq` integer DEFAULT 0 NOT NULL,
	`distance` real DEFAULT 0 NOT NULL,
	`x` real DEFAULT 0 NOT NULL,
	`y` real DEFAULT 0 NOT NULL,
	`slide` integer DEFAULT 0 NOT NULL,
	`done` integer DEFAULT 0 NOT NULL,
	`finish` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`code`, `id`),
	FOREIGN KEY (`code`) REFERENCES `race_rooms`(`code`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `race_players_secret_unique` ON `race_players` (`secret`);--> statement-breakpoint
CREATE TABLE `race_rooms` (
	`code` text PRIMARY KEY NOT NULL,
	`seed` integer NOT NULL,
	`host` text NOT NULL,
	`created` integer NOT NULL,
	`start` integer DEFAULT 0 NOT NULL,
	`round` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `race_rooms_created` ON `race_rooms` (`created`);