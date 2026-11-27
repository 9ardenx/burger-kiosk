-- Only newly accepted orders produce an event; existing orders are not backfilled.
CREATE TRIGGER IF NOT EXISTS order_notification_paid AFTER UPDATE OF status ON orders
WHEN NEW.status='PAID' AND OLD.status!='PAID'
BEGIN
 INSERT OR IGNORE INTO order_notification(store_id,order_id) VALUES(NEW.store_id,NEW.id);
 INSERT OR IGNORE INTO notification_delivery(event_id,subscription_id,generation)
 SELECT n.id,p.id,p.generation FROM order_notification n
 JOIN push_subscription p ON p.store_id=n.store_id
 JOIN staff_account a ON a.uid=p.uid
 JOIN store s ON s.id=n.store_id
 WHERE n.order_id=NEW.id AND p.enabled=1 AND p.expires>unixepoch()*1000
 AND a.enabled=1 AND s.enabled=1 AND (a.platform_role='HQ' OR EXISTS(
  SELECT 1 FROM store_member m WHERE m.uid=p.uid AND m.store_id=n.store_id AND m.enabled=1));
END;
