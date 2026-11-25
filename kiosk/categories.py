"""Stable category IDs keep existing menu and order data intact."""
import json
import re
from .store import Problem, integer

DEFAULT_CATEGORIES = [{'id': 'burger', 'name': '버거'}, {'id': 'side', 'name': '사이드'}, {'id': 'drink', 'name': '음료'}]

def category_state(db):
    row = db.execute('SELECT items,revision FROM category_catalog WHERE id=1').fetchone()
    return {'items': json.loads(row['items']) if row else DEFAULT_CATEGORIES, 'revision': row['revision'] if row else 0}

def save_categories(db, data):
    revision = integer(data.get('revision'), 0, 2**31-1, '분류 버전')
    items = data.get('items')
    if not isinstance(items, list) or not 1 <= len(items) <= 20:
        raise Problem('분류는 1~20개까지 등록할 수 있습니다.')
    cleaned = []
    for item in items:
        if not isinstance(item, dict) or not isinstance(item.get('id'), str) or not re.fullmatch(r'[a-z][a-z0-9_-]{0,63}', item['id']) or item['id'] == 'all':
            raise Problem('분류 식별자를 확인해 주세요.')
        name = item.get('name')
        if not isinstance(name, str) or not 1 <= len(name.strip()) <= 20:
            raise Problem('분류 이름을 1~20자로 입력해 주세요.')
        cleaned.append({'id': item['id'], 'name': name.strip()})
    ids = {c['id'] for c in cleaned}
    if len(ids) != len(cleaned) or len({c['name'].lower() for c in cleaned}) != len(cleaned):
        raise Problem('분류 이름이나 식별자가 중복됩니다.')
    used = {row[0] for row in db.execute('SELECT DISTINCT category FROM menu')}
    if category_state(db)['revision'] != revision or not used.issubset(ids):
        raise Problem('분류가 변경되었거나 삭제하려는 분류에 메뉴가 남아 있습니다. 최신 목록에서 메뉴를 먼저 옮겨 주세요.', 409, 'CATEGORIES_CHANGED')
    db.execute('INSERT OR IGNORE INTO category_catalog(id) VALUES(1)')
    db.execute('UPDATE category_catalog SET items=?,revision=revision+1 WHERE id=1', (json.dumps(cleaned, ensure_ascii=False),))
    return {'items': cleaned, 'revision': revision+1}
