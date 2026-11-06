import json
import tempfile
import unittest
from pathlib import Path
from uuid import uuid4

from kiosk.menu_admin import save_listing
from kiosk.orders import create_order, order_view, owner_order
from kiosk.store import Problem, connection, initialize, menu_list


class VariantTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.db_path = Path(temp.name) / "test.sqlite3"
        initialize(self.db_path)
        with connection(self.db_path) as db:
            self.drink = next(m for m in menu_list(db) if m["name"] == "탄산음료")
        self.edit = {**self.drink, "is_sold_out": False}

    def order(self, db, selections, expected=1500):
        return create_order(db, "customer", {"key":uuid4().hex,"items":[{
            "menu_id":self.drink["id"],"options":[],"selections":selections,"quantity":2,"expected_unit":expected
        }]})

    def test_visible_branch_is_required_and_exclusive(self):
        with connection(self.db_path, write=True) as db:
            for bad in ([], ["cola"], ["cola","cider"], ["orange","cola_zero"], ["cola","cola_zero","cola_regular"],
                        ["cola","cola_zero","cola_zero"], ["nonsense"]):
                with self.subTest(bad=bad), self.assertRaises(Problem):
                    self.order(db,bad)
            for valid in (["cola","cola_zero"],["cider","cider_regular"],["orange"]):
                self.assertEqual(self.order(db,valid)["total"],3000)

    def test_extra_price_and_snapshot_survive_edit(self):
        with connection(self.db_path,write=True) as db:
            zero=self.edit["choice_groups"][0]["choices"][0]["children"][0]["choices"][1]
            zero["extra_price"]=200
            save_listing(db,self.edit,self.drink["id"])
            with self.assertRaises(Problem):
                self.order(db,["cola","cola_zero"])
            order=self.order(db,["cola","cola_zero"],1700)
            self.assertEqual(order["total"],3400)
            save_listing(db,{**self.edit,"version":self.edit["version"]+1,"choice_groups":[]},self.drink["id"])
            item=order_view(db,owner_order(db,order["id"],"customer"))["items"][0]
            self.assertEqual(item["options"],[{"name":"음료 종류 · 콜라","option_price":0},{"name":"콜라 종류 · 제로","option_price":200}])

    def test_optional_group_and_legacy_editor(self):
        with connection(self.db_path,write=True) as db:
            self.edit["choice_groups"][0]["required"]=False
            save_listing(db,self.edit,self.drink["id"])
            self.assertEqual(self.order(db,[])["total"],3000)
            legacy={k:v for k,v in self.edit.items() if k!="choice_groups"}
            save_listing(db,{**legacy,"version":self.edit["version"]+1},self.drink["id"])
            saved=db.execute("SELECT choice_groups FROM menu WHERE id=?",(self.drink["id"],)).fetchone()[0]
            self.assertEqual(json.loads(saved),self.edit["choice_groups"])

    def test_combo_drink_only_when_paid_extra_selected(self):
        with connection(self.db_path, write=True) as db:
            burger=next(m for m in menu_list(db) if m["name"]=="클래식버거")
            deal=next(o for o in burger["options"] if o["name"]=="탄산음료 감자튀김")
            def checkout(options, variants, amount):
                return create_order(db,"guest",{"key":uuid4().hex,"items":[{"menu_id":burger["id"],"quantity":1,
                    "options":options,"selections":variants,"expected_unit":amount}]})
            self.assertEqual(checkout([],[],5500)["total"],5500)
            with self.assertRaises(Problem):
                checkout([],["cola","cola_zero"],5500)
            with self.assertRaises(Problem):
                checkout([deal["id"]],[],7500)
            self.assertEqual(checkout([deal["id"]],["cola","cola_zero"],7500)["total"],7500)
