"""Start the local kiosk on Python 3.10 or later."""
import argparse
import os
import secrets
from pathlib import Path

from kiosk.http import serve
from kiosk.payments import Gateway
from kiosk.store import initialize


def main():
    parser = argparse.ArgumentParser(description="3조 햄버거 주문·관리 시스템")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--data-dir", type=Path, default=Path(__file__).resolve().parent / "data")
    args = parser.parse_args()
    gateway = Gateway()
    path = args.data_dir / "kiosk.sqlite3"
    initialize(path)
    password = os.environ.get("KIOSK_ADMIN_PASSWORD")
    if not password:
        password_file = args.data_dir / "admin-code.txt"
        try:
            with password_file.open("x", encoding="utf-8") as file:
                file.write(secrets.token_urlsafe(10))
        except FileExistsError:
            pass
        password = password_file.read_text(encoding="utf-8").strip()
        print(f"관리자 암호 파일: {password_file.resolve()}", flush=True)
    if not password.strip():
        parser.error("관리자 암호를 설정해 주세요.")
    print(f"고객  http://127.0.0.1:{args.port}/\n관리  http://127.0.0.1:{args.port}/admin", flush=True)
    serve(path, args.port, password, gateway)


if __name__ == "__main__":
    main()
