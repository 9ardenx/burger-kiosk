"""Finished-menu quantities, optimistic edits and an immutable movement ledger."""
from collections import Counter
from .store import Problem, integer


def inventory_state(db):
    items = [dict(r) for r in db.execute('''SELECT m.id,m.name,m.category,m.photo_key,m.kind,m.is_sold_out,
        coalesce(s.enabled,0) AS enabled,coalesce(s.quantity,0) AS quantity,
        coalesce(s.low_threshold,5) AS low_threshold,coalesce(s.revision,0) AS revision
        FROM menu m LEFT JOIN inventory s ON s.menu_id=m.id ORDER BY m.id''')]
    history = [dict(r) for r in db.execute('''SELECT h.*,m.name,o.number FROM inventory_movement h
        JOIN menu m ON m.id=h.menu_id LEFT JOIN orders o ON o.id=h.order_id ORDER BY h.id DESC LIMIT 100''')]
    return {'items': items, 'history': history}


def save_inventory(db, menu_id, data):
    enabled = data.get('enabled')
    if type(enabled) is not bool:
        raise Problem('수량 관리 사용 여부를 선택해 주세요.')
    quantity = integer(data.get('quantity'), 0, 1000000, '수량')
    threshold = integer(data.get('low_threshold'), 0, 1000000, '부족 알림 기준')
    revision = integer(data.get('revision'), 0, 2**31-1, '재고 버전')
    reason = data.get('reason')
    if not isinstance(reason, str) or not 1 <= len(reason.strip()) <= 200:
        raise Problem('변경 사유를 1~200자로 입력해 주세요.')
    if not db.execute('SELECT 1 FROM menu WHERE id=?', (menu_id,)).fetchone():
        raise Problem('메뉴를 찾을 수 없습니다.', 404)
    if enabled and db.execute('''SELECT 1 FROM payment p JOIN order_item i ON i.order_id=p.order_id
            WHERE i.menu_id=? AND p.mode!='demo' AND p.status='PENDING' ''', (menu_id,)).fetchone():
        raise Problem('진행 중인 PG 결제를 확인한 뒤 수량 관리를 시작해 주세요.', 409, 'PAYMENT_IN_PROGRESS')
    db.execute('INSERT OR IGNORE INTO inventory(menu_id) VALUES(?)', (menu_id,))
    row = db.execute('SELECT * FROM inventory WHERE menu_id=?', (menu_id,)).fetchone()
    if row['revision'] != revision:
        raise Problem('판매나 다른 관리자의 수정으로 재고가 바뀌었습니다. 최신 수량을 불러온 뒤 다시 입력해 주세요.', 409, 'INVENTORY_CHANGED')
    db.execute('''INSERT INTO inventory_movement(menu_id,kind,delta,before_quantity,after_quantity,reason)
        VALUES(?,'ADJUST',?,?,?,?)''', (menu_id, quantity-row['quantity'], row['quantity'], quantity,
        reason.strip()+(' · 수량 관리 사용' if enabled else ' · 수량 관리 중지')))
    db.execute('UPDATE inventory SET enabled=?,quantity=?,low_threshold=?,revision=revision+1 WHERE menu_id=?',
               (enabled, quantity, threshold, menu_id))
    return {'ok': True}


def check_stock(db, cart):
    counts = Counter()
    for line in cart:
        counts[line['menu_id']] += line['quantity']
    for row in db.execute('SELECT s.menu_id,s.quantity,m.name FROM inventory s JOIN menu m ON m.id=s.menu_id WHERE s.enabled=1'):
        if counts[row['menu_id']] > row['quantity']:
            raise Problem(f"{row['name']} 판매 가능 수량이 부족합니다. 장바구니 수량을 줄여 주세요.", 409, 'CART_CHANGED')
