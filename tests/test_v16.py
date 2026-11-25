import os
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4
from kiosk import orders, payments
from kiosk.inventory import inventory_state, save_inventory
from kiosk.sales import sales_report, date_range
from kiosk.store import Problem, connection, initialize, menu_list


class Version16Tests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory(); self.addCleanup(folder.cleanup)
        self.path = Path(folder.name)/'test.sqlite3'; initialize(self.path)
        with patch.dict(os.environ, {'PAYMENT_MODE': 'demo'}): self.gateway = payments.Gateway()

    def stock(self, quantity, mid=1, enabled=True, revision=None):
        with connection(self.path, write=True) as db:
            item = next(i for i in inventory_state(db)['items'] if i['id'] == mid)
            return save_inventory(db, mid, dict(enabled=enabled, quantity=quantity, low_threshold=2,
                revision=item['revision'] if revision is None else revision, reason='검증 수량'))

    def create(self, items=None, dining='DINE_IN'):
        with connection(self.path, write=True) as db:
            return orders.create_order(db, 'customer', dict(key=uuid4().hex, dining_type=dining,
                items=items or [dict(menu_id=1, quantity=1, options=[], expected_unit=5500)]))

    def pay(self, oid, outcome='success'):
        with connection(self.path, write=True) as db:
            return payments.begin(db, self.gateway, oid, 'customer', dict(key=uuid4().hex, demo_result=outcome))

    def test_last_unit_concurrent_payment_and_retry_are_atomic(self):
        self.stock(1); ids=[self.create()['id'] for _ in range(2)]
        def pay(oid):
            try: return self.pay(oid)['status']
            except Problem as e: return e.code
        with ThreadPoolExecutor(2) as pool:
            self.assertEqual(sorted(pool.map(pay, ids)), ['CART_CHANGED','PAID'])
        with connection(self.path) as db:
            self.assertEqual(db.execute('SELECT quantity FROM inventory').fetchone()[0], 0)
            self.assertEqual(db.execute("SELECT count(*) FROM payment WHERE status='SUCCESS'").fetchone()[0], 1)
            paid=db.execute("SELECT id FROM orders WHERE status='PAID'").fetchone()[0]
        self.pay(paid)
        with connection(self.path) as db:
            self.assertEqual(db.execute("SELECT count(*) FROM inventory_movement WHERE kind='SALE'").fetchone()[0], 1)
            self.assertTrue(menu_list(db, all_items=True, public=True)[0]['is_sold_out'])
            self.assertFalse(menu_list(db, all_items=True)[0]['is_sold_out'])

    def test_duplicate_lines_and_multi_menu_shortage_rollback(self):
        self.stock(2); self.stock(2, mid=2)
        line=dict(menu_id=1,quantity=2,options=[],expected_unit=5500)
        with self.assertRaises(Problem): self.create([line,line])
        oid=self.create([line,dict(menu_id=2,quantity=2,options=[],expected_unit=6000)])['id']
        self.stock(1,mid=2)
        with self.assertRaises(Problem): self.pay(oid)
        with connection(self.path) as db:
            self.assertEqual([r[0] for r in db.execute('SELECT quantity FROM inventory ORDER BY menu_id')], [2,1])
            self.assertEqual(db.execute('SELECT count(*) FROM payment').fetchone()[0], 0)
            self.assertEqual(db.execute("SELECT count(*) FROM inventory_movement WHERE kind='SALE'").fetchone()[0], 0)

    def test_failed_unpaid_and_untracked_orders_do_not_deduct(self):
        legacy=self.create()['id']; self.pay(legacy)
        self.stock(3)
        oid=self.create()['id']; self.pay(oid,'failure')
        with connection(self.path,write=True) as db:
            orders.cancel_unpaid(db,oid,'customer')
            orders.cancel_by_admin(db,legacy,dict(expected='PAID',reason='과거 주문',restock=True))
            self.assertEqual(db.execute('SELECT quantity FROM inventory').fetchone()[0], 3)
        self.stock(0,enabled=False); self.pay(self.create()['id'])
        with connection(self.path) as db:self.assertEqual(db.execute('SELECT quantity FROM inventory').fetchone()[0], 0)

    def test_cancellation_restores_once_and_respects_preparation_choice(self):
        self.stock(3); first=self.create()['id']; self.pay(first)
        with connection(self.path,write=True) as db:
            orders.cancel_by_admin(db,first,dict(expected='PAID',reason='취소'))
            orders.cancel_by_admin(db,first,dict(expected='PAID',reason='재요청'))
            self.assertEqual(db.execute('SELECT quantity FROM inventory').fetchone()[0],3)
        for restore in (False,True):
            oid=self.create()['id']; self.pay(oid)
            with connection(self.path,write=True) as db:
                orders.advance(db,oid,'PAID')
                orders.cancel_by_admin(db,oid,dict(expected='PREPARING',reason='조리 후',restock=restore))
        with connection(self.path) as db:self.assertEqual(db.execute('SELECT quantity FROM inventory').fetchone()[0],2)

    def test_edit_conflict_and_manual_sold_out_and_restart_preservation(self):
        self.stock(2); self.pay(self.create()['id'])
        with self.assertRaises(Problem): self.stock(99,revision=1)
        with connection(self.path,write=True) as db:db.execute('UPDATE menu SET is_sold_out=1 WHERE id=1')
        self.stock(4); initialize(self.path)
        with connection(self.path) as db:
            self.assertEqual(db.execute('SELECT quantity FROM inventory').fetchone()[0],4)
            self.assertTrue(menu_list(db,all_items=True,public=True)[0]['is_sold_out'])
            self.assertEqual(len(inventory_state(db)['history']),3)

    def test_pg_reservation_gap_is_blocked_before_gateway(self):
        self.stock(2); oid=self.create()['id']; self.gateway.mode='toss'
        with self.assertRaisesRegex(Problem,'모의 결제'):self.pay(oid)
        self.stock(2,enabled=False); self.pay(oid)
        with self.assertRaisesRegex(Problem,'진행 중인 PG'):self.stock(2)
        with connection(self.path) as db:
            self.assertEqual(db.execute('SELECT enabled FROM inventory').fetchone()[0],0)

    def test_sales_korean_midnight_snapshot_and_cross_period_cancellation(self):
        line=dict(menu_id=1,quantity=2,options=[1],expected_unit=6000)
        oid=self.create([line])['id']; self.pay(oid)
        failed=self.create()['id']; self.pay(failed,'failure'); self.create()
        with connection(self.path,write=True) as db:
            db.execute("UPDATE payment SET paid_at='2026-11-25 15:00:00' WHERE order_id=?",(oid,))
            db.execute('UPDATE menu SET base_price=9900 WHERE id=1')
            orders.cancel_by_admin(db,oid,dict(expected='PAID',reason='반품'))
            db.execute("UPDATE orders SET cancelled_at='2026-11-26 15:00:00' WHERE id=?",(oid,))
            day=sales_report(db,'2026-11-26','2026-11-26')
            self.assertEqual((day['summary']['approved'],day['summary']['cancelled'],day['summary']['orders']), (12000,0,1))
            self.assertEqual(day['menus'][0]['net'],12000);self.assertEqual(day['dining'][0]['net'],12000)
            next_day=sales_report(db,'2026-11-27','2026-11-27')
            self.assertEqual((next_day['summary']['net'],next_day['summary']['returned_quantity']),(-12000,2))
            both=sales_report(db,'2026-11-26','2026-11-27')
            self.assertEqual(both['summary']['net'],0)
            self.assertEqual(sum(m['net'] for m in both['menus']),0)

    def test_date_and_stock_validation_and_empty_report(self):
        for period in [('2026-02-30','2026-03-01'),('2026-11-27','2026-11-26'),('2025-01-01','2026-01-02'),(None,None)]:
            with self.assertRaises(Problem):date_range(*period)
        for quantity in [-1,1.2,True,1000001]:
            with self.assertRaises(Problem):self.stock(quantity)
        with connection(self.path) as db:
            empty=sales_report(db,'2026-11-26','2026-11-26')
            self.assertEqual(empty['summary']['net'],0);self.assertEqual(empty['menus'],[])
            self.assertEqual(len(empty['daily']),1)
