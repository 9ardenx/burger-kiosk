import base64
import tempfile
import unittest
import os
from unittest.mock import patch
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from uuid import uuid4
from kiosk.advertising import ad_state, save_ads
from kiosk import orders, payments
from kiosk.store import Problem, connection, initialize, menu_list

class Version15Tests(unittest.TestCase):
    def setUp(self):
        folder=tempfile.TemporaryDirectory();self.addCleanup(folder.cleanup)
        self.path=Path(folder.name)/'test.sqlite3';initialize(self.path)
        self.photo=base64.b64encode((Path(__file__).resolve().parents[1]/'assets/menu/published/classic-burger.jpg').read_bytes()).decode()
        with patch.dict(os.environ, {'PAYMENT_MODE':'demo'}): self.gateway=payments.Gateway()
    def ad(self, **values):
        return dict(id=uuid4().hex,title='신제품 <소개>',description='오늘의 메뉴',enabled=True,photo=self.photo,**values)
    def cart(self, dining='TAKEOUT'):
        return dict(key=uuid4().hex,dining_type=dining,items=[dict(menu_id=1,quantity=1,options=[],expected_unit=5500)])
    def test_ad_lifecycle_preserves_menu_and_orders(self):
        with connection(self.path,write=True) as db:
            menu=menu_list(db,all_items=True);order=orders.create_order(db,'customer',self.cart());item=self.ad()
            saved=save_ads(db,dict(items=[item],revision=0));self.assertNotIn('photo',saved['items'][0])
            changed=dict(saved['items'][0],title='다른 제목',enabled=False)
            save_ads(db,dict(items=[changed],revision=1));self.assertEqual(ad_state(db,True)['items'],[])
            self.assertEqual(ad_state(db)['items'][0]['photo_key'],saved['items'][0]['photo_key'])
            save_ads(db,dict(items=[],revision=2));self.assertEqual(ad_state(db)['items'],[])
            self.assertEqual(menu_list(db,all_items=True),menu)
            self.assertEqual(orders.order_view(db,orders.owner_order(db,order['id'],'customer')),order)
    def test_invalid_or_stale_ads_leave_catalog_intact(self):
        with connection(self.path,write=True) as db:saved=save_ads(db,dict(items=[self.ad()],revision=0))
        bad=[dict(items=[],revision=0),dict(items=[self.ad()]*2,revision=1),dict(items=[dict(self.ad(),photo='not-image')],revision=1),dict(items=[dict(self.ad(),photo=None)],revision=1)]
        for payload in bad:
            with self.assertRaises(Problem),connection(self.path,write=True) as db:save_ads(db,payload)
        with connection(self.path) as db:self.assertEqual(ad_state(db),saved)
    def test_ad_reorder_persists_and_conflicting_save_has_one_winner(self):
        with connection(self.path,write=True) as db:saved=save_ads(db,dict(items=[self.ad(),self.ad()],revision=0))
        with connection(self.path,write=True) as db:save_ads(db,dict(items=saved['items'][::-1],revision=1))
        initialize(self.path)
        with connection(self.path) as db:self.assertEqual(ad_state(db)['items'],saved['items'][::-1])
        def remove():
            try:
                with connection(self.path,write=True) as db:save_ads(db,dict(items=[],revision=2))
                return 200
            except Problem as e:return e.status
        with ThreadPoolExecutor(2) as pool:self.assertEqual(sorted(pool.map(lambda _:remove(),range(2))),[200,409])
    def test_dining_type_preserved_and_bound_to_idempotency_key(self):
        with connection(self.path,write=True) as db:
            payload=self.cart();order=orders.create_order(db,'customer',payload)
            self.assertEqual(order['dining_type'],'TAKEOUT');self.assertEqual(orders.create_order(db,'customer',payload),order)
            with self.assertRaises(Problem):orders.create_order(db,'customer',dict(payload,dining_type='DINE_IN'))
            paid=payments.begin(db,self.gateway,order['id'],'customer',dict(key=uuid4().hex,demo_result='success'))
            self.assertEqual(paid['dining_type'],'TAKEOUT');orders.advance(db,order['id'],'PAID')
        initialize(self.path)
        with connection(self.path) as db:self.assertEqual(orders.order_view(db,orders.owner_order(db,order['id'],'customer'))['dining_type'],'TAKEOUT')
    def test_legacy_dining_is_unknown_and_bad_values_rejected(self):
        with connection(self.path,write=True) as db:
            legacy=orders.create_order(db,'customer',self.cart(None));self.assertIsNone(legacy['dining_type'])
            for invalid in ['DELIVERY','',False,1,{}]:
                with self.assertRaises(Problem):orders.create_order(db,'customer',self.cart(invalid))
            self.assertEqual(db.execute('SELECT count(*) FROM orders').fetchone()[0],1)
