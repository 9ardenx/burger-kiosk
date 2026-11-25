import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from uuid import uuid4
from kiosk import admin_auth
from kiosk.categories import category_state, save_categories
from kiosk.menu_admin import save_listing
from kiosk.store import Problem, connection, initialize, menu_list

class Version14Tests(unittest.TestCase):
    def setUp(self):
        folder=tempfile.TemporaryDirectory();self.addCleanup(folder.cleanup)
        self.path=Path(folder.name)/'test.sqlite3';initialize(self.path)
        self.bootstrap='initial-password-test';self.new='new long password 2026'
    def change(self,old=None,new=None):
        value=new or self.new
        return admin_auth.change_password(self.path,self.bootstrap,{'current_password':old or self.bootstrap,'new_password':value,'confirm_password':value})
    def test_category_rename_and_order_preserve_every_menu_field(self):
        with connection(self.path,write=True) as db:
            before=menu_list(db,all_items=True);state=category_state(db)
            changed=[dict(c) for c in state['items'][::-1]];changed[0]['name']='시원한 음료'
            save_categories(db,{'items':changed,'revision':0})
            self.assertEqual(menu_list(db,all_items=True),before)
        initialize(self.path)
        with connection(self.path) as db:self.assertEqual(category_state(db)['items'],changed)
    def test_category_add_assign_delete_and_stale_conflict(self):
        with connection(self.path,write=True) as db:
            defaults=category_state(db)['items'];items=defaults+[{'id':'dessert','name':'디저트'}]
            save_categories(db,{'items':items,'revision':0})
            mid=save_listing(db,{'key':uuid4().hex,'name':'아이스크림','description':'','category':'dessert','base_price':2000,'is_sold_out':False,'options':[]})
        with self.assertRaises(Problem),connection(self.path,write=True) as db:save_categories(db,{'items':defaults,'revision':1})
        with self.assertRaises(Problem),connection(self.path,write=True) as db:save_categories(db,{'items':items,'revision':0})
        with connection(self.path,write=True) as db:
            item=next(m for m in menu_list(db,all_items=True) if m['id']==mid)
            save_listing(db,{**item,'category':'side','is_sold_out':False},mid)
            save_categories(db,{'items':defaults,'revision':1})
            self.assertEqual(len(category_state(db)['items']),3)
    def test_password_persists_bootstrap_stops_working_and_salt_changes(self):
        self.assertEqual(admin_auth.login(self.path,self.bootstrap,self.bootstrap),0)
        self.change();initialize(self.path)
        with self.assertRaises(Problem):admin_auth.login(self.path,self.bootstrap,self.bootstrap)
        self.assertEqual(admin_auth.login(self.path,self.bootstrap,self.new),1)
        with connection(self.path) as db:
            state=admin_auth.auth_state(db);self.assertNotEqual(state['password_hash'],self.new);self.assertTrue(state['salt'])
        self.change(old=self.new,new='another long passphrase')
        with connection(self.path) as db:self.assertNotEqual(admin_auth.auth_state(db)['salt'],state['salt'])
    def test_wrong_password_and_mismatch_do_not_change_auth(self):
        with self.assertRaises(Problem):self.change(old='wrong')
        with self.assertRaises(Problem):admin_auth.change_password(self.path,self.bootstrap,{'current_password':self.bootstrap,'new_password':self.new,'confirm_password':'different'})
        self.assertEqual(admin_auth.login(self.path,self.bootstrap,self.bootstrap),0)
    def test_recovery_rotation_single_use_and_password_change_invalidation(self):
        first=admin_auth.issue_recovery(self.path,self.bootstrap,{'current_password':self.bootstrap})['code']
        second=admin_auth.issue_recovery(self.path,self.bootstrap,{'current_password':self.bootstrap})['code']
        def reset(code):return admin_auth.reset_password(self.path,{'recovery_code':code,'new_password':self.new,'confirm_password':self.new})
        with self.assertRaises(Problem):reset(first)
        reset(second)
        with self.assertRaises(Problem):reset(second)
        self.assertEqual(admin_auth.login(self.path,self.bootstrap,self.new),1)
        admin_auth.issue_recovery(self.path,self.bootstrap,{'current_password':self.new})
        self.change(old=self.new,new='a different passphrase')
        with connection(self.path) as db:self.assertFalse(admin_auth.security_info(db)['recovery_ready'])
    def test_rate_limit_survives_failed_transaction(self):
        for _ in range(10):
            with self.assertRaises(Problem) as caught:admin_auth.login(self.path,self.bootstrap,'wrong')
            self.assertEqual(caught.exception.status,401)
        with self.assertRaises(Problem) as caught:admin_auth.login(self.path,self.bootstrap,self.bootstrap)
        self.assertEqual(caught.exception.status,429)
        with connection(self.path,write=True) as db:db.execute('UPDATE auth_attempt SET expires=0')
        self.assertEqual(admin_auth.login(self.path,self.bootstrap,self.bootstrap),0)
    def test_recovery_concurrent_use_has_one_winner(self):
        code=admin_auth.issue_recovery(self.path,self.bootstrap,{'current_password':self.bootstrap})['code']
        def run(_):
            try:admin_auth.reset_password(self.path,{'recovery_code':code,'new_password':self.new,'confirm_password':self.new});return 'ok'
            except Problem:return 'rejected'
        with ThreadPoolExecutor(max_workers=2) as pool:self.assertCountEqual(list(pool.map(run,[1,2])),['ok','rejected'])
