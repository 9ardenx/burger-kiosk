-- The payment update and these inventory writes share one transaction.
CREATE TRIGGER IF NOT EXISTS inventory_on_paid BEFORE UPDATE OF status ON orders
WHEN OLD.status='PENDING_PAYMENT' AND NEW.status='PAID'
BEGIN
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM inventory s JOIN order_item i ON i.menu_id=s.menu_id
    WHERE i.order_id=NEW.id AND s.enabled=1 GROUP BY s.menu_id
    HAVING sum(i.quantity)>s.quantity
  ) THEN RAISE(ABORT,'STOCK_UNAVAILABLE') END;
  INSERT INTO inventory_movement(menu_id,order_id,kind,delta,before_quantity,after_quantity,reason)
    SELECT s.menu_id,NEW.id,'SALE',-sum(i.quantity),s.quantity,s.quantity-sum(i.quantity),'주문 승인'
    FROM inventory s JOIN order_item i ON i.menu_id=s.menu_id
    WHERE i.order_id=NEW.id AND s.enabled=1 GROUP BY s.menu_id;
  UPDATE inventory SET quantity=quantity-(SELECT sum(i.quantity) FROM order_item i WHERE i.order_id=NEW.id AND i.menu_id=inventory.menu_id),
    revision=revision+1 WHERE enabled=1 AND menu_id IN (SELECT menu_id FROM order_item WHERE order_id=NEW.id);
END;

CREATE TRIGGER IF NOT EXISTS inventory_on_cancel AFTER UPDATE OF cancelled_at ON orders
WHEN OLD.cancelled_at IS NULL AND NEW.cancelled_at IS NOT NULL AND NEW.restock_on_cancel=1
BEGIN
  -- Only quantities actually deducted from this order can be returned.
  INSERT INTO inventory_movement(menu_id,order_id,kind,delta,before_quantity,after_quantity,reason)
    SELECT s.menu_id,NEW.id,'RETURN',-h.delta,s.quantity,s.quantity-h.delta,'주문 취소 · 재고 복원'
    FROM inventory_movement h JOIN inventory s ON s.menu_id=h.menu_id
    WHERE h.order_id=NEW.id AND h.kind='SALE';
  UPDATE inventory SET quantity=quantity-(SELECT h.delta FROM inventory_movement h
      WHERE h.order_id=NEW.id AND h.kind='SALE' AND h.menu_id=inventory.menu_id),revision=revision+1
    WHERE menu_id IN (SELECT menu_id FROM inventory_movement WHERE order_id=NEW.id AND kind='SALE');
END;
