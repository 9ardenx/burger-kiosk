ALTER TABLE `order_item` ADD `choice_snapshot` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `menu` ADD `choice_groups` text DEFAULT '[]' NOT NULL;