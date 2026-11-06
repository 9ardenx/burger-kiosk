CREATE TABLE `order_item_option` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`option_id` integer NOT NULL,
	`name` text NOT NULL,
	`option_price` integer NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `order_item`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`option_id`) REFERENCES `menu_option`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `options_by_item` ON `order_item_option` (`item_id`);--> statement-breakpoint
CREATE TABLE `order_item` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`menu_id` integer NOT NULL,
	`name` text NOT NULL,
	`quantity` integer NOT NULL,
	`price` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`menu_id`) REFERENCES `menu`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `items_by_order` ON `order_item` (`order_id`);--> statement-breakpoint
CREATE TABLE `menu` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`kind` text NOT NULL,
	`base_price` integer NOT NULL,
	`is_sold_out` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `menu_option` (
	`id` integer PRIMARY KEY NOT NULL,
	`menu_id` integer NOT NULL,
	`name` text NOT NULL,
	`extra_price` integer NOT NULL,
	FOREIGN KEY (`menu_id`) REFERENCES `menu`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`customer` text NOT NULL,
	`signature` text NOT NULL,
	`total` integer NOT NULL,
	`status` text DEFAULT 'PENDING_PAYMENT' NOT NULL,
	`number` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`creation_tag` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_number_unique` ON `orders` (`number`);--> statement-breakpoint
CREATE TABLE `payment` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`status` text NOT NULL,
	`amount` integer NOT NULL,
	`mode` text DEFAULT 'demo' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `payments_by_order` ON `payment` (`order_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `one_success` ON `payment` (`order_id`) WHERE status = 'SUCCESS';--> statement-breakpoint
CREATE TABLE `admin_session` (
	`digest` text PRIMARY KEY NOT NULL,
	`expires` integer NOT NULL
);
