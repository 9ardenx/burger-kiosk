CREATE TABLE ingredient (
 id INTEGER PRIMARY KEY AUTOINCREMENT, registration_key TEXT NOT NULL UNIQUE,
 name TEXT NOT NULL, unit TEXT NOT NULL, pack_label TEXT NOT NULL, pack_size INTEGER NOT NULL CHECK(pack_size BETWEEN 1 AND 1000000),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), revision INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE ingredient_stock (
 store_id INTEGER NOT NULL REFERENCES store(id), ingredient_id INTEGER NOT NULL REFERENCES ingredient(id),
 quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity BETWEEN 0 AND 1000000000), low_threshold INTEGER NOT NULL DEFAULT 0 CHECK(low_threshold BETWEEN 0 AND 1000000000),
 revision INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(store_id,ingredient_id)
);
CREATE TABLE supply_order (
 id TEXT PRIMARY KEY, store_id INTEGER NOT NULL REFERENCES store(id), request_key TEXT NOT NULL, signature TEXT NOT NULL,
 creation_tag TEXT NOT NULL, action_tag TEXT, requested_by TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'REQUESTED' CHECK(status IN ('REQUESTED','APPROVED','SHIPPED','PARTIAL','RECEIVED','CANCELLED','REJECTED')),
 revision INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(store_id,request_key)
);
CREATE INDEX supply_order_store_status ON supply_order(store_id,status,created_at);
CREATE TABLE supply_line (
 id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES supply_order(id), ingredient_id INTEGER NOT NULL REFERENCES ingredient(id),
 name TEXT NOT NULL, unit TEXT NOT NULL, pack_label TEXT NOT NULL, pack_size INTEGER NOT NULL,
 packs INTEGER NOT NULL CHECK(packs BETWEEN 1 AND 10000), ordered_units INTEGER NOT NULL CHECK(ordered_units BETWEEN 1 AND 1000000000),
 received_units INTEGER NOT NULL DEFAULT 0 CHECK(received_units>=0 AND received_units<=ordered_units), UNIQUE(order_id,ingredient_id)
);
CREATE TABLE supply_receipt (
 id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES supply_order(id), store_id INTEGER NOT NULL REFERENCES store(id),
 request_key TEXT NOT NULL, signature TEXT NOT NULL, creation_tag TEXT NOT NULL, actor TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(store_id,request_key)
);
CREATE TABLE supply_receipt_line (
 receipt_id TEXT NOT NULL REFERENCES supply_receipt(id), line_id TEXT NOT NULL REFERENCES supply_line(id),
 quantity INTEGER NOT NULL CHECK(quantity>0), PRIMARY KEY(receipt_id,line_id)
);
CREATE TABLE ingredient_movement (
 id INTEGER PRIMARY KEY AUTOINCREMENT, store_id INTEGER NOT NULL REFERENCES store(id), ingredient_id INTEGER NOT NULL REFERENCES ingredient(id),
 kind TEXT NOT NULL CHECK(kind IN ('ADJUST','RECEIPT')), delta INTEGER NOT NULL, before_quantity INTEGER NOT NULL, after_quantity INTEGER NOT NULL,
 reason TEXT NOT NULL, actor TEXT NOT NULL, receipt_id TEXT REFERENCES supply_receipt(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(receipt_id,ingredient_id)
);
CREATE INDEX ingredient_movement_store ON ingredient_movement(store_id,id);
CREATE TABLE supply_event (
 id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL REFERENCES supply_order(id), status TEXT NOT NULL, actor TEXT NOT NULL,
 note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
