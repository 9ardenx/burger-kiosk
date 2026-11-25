CREATE TABLE inventory (
  menu_id INTEGER PRIMARY KEY REFERENCES menu(id), enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity>=0), low_threshold INTEGER NOT NULL DEFAULT 5 CHECK(low_threshold>=0),
  revision INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE inventory_movement (
  id INTEGER PRIMARY KEY AUTOINCREMENT, menu_id INTEGER NOT NULL REFERENCES menu(id), order_id TEXT REFERENCES orders(id),
  kind TEXT NOT NULL, delta INTEGER NOT NULL, before_quantity INTEGER NOT NULL, after_quantity INTEGER NOT NULL,
  reason TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX inventory_order_movement ON inventory_movement(order_id,menu_id,kind);
ALTER TABLE orders ADD COLUMN restock_on_cancel INTEGER;
