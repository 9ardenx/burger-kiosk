"""Create and edit menu listings without changing past orders."""
import base64
import binascii
import hashlib

from .store import Problem, identifier, integer


def text_value(value, maximum, label, *, required=True):
    if not isinstance(value, str) or len(value.strip()) > maximum or (required and not value.strip()):
        raise Problem(f"{label}을(를) 확인해 주세요.")
    return value.strip()


def read_definition(data):
    name = text_value(data.get("name"), 50, "메뉴명")
    description = text_value(data.get("description", ""), 140, "메뉴 설명", required=False)
    category = data.get("category")
    if category not in ("burger", "side", "drink"):
        raise Problem("메뉴 분류를 선택해 주세요.")
    price = integer(data.get("base_price"), 0, 1_000_000, "판매 가격")
    sold = data.get("is_sold_out")
    if type(sold) is not bool:
        raise Problem("판매 상태를 선택해 주세요.")
    options = data.get("options")
    if not isinstance(options, list) or len(options) > 20:
        raise Problem("옵션은 20개까지 등록할 수 있습니다.")
    cleaned = []
    for option in options:
        if not isinstance(option, dict):
            raise Problem("옵션을 확인해 주세요.")
        title = text_value(option.get("name"), 40, "옵션명")
        extra = integer(option.get("extra_price"), 0, 1_000_000, "추가 금액")
        oid = option.get("id")
        if oid is not None:
            integer(oid, 1, 2**31-1, "옵션 번호")
        cleaned.append((oid, title, extra))
    ids = [oid for oid, _, _ in cleaned if oid is not None]
    if len(set(ids)) != len(ids) or len({title for _, title, _ in cleaned}) != len(cleaned):
        raise Problem("같은 옵션을 두 번 등록할 수 없습니다.")
    return name, description, category, price, sold, cleaned


def photo_key(db, encoded):
    if encoded is None:
        return None
    if not isinstance(encoded, str) or len(encoded) > 256_000:
        raise Problem("메뉴 사진을 다시 선택해 주세요.")
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error):
        raise Problem("메뉴 사진 형식이 올바르지 않습니다.")
    if not (raw.startswith(b"\xff\xd8\xff") and raw.endswith(b"\xff\xd9") and len(raw) <= 192_000):
        raise Problem("메뉴 사진 형식이 올바르지 않습니다.")
    key = hashlib.sha256(raw).hexdigest()
    db.execute("INSERT OR IGNORE INTO menu_photo(key,content) VALUES(?,?)", (key, raw))
    return key


def save_listing(db, data, menu_id=None):
    name, description, category, price, sold, options = read_definition(data)
    if menu_id is None:
        request_key = identifier(data.get("key"))
        existing = db.execute("SELECT id FROM menu WHERE registration_key=?", (request_key,)).fetchone()
        if existing:
            return existing["id"]
        if any(oid is not None for oid, _, _ in options):
            raise Problem("새 메뉴에는 새 옵션을 입력해 주세요.")
        new_photo = photo_key(db, data.get("photo"))
        row = db.execute("""INSERT INTO menu(name,description,category,kind,base_price,is_sold_out,photo_key,registration_key)
                            VALUES(?,?,?,'custom',?,?,?,?)""",
                         (name, description, category, price, sold, new_photo, request_key))
        menu_id = row.lastrowid
    else:
        version = integer(data.get("version"), 0, 2**31-1, "메뉴 버전")
        old = db.execute("SELECT version,photo_key FROM menu WHERE id=?", (menu_id,)).fetchone()
        if not old or old["version"] != version:
            raise Problem("메뉴가 변경되었습니다. 최신 정보를 확인해 주세요.", 409, "MENU_CHANGED")
        new_photo = photo_key(db, data["photo"]) if "photo" in data else old["photo_key"]
        db.execute("""UPDATE menu SET name=?,description=?,category=?,base_price=?,is_sold_out=?,photo_key=?,
                      version=version+1 WHERE id=?""", (name, description, category, price, sold, new_photo, menu_id))
        active = {r[0] for r in db.execute("SELECT id FROM menu_option WHERE menu_id=? AND active=1", (menu_id,))}
        if any(oid is not None and oid not in active for oid, _, _ in options):
            raise Problem("이 메뉴에 속한 옵션만 수정할 수 있습니다.")
        db.execute("UPDATE menu_option SET active=0 WHERE menu_id=? AND active=1", (menu_id,))
    for oid, title, extra in options:
        if oid is None:
            db.execute("INSERT INTO menu_option(menu_id,name,extra_price) VALUES(?,?,?)", (menu_id, title, extra))
        else:
            db.execute("UPDATE menu_option SET name=?,extra_price=?,active=1 WHERE menu_id=? AND id=?",
                       (title, extra, menu_id, oid))
    return menu_id
