import json
import unittest
from . import test_v15 as base
from kiosk.advertising import ad_state,save_ads
from kiosk.store import connection,Problem

class AdPlacementTests(unittest.TestCase):
    setUp=base.Version15Tests.setUp
    ad=base.Version15Tests.ad
    def test_legacy_intro_read_is_additive_and_old_client_edit_preserves_placement(self):
        with connection(self.path,write=True) as db:
            saved=save_ads(db,dict(items=[dict(self.ad(),id='v17-new-products-banner')],revision=0))
            legacy=dict(saved['items'][0]);legacy.pop('placement')
            encoded=json.dumps([legacy]);db.execute('UPDATE ad_catalog SET items=? WHERE id=1',(encoded,))
            state=ad_state(db);self.assertEqual(state['items'][0]['placement'],'INTRO')
            self.assertEqual(db.execute('SELECT items FROM ad_catalog').fetchone()[0],encoded)
            result=save_ads(db,dict(items=[dict(legacy,title='수정')],revision=1));self.assertEqual(result['items'][0]['placement'],'INTRO')
    def test_priority_persists_and_invalid_or_duplicate_intro_does_not_change_catalog(self):
        with connection(self.path,write=True) as db:
            first=self.ad(placement='INTRO');second=self.ad(placement='PRIORITY')
            saved=save_ads(db,dict(items=[first,second],revision=0));self.assertEqual(ad_state(db),saved)
        for items in [[first,dict(second,placement='INTRO')],[dict(first,placement='other')],[dict(first,placement=True)]]:
            with self.assertRaises(Problem),connection(self.path,write=True) as db:save_ads(db,dict(items=items,revision=1))
        with connection(self.path) as db:self.assertEqual(ad_state(db),saved)
