PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS menu (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL,
    kind TEXT NOT NULL, base_price INTEGER NOT NULL CHECK(base_price >= 0),
    is_sold_out INTEGER NOT NULL DEFAULT 0 CHECK(is_sold_out IN (0,1)),
    version INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS menu_option (
    id INTEGER PRIMARY KEY, menu_id INTEGER NOT NULL REFERENCES menu(id),
    name TEXT NOT NULL, extra_price INTEGER NOT NULL CHECK(extra_price >= 0)
);
CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY, customer TEXT NOT NULL, request_key TEXT NOT NULL,
    cart_signature TEXT NOT NULL, total_amount INTEGER NOT NULL,
    number INTEGER UNIQUE, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status TEXT NOT NULL DEFAULT 'PENDING_PAYMENT'
        CHECK(status IN ('PENDING_PAYMENT','PAID','PREPARING','READY','COMPLETED')),
    UNIQUE(customer, request_key)
);
CREATE TABLE IF NOT EXISTS order_item (
    id INTEGER PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id),
    menu_id INTEGER NOT NULL REFERENCES menu(id), name TEXT NOT NULL,
    item_price INTEGER NOT NULL, quantity INTEGER NOT NULL CHECK(quantity > 0)
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
