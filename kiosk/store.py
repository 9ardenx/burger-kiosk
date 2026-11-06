"""SQLite connections, demo menu and shared input validation."""
import re
import sqlite3
from contextlib import closing, contextmanager
from pathlib import Path


class Problem(Exception):
    def __init__(self, message, status=400, code="INVALID_INPUT"):
        super().__init__(message)
        self.status = status
        self.code = code


def integer(value, low, high, label):
    if type(value) is not int or not low <= value <= high:
        raise Problem(f"{label} 값을 확인해 주세요. 허용 범위는 {low}~{high}입니다.")
    return value


def identifier(value):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_-]{16,80}", value):
        raise Problem("요청 식별자가 올바르지 않습니다.")
    return value


@contextmanager
def connection(path, *, write=False):
    db = sqlite3.connect(path, timeout=8, isolation_level=None)
    db.row_factory = sqlite3.Row
    try:
        db.execute("PRAGMA foreign_keys=ON")
        db.execute("BEGIN IMMEDIATE" if write else "BEGIN")
        yield db
        db.commit()
    finally:
        db.close()  # An unfinished transaction rolls back on close.


def initialize(path):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(path)) as db, db:
        db.execute("PRAGMA journal_mode=WAL")
        db.executescript(Path(__file__).with_name("schema.sql").read_text(encoding="utf-8"))
        db.execute("BEGIN IMMEDIATE")
        # Upgrade an existing store without replacing its menus or order history.
        for table, additions in (
            ("menu", {"category": "TEXT NOT NULL DEFAULT 'burger'", "photo_key": "TEXT", "registration_key": "TEXT"}),
            ("menu_option", {"active": "INTEGER NOT NULL DEFAULT 1"}),
        ):
            columns = {row[1] for row in db.execute(f"PRAGMA table_info({table})")}
            for name, definition in additions.items():
                if name not in columns:
                    db.execute(f"ALTER TABLE {table} ADD COLUMN {name} {definition}")
        db.execute("CREATE UNIQUE INDEX IF NOT EXISTS menu_registration ON menu(registration_key)")
        if not db.execute("SELECT 1 FROM menu LIMIT 1").fetchone():
            db.executemany("INSERT INTO menu(id,name,description,kind,base_price) VALUES(?,?,?,?,?)", [
                (1, "클래식버거", "그릴드 비프 패티, 토마토, 양상추", "classic", 5500),
                (2, "치킨버거", "크리스피 치킨 패티, 양상추, 마요 소스", "chicken", 6000),
            ])
            db.executemany("INSERT INTO menu_option(id,menu_id,name,extra_price) VALUES(?,?,?,?)", [
                (1, 1, "치즈 추가", 500), (2, 1, "패티 추가", 1800),
                (3, 2, "치즈 추가", 500), (4, 2, "매콤 소스 추가", 300),
            ])

        db.executemany("""INSERT OR IGNORE INTO menu(name,description,kind,category,base_price,registration_key)
                          VALUES(?,?,?,?,?,?)""", [
            ("감자튀김", "바삭하게 튀긴 감자에 소금을 살짝 더했어요.", "fries", "side", 2000, "starter-fries-v1"),
            ("콜라", "얼음을 곁들인 시원한 탄산음료", "cola", "drink", 1500, "starter-cola-v1"),
        ])


def menu_list(db, *, all_items=False):
    condition = "" if all_items else "WHERE is_sold_out=0"
    rows = [dict(row) for row in db.execute(f"SELECT id,name,description,kind,category,photo_key,base_price,is_sold_out,version FROM menu {condition} ORDER BY id")]
    for row in rows:
        row["options"] = [dict(option) for option in db.execute(
            "SELECT id,name,extra_price FROM menu_option WHERE menu_id=? AND active=1 ORDER BY id", (row["id"],)
        )]
    return rows


def edit_menu(db, menu_id, data):
    price = integer(data.get("base_price"), 0, 1_000_000, "판매 가격")
    sold = data.get("is_sold_out")
    if type(sold) is not bool:
        raise Problem("판매 상태를 선택해 주세요.")
    version = integer(data.get("version"), 0, 2**31-1, "메뉴 버전")
    result = db.execute(
        "UPDATE menu SET base_price=?,is_sold_out=?,version=version+1 WHERE id=? AND version=?",
        (price, sold, menu_id, version),
    )
    if result.rowcount != 1:
        raise Problem("메뉴가 변경되었습니다. 최신 정보를 확인해 주세요.", 409, "MENU_CHANGED")
