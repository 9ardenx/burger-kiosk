CREATE TABLE order_notification (
 id INTEGER PRIMARY KEY AUTOINCREMENT, store_id INTEGER NOT NULL REFERENCES store(id),
 order_id TEXT NOT NULL REFERENCES orders(id), created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000)
);
CREATE UNIQUE INDEX notification_one_order ON order_notification(order_id);
CREATE INDEX notification_store_cursor ON order_notification(store_id,id);
CREATE TABLE push_subscription (
 id TEXT PRIMARY KEY,uid TEXT NOT NULL REFERENCES staff_account(uid),store_id INTEGER NOT NULL REFERENCES store(id),
 endpoint TEXT NOT NULL,p256dh TEXT NOT NULL,auth TEXT NOT NULL,generation TEXT NOT NULL,
 enabled INTEGER NOT NULL DEFAULT 1,expires INTEGER NOT NULL,last_test INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX push_store_user ON push_subscription(store_id,uid,enabled);
CREATE TABLE notification_delivery (
 event_id INTEGER NOT NULL REFERENCES order_notification(id),subscription_id TEXT NOT NULL REFERENCES push_subscription(id),
 generation TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'PENDING',attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt INTEGER NOT NULL DEFAULT 0,lease TEXT,last_result TEXT,
 PRIMARY KEY(event_id,subscription_id)
);
CREATE INDEX delivery_pending ON notification_delivery(status,next_attempt);
