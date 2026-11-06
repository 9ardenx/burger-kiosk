ALTER TABLE `menu` ADD `category` text DEFAULT 'burger' NOT NULL;--> statement-breakpoint
ALTER TABLE `menu` ADD `photo_key` text;--> statement-breakpoint
ALTER TABLE `menu` ADD `registration_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `menu_registration_key_unique` ON `menu` (`registration_key`);--> statement-breakpoint
ALTER TABLE `menu_option` ADD `active` integer DEFAULT 1 NOT NULL;