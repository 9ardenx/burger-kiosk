"""Order snapshots, checkout revalidation and kitchen state transitions."""
import hashlib
import json
from uuid import uuid4

from .variants import resolve_choices
from .store import Problem, identifier, integer
from .inventory import check_stock
from .promotions import priced_menu

NEXT_STATE = {"PAID": "PREPARING", "PREPARING": "READY", "READY": "COMPLETED"}


def owner_order(db, order_id, customer):
    row = db.execute("SELECT * FROM orders WHERE id=? AND customer=?", (order_id, customer)).fetchone()
    if row is None:
        raise Problem("주문을 찾을 수 없습니다.", 404)
    return row


def order_view(db, row):
    items = []
    for item in db.execute("SELECT * FROM order_item WHERE order_id=? ORDER BY id", (row["id"],)):
        options = [dict(opt) for opt in db.execute(
            "SELECT name,option_price FROM order_item_option WHERE order_item_id=? ORDER BY id", (item["id"],)
        )]
        items.append({"name": item["name"], "quantity": item["quantity"], "price": item["item_price"], "regular_price": item['regular_price'], "promotion": json.loads(item['promotion']) if item['promotion'] else None, "options": json.loads(item["choice_snapshot"]) + options})
    payment = db.execute(
        "SELECT id,status,mode,pg_tid IS NOT NULL AS has_key FROM payment WHERE order_id=? ORDER BY rowid DESC LIMIT 1",
        (row["id"],),
    ).fetchone()
    return {"id": row["id"], "number": row["number"], "status": "CANCELLED" if row["cancelled_at"] else row["status"], "total": row["total_amount"],
            "created_at": row["created_at"], "cancelled_at": row["cancelled_at"],
            "cancelled_by": row["cancelled_by"], "cancel_reason": row["cancel_reason"], "dining_type": row['dining_type'],
            "restock_on_cancel": row['restock_on_cancel'], "items": items, "payment": dict(payment) if payment else None}


def quote_item(db, line):
    if not isinstance(line, dict):
        raise Problem("장바구니 항목을 확인해 주세요.")
    menu_id = integer(line.get("menu_id"), 1, 2**31-1, "메뉴")
    quantity = integer(line.get("quantity"), 1, 99, "수량")
    item = db.execute("SELECT * FROM menu WHERE id=?", (menu_id,)).fetchone()
    if not item or item["is_sold_out"]:
        name = item["name"] if item else "선택한 메뉴"
        raise Problem(f"{name} 품절 · 장바구니를 수정해 주세요.", 409, "CART_CHANGED")
    item = priced_menu(item, db.execute('SELECT * FROM menu_pricing WHERE id=?', (menu_id,)).fetchone())
    choices = line.get("options")
    if not isinstance(choices, list) or len(choices)>20 or any(type(x) is not int for x in choices):
        raise Problem("선택 옵션을 확인해 주세요.")
    available = {r["id"]: r for r in db.execute("SELECT * FROM menu_option WHERE menu_id=? AND active=1", (menu_id,))}
    if len(set(choices)) != len(choices) or not set(choices).issubset(available):
        raise Problem("선택 옵션이 변경되었습니다. 장바구니에서 새 구성을 확인해 주세요.", 409, "CART_CHANGED")
    options = [available[k] for k in sorted(choices)]
    unit = item["base_price"] + sum(option["extra_price"] for option in options)
    try:
        snapshot = resolve_choices(json.loads(item["choice_groups"]), line.get("selections", []), [o["name"] for o in options])
    except ValueError as exc:
        raise Problem(str(exc), 409, "CART_CHANGED") from exc
    unit += sum(choice["option_price"] for choice in snapshot)
    if line.get("expected_version") is not None and line["expected_version"] != item["version"]:
        raise Problem(f"{item['name']} 메뉴 정보가 변경되었습니다. 최신 구성을 확인해 주세요.", 409, "CART_CHANGED")
    if unit != line.get("expected_unit"):
        raise Problem(f"{item['name']} 가격이 변경되었습니다. 새 금액을 확인해 주세요.", 409, "CART_CHANGED")
    return item, options, snapshot, quantity, unit


def create_order(db, customer, data):
    dining_type = data.get('dining_type')
    if dining_type not in (None, 'DINE_IN', 'TAKEOUT'):
        raise Problem('매장 또는 포장을 선택해 주세요.')
    key = identifier(data.get("key"))
    cart = data.get("items")
    if not isinstance(cart, list) or not 1 <= len(cart) <= 50:
        raise Problem("장바구니에 메뉴를 1~50개 항목으로 담아 주세요.")
    signature = hashlib.sha256(json.dumps(cart, sort_keys=True).encode()).hexdigest()
    previous = db.execute("SELECT * FROM orders WHERE customer=? AND request_key=?", (customer, key)).fetchone()
    if previous:
        if previous["cart_signature"] != signature or previous['dining_type'] != dining_type:
            raise Problem("장바구니가 바뀌었습니다. 주문을 다시 확인해 주세요.", 409)
        return order_view(db, previous)
    lines = [quote_item(db, line) for line in cart]
    check_stock(db, cart)
    total = sum(quantity * unit for _, _, _, quantity, unit in lines)
    order_id = uuid4().hex
    db.execute("INSERT INTO orders(id,customer,request_key,cart_signature,total_amount,dining_type) VALUES(?,?,?,?,?,?)",
               (order_id, customer, key, signature, total, dining_type))
    for item, options, snapshot, quantity, _ in lines:
        result = db.execute(
            "INSERT INTO order_item(order_id,menu_id,name,item_price,quantity,choice_snapshot,regular_price,promotion) VALUES(?,?,?,?,?,?,?,?)",
            (order_id, item["id"], item["name"], item["base_price"], quantity, json.dumps(snapshot, ensure_ascii=False), item['original_price'], json.dumps(item['promotion'], ensure_ascii=False) if item['promotion'] else None),
        )
        db.executemany("INSERT INTO order_item_option(order_item_id,option_id,name,option_price) VALUES(?,?,?,?)",
                       [(result.lastrowid, opt["id"], opt["name"], opt["extra_price"]) for opt in options])
    return order_view(db, owner_order(db, order_id, customer))


def advance(db, order_id, expected):
    if not isinstance(expected, str) or expected not in NEXT_STATE:
        raise Problem("다음 단계로 변경할 수 없는 주문입니다.", 409)
    result = db.execute("UPDATE orders SET status=? WHERE id=? AND status=? AND cancelled_at IS NULL",
                        (NEXT_STATE[expected], order_id, expected))
    if result.rowcount != 1:
        raise Problem("주문 상태가 변경되었습니다. 최신 상태를 확인해 주세요.", 409, "ORDER_CHANGED")


def cancel_unpaid(db, order_id, customer):
    row = owner_order(db, order_id, customer)
    if row["cancelled_at"]:
        return order_view(db, row)
    pending = db.execute("SELECT 1 FROM payment WHERE order_id=? AND status IN ('PENDING','SUCCESS')", (order_id,)).fetchone()
    if row["status"] != "PENDING_PAYMENT" or pending:
        raise Problem("결제가 진행 중이거나 완료된 주문입니다. 결제 결과를 먼저 확인해 주세요.", 409, "PAYMENT_IN_PROGRESS")
    db.execute("UPDATE orders SET cancelled_at=CURRENT_TIMESTAMP, cancelled_by='customer' WHERE id=?", (order_id,))
    return order_view(db, owner_order(db, order_id, customer))


def cancel_by_admin(db, order_id, data):
    restock = data.get('restock', data.get('expected') == 'PAID')
    if type(restock) is not bool:
        raise Problem('재고 복원 여부를 선택해 주세요.')
    reason = data.get("reason")
    if not isinstance(reason, str) or not 1 <= len(reason.strip()) <= 200:
        raise Problem("취소 사유를 1~200자로 입력해 주세요.")
    expected = data.get("expected")
    if not isinstance(expected, str) or expected not in NEXT_STATE:
        raise Problem("수령 전 주문만 직권취소할 수 있습니다.", 409, "ORDER_CHANGED")
    row = db.execute("SELECT * FROM orders WHERE id=?", (order_id,)).fetchone()
    if row is None:
        raise Problem("주문을 찾을 수 없습니다.", 404)
    if row["cancelled_at"] and row["cancelled_by"] == "admin":
        return order_view(db, row)
    if row["cancelled_at"] or row["status"] != expected:
        raise Problem("주문 상태가 변경되었습니다. 최신 상태를 확인해 주세요.", 409, "ORDER_CHANGED")
    approved = db.execute("SELECT 1 FROM payment WHERE order_id=? AND status='SUCCESS' AND mode='demo'", (order_id,)).fetchone()
    unsafe = db.execute("SELECT 1 FROM payment WHERE order_id=? AND (mode!='demo' OR status='PENDING')", (order_id,)).fetchone()
    if not approved or unsafe:
        raise Problem("PG 결제는 환불 연동 후 취소할 수 있습니다. 현재 직권취소는 모의 결제 주문만 지원합니다.", 409, "REFUND_REQUIRED")
    db.execute("UPDATE orders SET cancelled_at=CURRENT_TIMESTAMP,cancelled_by='admin',cancel_reason=?,restock_on_cancel=? WHERE id=?",
               (reason.strip(), restock, order_id))
    return order_view(db, db.execute("SELECT * FROM orders WHERE id=?", (order_id,)).fetchone())
