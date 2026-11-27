CREATE TABLE store(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
INSERT INTO store(id,name) VALUES(1,'기존 매장');
ALTER TABLE menu ADD COLUMN store_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE orders ADD COLUMN store_id INTEGER NOT NULL DEFAULT 1;
CREATE INDEX menu_by_store ON menu(store_id,id);
CREATE INDEX orders_by_store ON orders(store_id,created_at);
DROP INDEX orders_number_unique;
CREATE UNIQUE INDEX orders_store_number_unique ON orders(store_id,number);
CREATE TABLE staff_account(uid TEXT PRIMARY KEY,email TEXT NOT NULL,platform_role TEXT NOT NULL DEFAULT 'USER' CHECK(platform_role IN ('USER','HQ')),enabled INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE store_member(store_id INTEGER NOT NULL REFERENCES store(id),uid TEXT NOT NULL REFERENCES staff_account(uid),role TEXT NOT NULL CHECK(role IN ('OWNER','STAFF')),enabled INTEGER NOT NULL DEFAULT 1,revision INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(store_id,uid));
CREATE TABLE store_invitation(id TEXT PRIMARY KEY,store_id INTEGER NOT NULL REFERENCES store(id),email TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('OWNER','STAFF')),created_by TEXT NOT NULL,expires INTEGER NOT NULL,accepted_uid TEXT,revoked INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX invitations_by_email ON store_invitation(email,expires);
CREATE TABLE account_audit(id INTEGER PRIMARY KEY AUTOINCREMENT,store_id INTEGER,actor TEXT NOT NULL,action TEXT NOT NULL,target TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE account_policy(id INTEGER PRIMARY KEY,legacy_disabled INTEGER NOT NULL DEFAULT 0);
INSERT INTO account_policy(id) VALUES(1);
-- Enforce the same store for every order/menu association even in a racing write.
CREATE TRIGGER same_store_order_item BEFORE INSERT ON order_item BEGIN
 SELECT CASE WHEN (SELECT store_id FROM menu WHERE id=NEW.menu_id)!=(SELECT store_id FROM orders WHERE id=NEW.order_id) THEN RAISE(ABORT,'STORE_MISMATCH') END;
END;

CREATE TRIGGER menu_store_insert BEFORE INSERT ON menu BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM store WHERE id=NEW.store_id) THEN RAISE(ABORT,'STORE_MISMATCH') END;
END;
CREATE TRIGGER orders_store_insert BEFORE INSERT ON orders BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM store WHERE id=NEW.store_id) THEN RAISE(ABORT,'STORE_MISMATCH') END;
END;
CREATE TRIGGER menu_store_immutable BEFORE UPDATE OF store_id ON menu WHEN NEW.store_id!=OLD.store_id BEGIN
 SELECT RAISE(ABORT,'STORE_MISMATCH');
END;
CREATE TRIGGER orders_store_immutable BEFORE UPDATE OF store_id ON orders WHEN NEW.store_id!=OLD.store_id BEGIN
 SELECT RAISE(ABORT,'STORE_MISMATCH');
END;
