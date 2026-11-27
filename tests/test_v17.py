import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4
from kiosk import orders, payments
from kiosk.store import initialize, connection, menu_list, Problem
from kiosk.promotions import promotion_state, save_promotions
from kiosk.inventory import save_inventory
from kiosk.sales import sales_report


class Version17Tests(unittest.TestCase):
    def setUp(self):
        folder=tempfile.TemporaryDirectory();self.addCleanup(folder.cleanup)
        self.path=Path(folder.name)/'test.sqlite3';initialize(self.path)
        with patch.dict(os.environ,{'PAYMENT_MODE':'demo'}):self.gateway=payments.Gateway()

    def campaign(self,**kw):
        return dict(dict(id=uuid4().hex,title='점심 할인',enabled=True,menu_ids=[1],weekdays=list(range(7)),start_time='00:00',end_time='24:00',start_date=None,end_date=None,mode='PERCENT',value=20),**kw)

    def save(self,items,revision=None):
        with connection(self.path,write=True) as db:return save_promotions(db,dict(items=items,revision=promotion_state(db)['revision'] if revision is None else revision))

    def clock(self,when):
        # Test-only clock: no production endpoint or environment override exists.
        sql=(Path(__file__).resolve().parents[1]/'cloud/promotion-pricing.sql').read_text(encoding='utf8')
        with connection(self.path,write=True) as db:
            db.executescript('DROP VIEW menu_pricing;DROP VIEW active_promotions;'+sql.replace("datetime('now','+9 hours')",f"datetime('{when}')").replace('i.price','i.item_price'))

    def price(self):
        with connection(self.path) as db:return menu_list(db,all_items=True,public=True)[0]

    def create(self,price,options=None):
        with connection(self.path,write=True) as db:return orders.create_order(db,'customer',dict(key=uuid4().hex,items=[dict(menu_id=1,quantity=2,options=options or [],expected_unit=price)]))

    def pay(self,oid):
        with connection(self.path,write=True) as db:return payments.begin(db,self.gateway,oid,'customer',dict(key=uuid4().hex,demo_result='success'))

    def test_window_date_weekday_and_overnight_anchor(self):
        self.save([self.campaign(start_time='22:00',end_time='02:00',weekdays=[5],start_date='2026-11-27',end_date='2026-11-27')])
        for when,price in [('2026-11-27 21:59:59',5500),('2026-11-27 22:00:00',4400),('2026-11-28 01:59:59',4400),('2026-11-28 02:00:00',5500),('2026-12-04 22:00:00',5500)]:
            self.clock(when);self.assertEqual(self.price()['base_price'],price,when)
        self.save([self.campaign(start_time='11:00',end_time='14:00',weekdays=[5])])
        for when,price in [('2026-11-27 10:59:59',5500),('2026-11-27 11:00:00',4400),('2026-11-27 14:00:00',5500),('2026-11-28 12:00:00',5500)]:
            self.clock(when);self.assertEqual(self.price()['base_price'],price,when)

    def test_cheapest_not_stacked_options_full_price_snapshot_preserved(self):
        percent=self.campaign();fixed=self.campaign(mode='FIXED',value=4000)
        self.save([percent,fixed]);self.assertEqual(self.price()['base_price'],4000)
        with connection(self.path) as db:self.assertEqual(menu_list(db,all_items=True)[0]['base_price'],5500)
        order=self.create(4500,[1]);self.assertEqual(order['total'],9000);self.assertEqual(order['items'][0]['regular_price'],5500)
        self.assertEqual(order['items'][0]['promotion']['id'],fixed['id']);paid=self.pay(order['id']);self.assertEqual(paid['total'],9000)
        self.save([])
        with connection(self.path) as db:self.assertEqual(orders.order_view(db,orders.owner_order(db,order['id'],'customer'))['items'],paid['items'])
        self.assertEqual(self.pay(order['id'])['total'],9000)

    def test_expiry_approval_rolls_back_payment_and_stock(self):
        p=self.campaign(start_time='11:00',end_time='14:00');self.save([p]);self.clock('2026-11-27 13:59:59')
        with connection(self.path,write=True) as db:save_inventory(db,1,dict(enabled=True,quantity=3,low_threshold=1,revision=0,reason='검증'))
        oid=self.create(4400)['id'];self.clock('2026-11-27 14:00:00')
        with self.assertRaises(Problem) as e:self.pay(oid)
        self.assertEqual(e.exception.code,'CART_CHANGED')
        with connection(self.path) as db:
            self.assertEqual(db.execute('SELECT count(*) FROM payment').fetchone()[0],0)
            self.assertEqual(db.execute('SELECT quantity FROM inventory').fetchone()[0],3)
        self.assertEqual(self.pay(self.create(5500)['id'])['total'],11000)

    def test_new_discount_after_quote_and_trigger_atomic_guard(self):
        oid=self.create(5500)['id'];self.save([self.campaign()])
        with self.assertRaises(Problem):self.pay(oid)
        # Bypass the service precheck to verify the DB trigger itself rejects a stale approval.
        with self.assertRaises(Problem) as e:
            with connection(self.path,write=True) as db:db.execute("INSERT INTO payment(id,order_id,request_key,mode,amount,status) VALUES(?,?,?,'demo',11000,'SUCCESS')",(uuid4().hex,oid,uuid4().hex))
        self.assertEqual(e.exception.code,'CART_CHANGED')

    def test_validation_revision_and_disabled_price_never_increases(self):
        p=self.campaign();self.save([p])
        with self.assertRaises(Problem):self.save([],0)
        for bad in [dict(value=100),dict(value=True),dict(menu_ids=[]),dict(weekdays=[]),dict(weekdays=[True]),dict(end_time='00:00'),dict(start_date='2026-02-30'),dict(mode='FIXED',value=5500),dict(menu_ids=[999])]:
            with self.assertRaises(Problem):self.save([dict(p,**bad)])
        self.save([dict(p,enabled=False)]);self.assertEqual(self.price()['base_price'],5500)
        self.save([dict(p,mode='FIXED',value=4000)])
        with connection(self.path,write=True) as db:db.execute('UPDATE menu SET base_price=3000 WHERE id=1')
        self.assertEqual(self.price()['base_price'],3000)

    def test_restart_preserves_discounts_menus_orders_and_prices(self):
        self.save([self.campaign()]);order=self.pay(self.create(4400)['id'])
        before=self.price();initialize(self.path)
        with connection(self.path) as db:
            self.assertEqual(self.price(),before)
            self.assertEqual(orders.order_view(db,orders.owner_order(db,order['id'],'customer')),order)
            self.assertEqual(len(promotion_state(db)['items']),1)
