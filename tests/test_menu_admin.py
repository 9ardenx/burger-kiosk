import tempfile
import unittest
from pathlib import Path
from uuid import uuid4

from kiosk.menu_admin import save_listing
from kiosk.orders import create_order, order_view, owner_order
from kiosk.store import Problem, connection, initialize, menu_list


class CatalogTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.path = Path(directory.name) / "menu.sqlite3"
        initialize(self.path)
        self.entry = {"key": uuid4().hex, "name": "웨지감자", "description": "테스트 메뉴", "category": "side",
                      "base_price": 2500, "is_sold_out": False, "options": [{"name": "치즈 소스", "extra_price": 500}]}

    def test_retry_keeps_one_item_and_option(self):
        with connection(self.path, write=True) as db:
            mid = save_listing(db, self.entry)
            self.assertEqual(save_listing(db, self.entry), mid)
            rows = [item for item in menu_list(db) if item["id"] == mid]
            self.assertEqual(len(rows), 1)
            self.assertEqual(len(rows[0]["options"]), 1)
        initialize(self.path)
        with connection(self.path) as db:
            self.assertEqual([i["name"] for i in menu_list(db)].count("탄산음료"), 1)

    def test_removed_option_preserves_snapshot_and_blocks_stale_cart(self):
        with connection(self.path, write=True) as db:
            mid = save_listing(db,self.entry)
            option = next(i for i in menu_list(db) if i["id"] == mid)["options"][0]
            cart = {"key": uuid4().hex, "items": [{"menu_id": mid, "quantity": 1, "options": [option["id"]], "expected_unit": 3000}]}
            order = create_order(db,"a",cart)
            edit = {**self.entry,"version":0,"name":"감자 사이드","options":[]}
            save_listing(db,edit,mid)
            original = order_view(db,owner_order(db,order["id"],"a"))
            self.assertEqual(original["items"][0]["name"], "웨지감자")
            self.assertEqual(original["items"][0]["options"][0]["option_price"], 500)
            with self.assertRaises(Problem):
                create_order(db,"a",{**cart, "key":uuid4().hex})
            with self.assertRaises(Problem):
                save_listing(db,edit,mid)

    def test_invalid_image_rolls_back_creation(self):
        with self.assertRaises(Problem):
            with connection(self.path, write=True) as db:
                save_listing(db,{**self.entry,"photo":"not a jpg"})
        with connection(self.path) as db:
            self.assertFalse(any(item["name"]=="웨지감자" for item in menu_list(db)))
