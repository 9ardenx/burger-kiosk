-- Pricing uses the database clock, always in Korea time. End time is exclusive.
CREATE VIEW IF NOT EXISTS active_promotions AS
WITH clock AS (SELECT datetime('now','+9 hours') AS local_now),
raw AS (
 SELECT p.value AS payload, json_extract(p.value,'$.id') AS id,
   json_extract(p.value,'$.start_time') AS starts, json_extract(p.value,'$.end_time') AS ends,
   local_now, strftime('%H:%M',local_now) AS local_time
 FROM promotion_catalog c,json_each(c.items) p,clock
 WHERE c.id=1 AND json_extract(p.value,'$.enabled')=1
), anchored AS (
 SELECT *,CASE WHEN starts>ends AND local_time<ends THEN date(local_now,'-1 day') ELSE date(local_now) END AS anchor_date
 FROM raw
)
SELECT payload,id,
 datetime(date(anchor_date,CASE WHEN starts>ends OR ends='24:00' THEN '+1 day' ELSE '+0 day' END)||' '||
   CASE WHEN ends='24:00' THEN '00:00' ELSE ends END||':00','-9 hours') AS ends_at
FROM anchored
WHERE ((starts<ends AND local_time>=starts AND local_time<ends) OR (starts>ends AND (local_time>=starts OR local_time<ends)))
 AND CAST(strftime('%w',anchor_date) AS INTEGER) IN (SELECT value FROM json_each(json_extract(payload,'$.weekdays')))
 AND (json_extract(payload,'$.start_date') IS NULL OR anchor_date>=json_extract(payload,'$.start_date'))
 AND (json_extract(payload,'$.end_date') IS NULL OR anchor_date<=json_extract(payload,'$.end_date'));

CREATE VIEW IF NOT EXISTS menu_pricing AS
WITH candidates AS (
 SELECT m.id,m.base_price,p.payload,p.ends_at,
  CASE WHEN json_extract(p.payload,'$.mode')='PERCENT'
   THEN CAST(m.base_price*(100-json_extract(p.payload,'$.value'))/100 AS INTEGER)
   ELSE json_extract(p.payload,'$.value') END AS discounted
 FROM menu m JOIN active_promotions p
  ON m.id IN (SELECT value FROM json_each(json_extract(p.payload,'$.menu_ids')))
), ranked AS (
 SELECT *,row_number() OVER (PARTITION BY id ORDER BY discounted,json_extract(payload,'$.id')) AS rank
 FROM candidates WHERE discounted<base_price
)
SELECT m.id,m.base_price AS original_price,coalesce(r.discounted,m.base_price) AS sale_price,
 json_extract(r.payload,'$.id') AS promotion_id,r.payload AS promotion,r.ends_at
FROM menu m LEFT JOIN ranked r ON r.id=m.id AND r.rank=1;

-- Legacy ordinary prices keep their existing snapshot policy. A newly active,
-- changed or expired discount requires a fresh checkout before a demo approval.
CREATE TRIGGER IF NOT EXISTS promotion_before_payment_insert BEFORE INSERT ON payment
WHEN NEW.status='SUCCESS' AND NEW.mode='demo'
BEGIN
 SELECT CASE WHEN EXISTS(
  SELECT 1 FROM order_item i JOIN menu_pricing q ON q.id=i.menu_id WHERE i.order_id=NEW.order_id
   AND (i.promotion IS NOT NULL OR q.promotion IS NOT NULL)
   AND (coalesce(i.regular_price,i.price)!=q.original_price OR i.price!=q.sale_price
     OR coalesce(json_extract(i.promotion,'$.id'),'')!=coalesce(q.promotion_id,''))
 ) THEN RAISE(ABORT,'PROMOTION_CHANGED') END;
END;

CREATE TRIGGER IF NOT EXISTS promotion_before_payment_update BEFORE UPDATE OF status ON payment
WHEN OLD.status!='SUCCESS' AND NEW.status='SUCCESS' AND NEW.mode='demo'
BEGIN
 SELECT CASE WHEN EXISTS(
  SELECT 1 FROM order_item i JOIN menu_pricing q ON q.id=i.menu_id WHERE i.order_id=NEW.order_id
   AND (i.promotion IS NOT NULL OR q.promotion IS NOT NULL)
   AND (coalesce(i.regular_price,i.price)!=q.original_price OR i.price!=q.sale_price
     OR coalesce(json_extract(i.promotion,'$.id'),'')!=coalesce(q.promotion_id,''))
 ) THEN RAISE(ABORT,'PROMOTION_CHANGED') END;
END;
