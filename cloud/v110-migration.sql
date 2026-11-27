ALTER TABLE store ADD COLUMN address TEXT;
ALTER TABLE store ADD COLUMN address_detail TEXT;
ALTER TABLE store ADD COLUMN locality TEXT;
ALTER TABLE store ADD COLUMN address_pending INTEGER NOT NULL DEFAULT 0;
ALTER TABLE store ADD COLUMN profile_revision INTEGER NOT NULL DEFAULT 0;
CREATE TABLE menu_identity(menu_id INTEGER PRIMARY KEY REFERENCES menu(id),product_code TEXT NOT NULL);
CREATE INDEX menu_identity_product ON menu_identity(product_code);
-- Existing orders/menu/photo rows remain unchanged. Proven copy lineage only;
-- unrelated menus with the same display name retain different identities.
WITH RECURSIVE lineage(menu_id,product_code) AS (
 SELECT m.id,'MENU-'||m.id FROM menu m WHERE NOT EXISTS(
  SELECT 1 FROM store s JOIN menu p ON p.store_id=s.template_store_id
  WHERE s.id=m.store_id AND m.registration_key='franchise:'||s.opening_tag||':'||p.id)
 UNION ALL
 SELECT m.id,l.product_code FROM lineage l JOIN menu p ON p.id=l.menu_id
 JOIN store s ON s.template_store_id=p.store_id JOIN menu m ON m.store_id=s.id
 WHERE m.registration_key='franchise:'||s.opening_tag||':'||p.id
) INSERT INTO menu_identity(menu_id,product_code) SELECT menu_id,product_code FROM lineage;
