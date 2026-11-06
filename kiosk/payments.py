"""Payment attempts and the Toss test-payment adapter."""
import base64
import json
import os
from http.client import HTTPException
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from uuid import uuid4

from .orders import order_view, owner_order
from .store import Problem, connection, identifier


class Gateway:
    def __init__(self):
        self.mode = os.environ.get("PAYMENT_MODE", "demo")
        self.client_key = os.environ.get("TOSS_CLIENT_KEY", "") if self.mode == "toss" else ""
        self.secret = os.environ.get("TOSS_SECRET_KEY", "")
        if self.mode not in ("demo", "toss"):
            raise ValueError("PAYMENT_MODE는 demo 또는 toss를 사용하세요.")
        if self.mode == "toss" and not (self.client_key.startswith("test_ck_") and self.secret.startswith("test_sk_")):
            raise ValueError("토스페이먼츠 API 개별 연동 테스트 키(test_ck_, test_sk_)가 필요합니다.")

    def api(self, route, payload=None, attempt=None):
        auth = base64.b64encode((self.secret + ":").encode()).decode()
        headers = {"Authorization": "Basic " + auth, "Content-Type": "application/json"}
        if attempt:
            headers["Idempotency-Key"] = attempt
        req = Request("https://api.tosspayments.com/v1/payments/" + route,
                      data=json.dumps(payload).encode() if payload else None, headers=headers)
        try:
            with urlopen(req, timeout=8) as response:
                return response.status, json.load(response)
        except HTTPError as error:
            try:
                return error.code, json.load(error)
            except ValueError:
                return error.code, {}
        except (URLError, TimeoutError, HTTPException, OSError, ValueError):
            return 503, {}

    def resolve(self, attempt, key, amount):
        code, result = self.api("confirm", {"paymentKey": key, "orderId": attempt, "amount": amount}, attempt)
        if code != 200:
            # A previous approval can survive a lost response or a failed local commit.
            lookup, record = self.api("orders/" + attempt)
            if lookup == 200:
                result = record
            elif result.get("code") in {"REJECT_CARD_COMPANY", "REJECT_ACCOUNT_PAYMENT", "EXCEED_MAX_CARD_INSTALLMENT_PLAN",
                                        "INVALID_CARD_EXPIRATION", "INVALID_STOPPED_CARD", "EXCEED_MAX_PAYMENT_AMOUNT"}:
                return "FAILED", None
            else:
                return "PENDING", None
        if result.get("orderId") != attempt or result.get("paymentKey") != key or result.get("totalAmount") != amount:
            return "PENDING", None
        if result.get("status") == "DONE":
            return "SUCCESS", result.get("method", "CARD")
        return ("FAILED", None) if result.get("status") in {"ABORTED", "EXPIRED"} else ("PENDING", None)


def finish(db, attempt, outcome, method=None):
    if outcome == "PENDING" or attempt["status"] != "PENDING":
        return
    db.execute("""UPDATE payment SET status=?,method=?,
                  paid_at=CASE WHEN ?='SUCCESS' THEN CURRENT_TIMESTAMP END WHERE id=?""",
               (outcome, method, outcome, attempt["id"]))
    if outcome == "SUCCESS":
        db.execute("""UPDATE orders SET status='PAID',number=(SELECT COALESCE(MAX(number),0)+1 FROM orders)
                      WHERE id=? AND status='PENDING_PAYMENT'""", (attempt["order_id"],))


def begin(db, gateway, order_id, customer, data):
    row = owner_order(db, order_id, customer)
    key = identifier(data.get("key"))
    exists = db.execute("SELECT 1 FROM payment WHERE order_id=? AND (request_key=? OR status='PENDING')",
                        (order_id, key)).fetchone()
    if row["status"] != "PENDING_PAYMENT" or exists:
        return order_view(db, row)
    sold = db.execute("""SELECT menu.name FROM order_item JOIN menu ON menu.id=order_item.menu_id
                         WHERE order_item.order_id=? AND menu.is_sold_out=1 LIMIT 1""", (order_id,)).fetchone()
    if sold:
        raise Problem(f"{sold['name']} 품절 · 장바구니를 수정해 주세요.", 409, "CART_CHANGED")
    attempt_id = uuid4().hex
    db.execute("INSERT INTO payment(id,order_id,request_key,mode,amount,status) VALUES(?,?,?,?,?,'PENDING')",
               (attempt_id, order_id, key, gateway.mode, row["total_amount"]))
    if gateway.mode == "demo":
        outcome = data.get("demo_result", "success")
        if outcome not in ("success", "failure"):
            raise Problem("모의 결제 결과가 올바르지 않습니다.")
        db.execute("UPDATE payment SET pg_tid=? WHERE id=?", ("demo_" + attempt_id, attempt_id))
        attempt = db.execute("SELECT * FROM payment WHERE id=?", (attempt_id,)).fetchone()
        finish(db, attempt, "SUCCESS" if outcome == "success" else "FAILED", "모의 카드")
    return order_view(db, owner_order(db, order_id, customer))


def attempt_for_customer(db, attempt_id, customer):
    row = db.execute("""SELECT p.* FROM payment p JOIN orders o ON o.id=p.order_id
                        WHERE p.id=? AND o.customer=?""", (attempt_id, customer)).fetchone()
    if not row:
        raise Problem("결제 시도를 찾을 수 없습니다.", 404)
    return row


def settle(path, gateway, attempt_id, customer, data):
    with connection(path, write=True) as db:
        attempt = attempt_for_customer(db, attempt_id, customer)
        if attempt["status"] != "PENDING":
            return order_view(db, owner_order(db, attempt["order_id"], customer))
        if attempt["mode"] != "toss" or gateway.mode != "toss":
            raise Problem("이 결제에 해당하는 테스트 PG 설정을 확인해 주세요.", 409)
        if data.get("cancel") is True and not attempt["pg_tid"]:
            finish(db, attempt, "FAILED")
            return order_view(db, owner_order(db, attempt["order_id"], customer))
        key = attempt["pg_tid"] or data.get("paymentKey")
        if not isinstance(key, str) or not 1 <= len(key) <= 200:
            raise Problem("결제창에서 테스트 인증을 완료해 주세요.")
        if not attempt["pg_tid"]:
            if data.get("amount") != attempt["amount"] or data.get("orderId") != attempt_id:
                raise Problem("결제 인증 정보와 주문 금액이 일치하지 않습니다.", 409)
            if db.execute("SELECT 1 FROM payment WHERE pg_tid=? AND id<>?", (key, attempt_id)).fetchone():
                raise Problem("다른 주문에 사용한 결제 키입니다.", 409)
            db.execute("UPDATE payment SET pg_tid=? WHERE id=?", (key, attempt_id))
    # Do not hold the SQLite write lock during the network call.
    status, method = gateway.resolve(attempt_id, key, attempt["amount"])
    with connection(path, write=True) as db:
        attempt = attempt_for_customer(db, attempt_id, customer)
        finish(db, attempt, status, method)
        return order_view(db, owner_order(db, attempt["order_id"], customer))
