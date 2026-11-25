"""v1.2 regressions: display ordering, isolated kitchen actions and unpaid cancellation."""
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from kiosk import orders, payments
from kiosk.menu_admin import save_listing
from kiosk.store import Problem, connection, initialize, menu_list, menu_order_state, reorder_menu


class Version12Tests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.path = Path(folder.name) / "store.sqlite3"
        initialize(self.path)
        with patch.dict("os.environ", {"PAYMENT_MODE": "demo"}):
            self.gateway = payments.Gateway()

    def create(self):
        with connection(self.path, write=True) as db:
            return orders.create_order(db, "customer", {"key": uuid4().hex, "items": [
                {"menu_id": 1, "quantity": 1, "options": [], "expected_unit": 5500, "expected_version": 0}
            ]})

    def pay(self, oid, outcome="success"):
        with connection(self.path, write=True) as db:
            return payments.begin(db, self.gateway, oid, "customer", {"key": uuid4().hex, "demo_result": outcome})

    def cancel(self, oid):
        with connection(self.path, write=True) as db:
            return orders.cancel_unpaid(db, oid, "customer")

    def test_order_persists_and_does_not_change_prices_or_versions(self):
        with connection(self.path, write=True) as db:
            before = menu_list(db, all_items=True)
            ids = [m["id"] for m in reversed(before)]
            reorder_menu(db, {"ids": ids, "revision": 0})
        initialize(self.path)
        with connection(self.path) as db:
            after = menu_list(db, all_items=True)
            self.assertEqual([m["id"] for m in after], ids)
            self.assertEqual(after, list(reversed(before)))
        self.assertEqual(self.create()["total"], 5500)

    def test_stale_or_incomplete_reorder_is_rejected_atomically(self):
        with connection(self.path, write=True) as db:
            ids = [m["id"] for m in menu_list(db, all_items=True)]
            reorder_menu(db, {"ids": ids[::-1], "revision": 0})
        for data in ({"ids": ids, "revision": 0}, {"ids": ids[:-1], "revision": 1}, {"ids": [ids[0]]*len(ids), "revision": 1}):
            with self.assertRaises(Problem), connection(self.path, write=True) as db:
                reorder_menu(db, data)
        with connection(self.path) as db:
            self.assertEqual(menu_order_state(db), {"ids": ids[::-1], "revision": 1})

    def test_new_menu_appends_and_sold_out_item_keeps_position(self):
        with connection(self.path, write=True) as db:
            ids = [m["id"] for m in menu_list(db, all_items=True)][::-1]
            reorder_menu(db, {"ids": ids, "revision": 0})
            mid = save_listing(db, {"key": uuid4().hex, "name": "새 메뉴", "description": "", "category": "burger",
                                   "base_price": 7000, "is_sold_out": False, "options": []})
            db.execute("UPDATE menu SET is_sold_out=1 WHERE id=?", (ids[1],))
            self.assertEqual([m["id"] for m in menu_list(db)], [i for i in ids if i != ids[1]] + [mid])
            db.execute("UPDATE menu SET is_sold_out=0 WHERE id=?", (ids[1],))
            self.assertEqual([m["id"] for m in menu_list(db)], ids + [mid])

    def test_cancel_after_decline_is_idempotent_and_blocks_retry(self):
        oid = self.create()["id"]
        self.pay(oid, "failure")
        self.assertEqual(self.cancel(oid)["status"], "CANCELLED")
        self.assertEqual(self.cancel(oid)["status"], "CANCELLED")
        with self.assertRaises(Problem):
            self.pay(oid)
        with connection(self.path) as db:
            self.assertEqual(db.execute("SELECT count(*) FROM orders WHERE number IS NOT NULL").fetchone()[0], 0)

    def test_cancel_does_not_accept_other_customer_or_paid_order(self):
        oid = self.create()["id"]
        with self.assertRaises(Problem), connection(self.path, write=True) as db:
            orders.cancel_unpaid(db, oid, "other-customer")
        self.pay(oid)
        with self.assertRaises(Problem):
            self.cancel(oid)

    def test_uncertain_payment_cannot_be_cleared(self):
        oid = self.create()["id"]
        self.gateway.mode = "toss"
        self.pay(oid)
        with self.assertRaises(Problem):
            self.cancel(oid)
        with connection(self.path) as db:
            self.assertIsNone(orders.owner_order(db, oid, "customer")["cancelled_at"])

    def test_payment_racing_cancel_has_only_one_outcome(self):
        oid = self.create()["id"]
        def attempt(action):
            try:
                return action(oid)["status"]
            except Problem:
                return "rejected"
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(attempt, (self.pay, self.cancel)))
        self.assertEqual(results.count("rejected"), 1)
        with connection(self.path) as db:
            result = orders.order_view(db, orders.owner_order(db, oid, "customer"))
            if result["status"] == "CANCELLED":
                self.assertIsNone(result["number"])
                self.assertEqual(db.execute("SELECT count(*) FROM payment WHERE status='SUCCESS'").fetchone()[0], 0)
            else:
                self.assertEqual(result["status"], "PAID")

    def test_kitchen_updates_are_isolated_and_duplicate_click_is_rejected(self):
        a, b = self.create()["id"], self.create()["id"]
        self.pay(a)
        self.pay(b)
        def start():
            try:
                with connection(self.path, write=True) as db:
                    orders.advance(db, a, "PAID")
                return "ok"
            except Problem:
                return "conflict"
        with ThreadPoolExecutor(max_workers=2) as pool:
            self.assertCountEqual(list(pool.map(lambda _: start(), range(2))), ["ok", "conflict"])
        with connection(self.path) as db:
            self.assertEqual(orders.owner_order(db, a, "customer")["status"], "PREPARING")
            self.assertEqual(orders.owner_order(db, b, "customer")["status"], "PAID")
