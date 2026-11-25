"""Versioned advertising catalog, separate from menu photos and order history."""
import base64
import binascii
import hashlib
import json
from .store import Problem, identifier, integer
from .menu_admin import text_value

def ad_state(db, public=False):
    row = db.execute('SELECT items,revision FROM ad_catalog WHERE id=1').fetchone()
    items = json.loads(row['items']) if row else []
    return {'items': [a for a in items if a['enabled']] if public else items, 'revision': row['revision'] if row else 0}

def save_ads(db, data):
    revision = integer(data.get('revision'), 0, 2**31-1, '광고 버전')
    items = data.get('items')
    if not isinstance(items, list) or len(items) > 10:
        raise Problem('광고는 최대 10개까지 등록할 수 있습니다.')
    current = ad_state(db)
    if revision != current['revision']:
        raise Problem('광고가 변경되었습니다. 최신 목록에서 다시 수정해 주세요.', 409, 'ADS_CHANGED')
    previous = {a['id']: a for a in current['items']}
    cleaned = []
    for item in items:
        if not isinstance(item, dict): raise Problem('광고 정보를 확인해 주세요.')
        aid = identifier(item.get('id'))
        title = text_value(item.get('title'), 40, '광고 제목')
        description = text_value(item.get('description', ''), 120, '광고 설명', required=False)
        if type(item.get('enabled')) is not bool: raise Problem('광고 노출 상태를 확인해 주세요.')
        key = previous.get(aid, {}).get('photo_key')
        if 'photo' in item:
            encoded = item['photo']
            if not isinstance(encoded, str) or len(encoded) > 256000: raise Problem('광고 사진을 다시 선택해 주세요.')
            try: raw = base64.b64decode(encoded, validate=True)
            except (ValueError, binascii.Error): raise Problem('광고 사진 형식이 올바르지 않습니다.')
            if not (raw.startswith(b'\xff\xd8\xff') and raw.endswith(b'\xff\xd9') and len(raw) <= 192000):
                raise Problem('광고 사진 형식이 올바르지 않습니다.')
            key = hashlib.sha256(raw).hexdigest()
            db.execute('INSERT OR IGNORE INTO ad_photo(key,content) VALUES(?,?)', (key, raw))
        if not key: raise Problem('광고 사진을 선택해 주세요.')
        cleaned.append(dict(id=aid, title=title, description=description, photo_key=key, enabled=item['enabled']))
    if len({a['id'] for a in cleaned}) != len(cleaned): raise Problem('광고가 중복되었습니다.')
    db.execute('INSERT OR IGNORE INTO ad_catalog(id) VALUES(1)')
    db.execute('UPDATE ad_catalog SET items=?,revision=revision+1 WHERE id=1', (json.dumps(cleaned, ensure_ascii=False),))
    return {'items': cleaned, 'revision': revision+1}
