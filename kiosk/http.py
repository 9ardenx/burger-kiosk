"""Loopback HTTP entry points for the kiosk and store console."""
import json
import mimetypes
import re
import secrets
import sqlite3
import threading
import time
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit, parse_qs

from . import orders, payments
from . import admin_auth
from .categories import category_state, save_categories
from .advertising import ad_state, save_ads
from .inventory import inventory_state, save_inventory
from .sales import sales_report
from .menu_admin import save_listing
from .store import Problem, connection, edit_menu, menu_list, menu_order_state, reorder_menu

PAGES = Path(__file__).resolve().parents[1] / "docs"
ASSETS = PAGES / "assets"


class Handler(BaseHTTPRequestHandler):
    def log_request(self, code="-", size="-"):
        # PG return queries may contain a payment key.
        self.log_message("%s %s %s", self.command, self.path.split("?")[0], code)

    def send_data(self, status, body, content_type):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        for cookie in self.out_cookies:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(body)

    def cookie(self, name, value, *, clear=False):
        extra = "; Max-Age=0" if clear else ""
        self.out_cookies.append(f"{name}={value}; HttpOnly; SameSite=Lax; Path=/{extra}")

    def require_admin(self):
        with self.server.session_lock:
            until, revision = self.server.sessions.get(self.admin_cookie, (0, -1))
        if until <= time.monotonic():
            raise Problem("관리자 로그인이 필요합니다.", 401)
        with connection(self.server.db_path) as db:
            if admin_auth.auth_state(db)['revision'] != revision:
                raise Problem('관리자 로그인이 필요합니다.', 401)

    def request_data(self):
        if self.headers.get_content_type() != "application/json":
            raise Problem("JSON 요청이 필요합니다.", 415)
        try:
            size = int(self.headers.get("Content-Length", 0))
            limit = 285_000 if self.path.startswith("/api/admin/menu") or self.path == '/api/admin/ads' else 32_000
            if not 0 < size <= limit:
                raise Problem("요청 크기를 확인해 주세요.", 413)
            data = json.loads(self.rfile.read(size))
        except (ValueError, UnicodeError):
            raise Problem("요청을 읽을 수 없습니다.")
        if not isinstance(data, dict):
            raise Problem("입력값을 확인해 주세요.")
        return data

    def dispatch(self, route, data):
        server = self.server
        if route == '/api/ads' and data is None:
            with connection(server.db_path) as db: return ad_state(db, public=True)
        if route == "/api/menu" and data is None:
            with connection(server.db_path) as db:
                return {"menu": menu_list(db, all_items=True, public=True), "categories": category_state(db)['items'], "mode": server.gateway.mode, "clientKey": server.gateway.client_key}
        if route == "/api/admin/login" and data is not None:
            revision = admin_auth.login(server.db_path, server.password, data.get('password'))
            token = secrets.token_urlsafe(32)
            with server.session_lock:
                now = time.monotonic()
                server.sessions = {k:v for k,v in server.sessions.items() if v[0]>now}
                server.sessions.pop(self.admin_cookie, None)
                server.sessions[token] = (now + 8 * 3600, revision)
            self.cookie("admin_session", token)
            return {"ok": True}
        if route == '/api/admin/reset-password' and data is not None:
            result = admin_auth.reset_password(server.db_path, data)
            self.cookie('admin_session', '', clear=True)
            return result
        if route.startswith("/api/admin/"):
            self.require_admin()
            if route == '/api/admin/password' and data is not None:
                result = admin_auth.change_password(server.db_path, server.password, data)
                self.cookie('admin_session', '', clear=True)
                return result
            if route == '/api/admin/recovery-code' and data is not None:
                return admin_auth.issue_recovery(server.db_path, server.password, data)
            if route == "/api/admin/logout" and data is not None:
                with server.session_lock:
                    server.sessions.pop(self.admin_cookie, None)
                self.cookie("admin_session", "", clear=True)
                return {"ok": True}
            with connection(server.db_path, write=data is not None) as db:
                if route == '/api/admin/sales' and data is None:
                    query = parse_qs(urlsplit(self.path).query)
                    return sales_report(db, query.get('from', [None])[0], query.get('to', [None])[0])
                if route == '/api/admin/inventory' and data is None:
                    return inventory_state(db)
                match = re.fullmatch(r'/api/admin/inventory/(\d+)', route)
                if match and data is not None:
                    return save_inventory(db, int(match[1]), data)
                if route == '/api/admin/ads':
                    return save_ads(db, data) if data is not None else ad_state(db)
                if route == '/api/admin/security' and data is None:
                    return admin_auth.security_info(db)
                if route == '/api/admin/categories':
                    return save_categories(db, data) if data is not None else category_state(db)
                if route == "/api/admin/menu" and data is None:
                    return {"menu": menu_list(db, all_items=True), "order_revision": menu_order_state(db)["revision"], 'categories': category_state(db)['items']}
                if route == "/api/admin/menu-order" and data is not None:
                    return reorder_menu(db, data)
                if route == "/api/admin/menu" and data is not None:
                    return {"id": save_listing(db, data)}
                if route == "/api/admin/orders" and data is None:
                    rows = db.execute("SELECT * FROM orders WHERE number IS NOT NULL ORDER BY number DESC")
                    return {"orders": [orders.order_view(db, row) for row in rows]}
                match = re.fullmatch(r"/api/admin/menu/(\d+)", route)
                if match and data is not None:
                    if "name" in data:
                        save_listing(db, data, int(match[1]))
                    else:
                        edit_menu(db, int(match[1]), data)
                    return {"ok": True}
                match = re.fullmatch(r"/api/admin/orders/([a-f0-9]{32})/cancel", route)
                if match and data is not None:
                    return {"order": orders.cancel_by_admin(db, match[1], data)}
                match = re.fullmatch(r"/api/admin/orders/([a-f0-9]{32})", route)
                if match and data is not None:
                    orders.advance(db, match[1], data.get("expected"))
                    return {"order": orders.order_view(db, db.execute("SELECT * FROM orders WHERE id=?", (match[1],)).fetchone())}
        if route == "/api/orders" and data is not None:
            with connection(server.db_path, write=True) as db:
                return orders.create_order(db, self.customer, data)
        match = re.fullmatch(r"/api/orders/([a-f0-9]{32})(/attempts|/cancel)?", route)
        if match:
            with connection(server.db_path, write=data is not None) as db:
                if not match[2] and data is None:
                    return orders.order_view(db, orders.owner_order(db, match[1], self.customer))
                if match[2] == "/cancel" and data is not None:
                    return orders.cancel_unpaid(db, match[1], self.customer)
                if match[2] == "/attempts" and data is not None:
                    return payments.begin(db, server.gateway, match[1], self.customer, data)
        match = re.fullmatch(r"/api/payments/([a-f0-9]{32})", route)
        if match and data is not None:
            return payments.settle(server.db_path, server.gateway, match[1], self.customer, data)
        raise Problem("요청한 경로를 찾을 수 없습니다.", 404)

    def handle_route(self):
        self.out_cookies = []
        try:
            host = self.headers.get("Host", "")
            allowed_hosts = {f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}"}
            if host not in allowed_hosts:
                raise Problem("로컬 주소로 접속해 주세요.", 403)
            origin = self.headers.get("Origin")
            if self.command == "POST" and origin and origin != "http://" + host:
                raise Problem("같은 주소에서 다시 요청해 주세요.", 403)
            route = urlsplit(self.path).path
            photo = re.fullmatch(r"/api/(menu|ad)-photos/([a-f0-9]{64})", route)
            if photo and self.command == "GET":
                with connection(self.server.db_path) as db:
                    table = 'ad_photo' if photo[1] == 'ad' else 'menu_photo'
                    row = db.execute(f"SELECT content FROM {table} WHERE key=?", (photo[2],)).fetchone()
                if row is None:
                    raise Problem("사진을 찾을 수 없습니다.", 404)
                return self.send_data(200, row["content"], "image/jpeg")
            if not route.startswith("/api/"):
                if self.command != "GET":
                    raise Problem("허용하지 않는 요청입니다.", 405)
                pages = {"/":"index.html", "/index.html":"index.html", "/admin":"admin.html", "/admin.html":"admin.html", "/return":"index.html"}
                name = pages.get(route)
                if not name and re.fullmatch(r"/assets/[a-z0-9_-]+\.(js|css|svg)", route):
                    name = route.rsplit("/",1)[-1]
                if not name:
                    raise Problem("페이지를 찾을 수 없습니다.", 404)
                file = (PAGES if name.endswith(".html") else ASSETS) / name
                if route == "/assets/backend.js":
                    file = Path(__file__).with_name("local-api.js")
                if not file.is_file():
                    raise Problem("페이지를 찾을 수 없습니다.", 404)
                kind = mimetypes.guess_type(name)[0] or "application/octet-stream"
                return self.send_data(200, file.read_bytes(), kind + "; charset=utf-8")
            cookies = SimpleCookie(self.headers.get("Cookie", ""))
            self.customer = cookies["kiosk_session"].value if "kiosk_session" in cookies else ""
            if not re.fullmatch(r"[A-Za-z0-9_-]{43}", self.customer):
                self.customer = secrets.token_urlsafe(32)
                self.cookie("kiosk_session", self.customer)
            self.admin_cookie = cookies["admin_session"].value if "admin_session" in cookies else ""
            result = self.dispatch(route, self.request_data() if self.command == "POST" else None)
            status = 200
        except Problem as exc:
            result, status = {"error": str(exc), "code": exc.code}, exc.status
        except sqlite3.Error:
            result, status = {"error": "저장소에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요."}, 503
        self.send_data(status, json.dumps(result, ensure_ascii=False).encode(), "application/json; charset=utf-8")

    do_GET = handle_route
    do_POST = handle_route


def serve(path, port, password, gateway):
    with ThreadingHTTPServer(("127.0.0.1", port), Handler) as server:
        server.db_path = path
        server.gateway = gateway
        server.password = password
        server.sessions = {}
        server.session_lock = threading.Lock()
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
