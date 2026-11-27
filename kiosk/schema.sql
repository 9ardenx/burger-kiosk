PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS menu (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL,
    kind TEXT NOT NULL, base_price INTEGER NOT NULL CHECK(base_price >= 0),
    is_sold_out INTEGER NOT NULL DEFAULT 0 CHECK(is_sold_out IN (0,1)),
    category TEXT NOT NULL DEFAULT 'burger', photo_key TEXT, registration_key TEXT, choice_groups TEXT NOT NULL DEFAULT '[]',
    version INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS menu_option (
    id INTEGER PRIMARY KEY, menu_id INTEGER NOT NULL REFERENCES menu(id),
    name TEXT NOT NULL, extra_price INTEGER NOT NULL CHECK(extra_price >= 0), active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY, customer TEXT NOT NULL, request_key TEXT NOT NULL,
    cart_signature TEXT NOT NULL, total_amount INTEGER NOT NULL,
    number INTEGER UNIQUE, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, cancelled_at TEXT,
    cancelled_by TEXT, cancel_reason TEXT, dining_type TEXT, restock_on_cancel INTEGER,
    status TEXT NOT NULL DEFAULT 'PENDING_PAYMENT'
        CHECK(status IN ('PENDING_PAYMENT','PAID','PREPARING','READY','COMPLETED')),
    UNIQUE(customer, request_key)
);
CREATE TABLE IF NOT EXISTS order_item (
    id INTEGER PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id),
    menu_id INTEGER NOT NULL REFERENCES menu(id), name TEXT NOT NULL,
    choice_snapshot TEXT NOT NULL DEFAULT '[]', item_price INTEGER NOT NULL, quantity INTEGER NOT NULL CHECK(quantity > 0)
);
CREATE TABLE IF NOT EXISTS order_item_option (
    id INTEGER PRIMARY KEY, order_item_id INTEGER NOT NULL REFERENCES order_item(id),
    option_id INTEGER NOT NULL REFERENCES menu_option(id), name TEXT NOT NULL, option_price INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS payment (
    id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id), request_key TEXT NOT NULL,
    mode TEXT NOT NULL, amount INTEGER NOT NULL, status TEXT NOT NULL
        CHECK(status IN ('PENDING','SUCCESS','FAILED')),
    pg_tid TEXT UNIQUE, method TEXT, paid_at TEXT,
    UNIQUE(order_id, request_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_open_payment ON payment(order_id) WHERE status='PENDING';
CREATE UNIQUE INDEX IF NOT EXISTS one_paid_payment ON payment(order_id) WHERE status='SUCCESS';
CREATE INDEX IF NOT EXISTS order_items_by_order ON order_item(order_id);
CREATE INDEX IF NOT EXISTS options_by_item ON order_item_option(order_item_id);
CREATE INDEX IF NOT EXISTS payments_by_order ON payment(order_id);

CREATE TABLE IF NOT EXISTS inventory (
    menu_id INTEGER PRIMARY KEY REFERENCES menu(id), enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
    quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity>=0), low_threshold INTEGER NOT NULL DEFAULT 5 CHECK(low_threshold>=0),
    revision INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS inventory_movement (
    id INTEGER PRIMARY KEY AUTOINCREMENT, menu_id INTEGER NOT NULL REFERENCES menu(id), order_id TEXT REFERENCES orders(id),
    kind TEXT NOT NULL, delta INTEGER NOT NULL, before_quantity INTEGER NOT NULL, after_quantity INTEGER NOT NULL,
    reason TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS inventory_order_movement ON inventory_movement(order_id,menu_id,kind);

CREATE TABLE IF NOT EXISTS menu_photo (key TEXT PRIMARY KEY, content BLOB NOT NULL);

CREATE TABLE IF NOT EXISTS menu_display_order (
    id INTEGER PRIMARY KEY CHECK(id=1), menu_ids TEXT NOT NULL DEFAULT '[]',
    revision INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS category_catalog(id INTEGER PRIMARY KEY,items TEXT NOT NULL DEFAULT '[]',revision INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS admin_auth(id INTEGER PRIMARY KEY,password_hash TEXT,salt TEXT,iterations INTEGER NOT NULL DEFAULT 100000,revision INTEGER NOT NULL DEFAULT 0,recovery_hash TEXT,changed_at TEXT);
CREATE TABLE IF NOT EXISTS auth_attempt(key TEXT PRIMARY KEY,count INTEGER NOT NULL DEFAULT 0,expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS ad_catalog(id INTEGER PRIMARY KEY,items TEXT NOT NULL DEFAULT '[]',revision INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS ad_photo(key TEXT PRIMARY KEY,content BLOB NOT NULL);
CREATE TABLE IF NOT EXISTS promotion_catalog (
 id INTEGER PRIMARY KEY, items TEXT NOT NULL DEFAULT '[]', revision INTEGER NOT NULL DEFAULT 0
);
