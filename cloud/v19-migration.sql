ALTER TABLE store ADD COLUMN opening_key TEXT;
ALTER TABLE store ADD COLUMN opening_signature TEXT;
ALTER TABLE store ADD COLUMN opening_tag TEXT;
ALTER TABLE store ADD COLUMN template_store_id INTEGER;
CREATE UNIQUE INDEX store_opening_key_unique ON store(opening_key);
