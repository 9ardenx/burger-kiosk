"""Admin cancellation never pretends to refund a PG transaction."""
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4
from kiosk import orders, payments
from kiosk.store import Problem, connection, initialize


class AdminCancellationTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.path = Path(directory.name) / 'test.sqlite3'
        initialize(self.path)
        with patch.dict('os.environ', {'PAYMENT_MODE': 'demo'}):
            self.gateway = payments.Gateway()

    def paid(self):
        with connection(self.path, write=True) as db:
            o = orders.create_order(db, 'owner', {'key': uuid4().hex, 'items': [
                {'menu_id': 1, 'quantity': 1, 'options': [], 'expected_unit': 5500}]})
            return payments.begin(db, self.gateway, o['id'], 'owner', {'key': uuid4().hex, 'demo_result': 'success'})

    def cancel(self, oid, expected='PAID', reason='재료 소진'):
        with connection(self.path, write=True) as db:
            return orders.cancel_by_admin(db, oid, {'expected': expected, 'reason': reason})

    def test_audit_idempotency_and_other_order_untouched(self):
        a, b = self.paid(), self.paid()
        result = self.cancel(a['id'])
        self.assertEqual(result['status'], 'CANCELLED')
        self.assertEqual(result['cancelled_by'], 'admin')
        self.assertEqual(result['cancel_reason'], '재료 소진')
        self.assertEqual(self.cancel(a['id'], reason='중복 요청'), result)
        initialize(self.path)
        with connection(self.path) as db:
            self.assertEqual(orders.order_view(db, orders.owner_order(db, a['id'], 'owner')), result)
            self.assertEqual(orders.owner_order(db, b['id'], 'owner')['status'], 'PAID')
            self.assertEqual(db.execute("SELECT count(*) FROM payment WHERE order_id=? AND status='SUCCESS'", (a['id'],)).fetchone()[0], 1)
        with self.assertRaises(Problem), connection(self.path, write=True) as db:
            orders.advance(db, a['id'], 'PAID')

    def test_preparing_and_ready_are_cancellable(self):
        for status in ('PREPARING', 'READY'):
            o = self.paid()
            with connection(self.path, write=True) as db:
                db.execute('UPDATE orders SET status=? WHERE id=?', (status, o['id']))
            self.assertEqual(self.cancel(o['id'], expected=status)['status'], 'CANCELLED')

    def test_completed_pg_and_invalid_reason_rejected(self):
        for case in ('completed', 'pg', 'reason', 'stale'):
            o = self.paid()
            with connection(self.path, write=True) as db:
                if case == 'completed': db.execute("UPDATE orders SET status='COMPLETED' WHERE id=?", (o['id'],))
                if case == 'pg': db.execute("UPDATE payment SET mode='toss' WHERE order_id=?", (o['id'],))
                if case == 'stale': orders.advance(db, o['id'], 'PAID')
            with self.assertRaises(Problem): self.cancel(o['id'], reason=' ' if case == 'reason' else '취소')
            with connection(self.path) as db: self.assertIsNone(orders.owner_order(db, o['id'], 'owner')['cancelled_at'])

    def test_cancel_and_cooking_race(self):
        o = self.paid()
        def action(cancel):
            try:
                with connection(self.path, write=True) as db:
                    if cancel: orders.cancel_by_admin(db, o['id'], {'expected': 'PAID', 'reason': '품절'})
                    else: orders.advance(db, o['id'], 'PAID')
                return 'ok'
            except Problem: return 'conflict'
        with ThreadPoolExecutor(max_workers=2) as pool:
            self.assertCountEqual(list(pool.map(action, [True, False])), ['ok', 'conflict'])
