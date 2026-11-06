import os
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from kiosk import orders, payments
from kiosk.store import Problem, connection, edit_menu, initialize


class CheckoutTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.path = Path(folder.name) / "test.sqlite3"
        initialize(self.path)
        with patch.dict(os.environ, {"PAYMENT_MODE": "demo"}):
            self.gateway = payments.Gateway()
        self.cart = {"key": uuid4().hex, "items": [
            {"menu_id": 1, "quantity": 2, "options": [1], "expected_unit": 6000}
        ]}

    def create(self):
        with connection(self.path, write=True) as db:
            return orders.create_order(db, "customer", self.cart)

    def attempt(self, oid, outcome="success", key=None):
        with connection(self.path, write=True) as db:
            return payments.begin(db, self.gateway, oid, "customer", {
                "key": key or uuid4().hex, "demo_result": outcome
            })

    def edit(self, price=5500, sold=False):
        with connection(self.path, write=True) as db:
            edit_menu(db, 1, {"version": 0, "base_price": price, "is_sold_out": sold})

    def test_rejection_retry_and_kitchen_sequence(self):
        oid = self.create()["id"]
        failed = self.attempt(oid, "failure")
        self.assertEqual((failed["status"], failed["number"]), ("PENDING_PAYMENT", None))
        self.assertEqual(failed["payment"]["status"], "FAILED")
        paid = self.attempt(oid)
        self.assertEqual((paid["total"], paid["status"], paid["number"]), (12000, "PAID", 1))
        self.assertEqual(self.attempt(oid)["number"], 1)
        with connection(self.path, write=True) as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM payment").fetchone()[0], 2)
            with self.assertRaises(Problem):
                orders.advance(db, oid, "READY")
            for expected in ("PAID", "PREPARING", "READY"):
                orders.advance(db, oid, expected)
            self.assertEqual(orders.owner_order(db, oid, "customer")["status"], "COMPLETED")

    def test_concurrent_checkout_and_payment_have_one_result(self):
        with ThreadPoolExecutor(max_workers=4) as pool:
            ids = list(pool.map(lambda _: self.create()["id"], range(4)))
            self.assertEqual(len(set(ids)), 1)
            results = list(pool.map(lambda _: self.attempt(ids[0])["number"], range(4)))
            self.assertEqual(results, [1]*4)
        with connection(self.path) as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM payment").fetchone()[0], 1)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM order_item").fetchone()[0], 1)

    def test_sold_out_between_attempts(self):
        oid = self.create()["id"]
        self.attempt(oid, "failure")
        self.edit(sold=True)
        with self.assertRaisesRegex(Problem, "품절"):
            self.attempt(oid)
        self.cart["key"] = uuid4().hex
        with self.assertRaisesRegex(Problem, "품절"):
            self.create()

    def test_price_snapshot_and_changed_quote(self):
        oid = self.create()["id"]
        self.edit(price=6000)
        self.cart["key"] = uuid4().hex
        with self.assertRaisesRegex(Problem, "가격이 변경"):
            self.create()
        paid = self.attempt(oid)
        self.assertEqual(paid["items"][0]["price"], 5500)
        self.assertEqual(paid["total"], 12000)
        with connection(self.path, write=True) as db:
            with self.assertRaises(Problem):
                orders.owner_order(db, oid, "other-customer")
            with self.assertRaises(Problem):
                edit_menu(db, 1, {"version": 0, "base_price": 6500, "is_sold_out": False})

    def test_options_belong_to_selected_menu(self):
        self.cart["items"][0]["options"] = [3]
        with self.assertRaises(Problem):
            self.create()
        with connection(self.path) as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM orders").fetchone()[0], 0)

    def test_toss_uncertain_result_keeps_pending_until_verified(self):
        oid = self.create()["id"]
        self.gateway.mode = "toss"
        attempt = self.attempt(oid)["payment"]["id"]
        callback = {"paymentKey": "test-payment-key", "orderId": attempt, "amount": 12000}
        with self.assertRaises(Problem):
            payments.settle(self.path, self.gateway, attempt, "customer", {**callback, "amount": 1})
        with patch.object(self.gateway, "api", return_value=(503, {})):
            waiting = payments.settle(self.path, self.gateway, attempt, "customer", callback)
        self.assertEqual(waiting["payment"]["status"], "PENDING")
        self.assertEqual(self.attempt(oid)["payment"]["id"], attempt)
        record = {"status":"DONE", "totalAmount":12000, "orderId":attempt,
                  "paymentKey":callback["paymentKey"], "method":"카드"}
        with patch.object(self.gateway, "api", side_effect=[(400, {"code":"ALREADY_PROCESSED_PAYMENT"}), (200,record)]):
            paid = payments.settle(self.path, self.gateway, attempt, "customer", {})
        self.assertEqual(paid["number"], 1)
        self.assertEqual(payments.settle(self.path, self.gateway, attempt, "customer", callback)["number"], 1)
        with connection(self.path) as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM payment").fetchone()[0], 1)

    def test_live_keys_rejected(self):
        with patch.dict(os.environ, {"PAYMENT_MODE":"toss","TOSS_CLIENT_KEY":"live_ck_invalid","TOSS_SECRET_KEY":"live_sk_invalid"}):
            with self.assertRaises(ValueError):
                payments.Gateway()

if __name__ == "__main__":
    unittest.main()
