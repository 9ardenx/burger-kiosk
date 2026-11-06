"""Loopback HTTP entry points for the kiosk and store console."""
import hmac
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
from urllib.parse import urlsplit

from . import orders, payments
from .store import Problem, connection, edit_menu, menu_list

ASSETS = Path(__file__).resolve().parent / "static"


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
            until = self.server.sessions.get(self.admin_cookie, 0)
        if until <= time.monotonic():
            raise Problem("관리자 로그인이 필요합니다.", 401)

    def request_data(self):
        if self.headers.get_content_type() != "application/json":
            raise Problem("JSON 요청이 필요합니다.", 415)
        try:
            size = int(self.headers.get("Content-Length", 0))
            if not 0 < size <= 32000:
                raise Problem("요청 크기를 확인해 주세요.", 413)
            data = json.loads(self.rfile.read(size))
        except (ValueError, UnicodeError):
            raise Problem("요청을 읽을 수 없습니다.")
        if not isinstance(data, dict):
            raise Problem("입력값을 확인해 주세요.")
        return data

    def dispatch(self, route, data):
        server = self.server
        if route == "/api/menu" and data is None:
            with connection(server.db_path) as db:
                return {"menu": menu_list(db), "mode": server.gateway.mode, "clientKey": server.gateway.client_key}
        if route == "/api/admin/login" and data is not None:
            password = data.get("password")
            if not isinstance(password, str) or not hmac.compare_digest(password.encode(), server.password.encode()):
                raise Problem("관리자 암호를 확인해 주세요.", 401)
            token = secrets.token_urlsafe(32)
            with server.session_lock:
                now = time.monotonic()
                server.sessions = {k:v for k,v in server.sessions.items() if v>now}
                server.sessions.pop(self.admin_cookie, None)
                server.sessions[token] = now + 8 * 3600
            self.cookie("admin_session", token)
            return {"ok": True}
        if route.startswith("/api/admin/"):
            self.require_admin()
            if route == "/api/admin/logout" and data is not None:
                with server.session_lock:
                    server.sessions.pop(self.admin_cookie, None)
                self.cookie("admin_session", "", clear=True)
                return {"ok": True}
            with connection(server.db_path, write=data is not None) as db:
                if route == "/api/admin/menu" and data is None:
                    return {"menu": menu_list(db, all_items=True)}
                if route == "/api/admin/orders" and data is None:
                    rows = db.execute("SELECT * FROM orders WHERE number IS NOT NULL ORDER BY number DESC")
                    return {"orders": [orders.order_view(db, row) for row in rows]}
                match = re.fullmatch(r"/api/admin/menu/(\d+)", route)
                if match and data is not None:
                    edit_menu(db, int(match[1]), data)
                    return {"ok": True}
                match = re.fullmatch(r"/api/admin/orders/([a-f0-9]{32})", route)
                if match and data is not None:
                    orders.advance(db, match[1], data.get("expected"))
                    return {"ok": True}
        if route == "/api/orders" and data is not None:
            with connection(server.db_path, write=True) as db:
                return orders.create_order(db, self.customer, data)
        match = re.fullmatch(r"/api/orders/([a-f0-9]{32})(/attempts)?", route)
        if match:
            with connection(server.db_path, write=data is not None) as db:
                if not match[2] and data is None:
                    return orders.order_view(db, orders.owner_order(db, match[1], self.customer))
                if match[2] and data is not None:
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
            if not route.startswith("/api/"):
                if self.command != "GET":
                    raise Problem("허용하지 않는 요청입니다.", 405)
                pages = {"/":"index.html", "/admin":"admin.html", "/return":"index.html"}
                name = pages.get(route)
                if not name and re.fullmatch(r"/assets/[a-z0-9_-]+\.(js|css|svg)", route):
                    name = route.rsplit("/",1)[-1]
                if not name or not (ASSETS/name).is_file():
                    raise Problem("페이지를 찾을 수 없습니다.", 404)
                kind = mimetypes.guess_type(name)[0] or "application/octet-stream"
                return self.send_data(200, (ASSETS/name).read_bytes(), kind + "; charset=utf-8")
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
