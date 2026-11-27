-- The last sale check shares the inventory/order/notification transaction.
CREATE TRIGGER toss_before_paid BEFORE UPDATE OF status ON orders
WHEN OLD.status='PENDING_PAYMENT' AND NEW.status='PAID'
 AND EXISTS(SELECT 1 FROM payment WHERE order_id=NEW.id AND mode='toss_test' AND status='SUCCESS')
BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM store WHERE id=NEW.store_id AND enabled=1)
 OR EXISTS(SELECT 1 FROM order_item i JOIN menu m ON m.id=i.menu_id JOIN menu_pricing q ON q.id=m.id
 WHERE i.order_id=NEW.id AND (m.is_sold_out=1 OR (i.menu_version IS NOT NULL AND i.menu_version!=m.version)
 OR i.price!=q.sale_price OR coalesce(json_extract(i.promotion,'$.id'),'')!=coalesce(q.promotion_id,'')))
 THEN RAISE(ABORT,'TOSS_SALE_CHANGED') END;
END;
