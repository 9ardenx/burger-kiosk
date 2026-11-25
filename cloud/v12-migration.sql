CREATE TABLE menu_display_order (
    id INTEGER PRIMARY KEY NOT NULL,
    menu_ids TEXT NOT NULL DEFAULT '[]',
    revision INTEGER NOT NULL DEFAULT 0
);
ALTER TABLE orders ADD COLUMN cancelled_at TEXT;
