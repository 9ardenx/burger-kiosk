ALTER TABLE order_item ADD COLUMN menu_version integer;
CREATE TABLE toss_checkout (
 payment_id text PRIMARY KEY NOT NULL REFERENCES payment(id),
 payment_key text,
 phase text NOT NULL DEFAULT 'OPEN',
 confirm_started integer NOT NULL DEFAULT 0,
 cancel_requested integer NOT NULL DEFAULT 0,
 lease_owner text,
 lease_until integer NOT NULL DEFAULT 0,
 last_error text NOT NULL DEFAULT '',
 updated_at integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX one_active_payment ON payment(order_id) WHERE status IN ('PENDING','SUCCESS');
CREATE UNIQUE INDEX toss_payment_key_unique ON toss_checkout(payment_key);
