"""Order snapshots, checkout revalidation and kitchen state transitions."""
import hashlib
import json
from uuid import uuid4

from .variants import resolve_choices
from .store import Problem, identifier, integer

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
        items.append({"name": item["name"], "quantity": item["quantity"], "price": item["item_price"], "options": json.loads(item["choice_snapshot"]) + options})
    payment = db.execute(
        "SELECT id,status,mode,pg_tid IS NOT NULL AS has_key FROM payment WHERE order_id=? ORDER BY rowid DESC LIMIT 1",
        (row["id"],),
    ).fetchone()
    return {"id": row["id"], "number": row["number"], "status": row["status"], "total": row["total_amount"],
            "created_at": row["created_at"], "items": items, "payment": dict(payment) if payment else None}


def quote_item(db, line):
    if not isinstance(line, dict):
        raise Problem("장바구니 항목을 확인해 주세요.")
    menu_id = integer(line.get("menu_id"), 1, 2**31-1, "메뉴")
    quantity = integer(line.get("quantity"), 1, 99, "수량")
    item = db.execute("SELECT * FROM menu WHERE id=?", (menu_id,)).fetchone()
    if not item or item["is_sold_out"]:
        name = item["name"] if item else "선택한 메뉴"
        raise Problem(f"{name} 품절 · 장바구니를 수정해 주세요.", 409, "CART_CHANGED")
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
    key = identifier(data.get("key"))
    cart = data.get("items")
    if not isinstance(cart, list) or not 1 <= len(cart) <= 50:
        raise Problem("장바구니에 메뉴를 1~50개 항목으로 담아 주세요.")
    signature = hashlib.sha256(json.dumps(cart, sort_keys=True).encode()).hexdigest()
    previous = db.execute("SELECT * FROM orders WHERE customer=? AND request_key=?", (customer, key)).fetchone()
    if previous:
        if previous["cart_signature"] != signature:
            raise Problem("장바구니가 바뀌었습니다. 주문을 다시 확인해 주세요.", 409)
        return order_view(db, previous)
    lines = [quote_item(db, line) for line in cart]
    total = sum(quantity * unit for _, _, _, quantity, unit in lines)
    order_id = uuid4().hex
    db.execute("INSERT INTO orders(id,customer,request_key,cart_signature,total_amount) VALUES(?,?,?,?,?)",
               (order_id, customer, key, signature, total))
    for item, options, snapshot, quantity, _ in lines:
        result = db.execute(
            "INSERT INTO order_item(order_id,menu_id,name,item_price,quantity,choice_snapshot) VALUES(?,?,?,?,?,?)",
            (order_id, item["id"], item["name"], item["base_price"], quantity, json.dumps(snapshot, ensure_ascii=False)),
        )
        db.executemany("INSERT INTO order_item_option(order_item_id,option_id,name,option_price) VALUES(?,?,?,?)",
                       [(result.lastrowid, opt["id"], opt["name"], opt["extra_price"]) for opt in options])
    return order_view(db, owner_order(db, order_id, customer))


def advance(db, order_id, expected):
    if not isinstance(expected, str) or expected not in NEXT_STATE:
        raise Problem("다음 단계로 변경할 수 없는 주문입니다.", 409)
    result = db.execute("UPDATE orders SET status=? WHERE id=? AND status=?",
                        (NEXT_STATE[expected], order_id, expected))
    if result.rowcount != 1:
        raise Problem("주문 상태가 변경되었습니다. 최신 상태를 확인해 주세요.", 409, "ORDER_CHANGED")
