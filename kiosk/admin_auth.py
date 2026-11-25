"""Persistent password changes and one-use recovery codes; no plaintext storage."""
import hashlib
import hmac
import re
import secrets
import time
import unicodedata
from .store import Problem, connection

DEFAULTS = dict(password_hash=None, salt=None, iterations=100000, revision=0, recovery_hash=None, changed_at=None)
def auth_state(db):
    row = db.execute('SELECT * FROM admin_auth WHERE id=1').fetchone()
    return dict(row) if row else DEFAULTS.copy()

def _normal(value): return unicodedata.normalize('NFC', value)
def _derive(password, salt, iterations=100000): return hashlib.pbkdf2_hmac('sha256', _normal(password).encode(), salt.encode(), iterations).hex()
def _sha(value): return hashlib.sha256(value.encode()).hexdigest()
def _matches(state, password, bootstrap):
    if not isinstance(password, str) or len(password) > 256: return False
    if state['password_hash']: return hmac.compare_digest(_derive(password, state['salt'], state['iterations']), state['password_hash'])
    return hmac.compare_digest(password.encode(), bootstrap.encode())

def _new_password(data):
    value = data.get('new_password')
    if not isinstance(value, str) or not 12 <= len(value) <= 128 or not value.strip():
        raise Problem('새 암호를 12~128자로 입력해 주세요.')
    if not isinstance(data.get('confirm_password'), str) or _normal(value) != _normal(data['confirm_password']):
        raise Problem('새 암호와 확인 값이 일치하지 않습니다.')
    return _normal(value)

def _limit(path, group):
    now = int(time.time()*1000)
    with connection(path, write=True) as db:
        db.execute('DELETE FROM auth_attempt WHERE expires<?', (now,))
        db.execute('INSERT OR IGNORE INTO auth_attempt(key,count,expires) VALUES(?,0,?)', (group, now+600000))
        db.execute('UPDATE auth_attempt SET count=count+1 WHERE key=?', (group,))
        count = db.execute('SELECT count FROM auth_attempt WHERE key=?', (group,)).fetchone()[0]
    if count > 10: raise Problem('인증 시도가 너무 많습니다. 10분 후 다시 시도해 주세요.', 429, 'AUTH_RATE_LIMIT')

def login(path, bootstrap, password):
    _limit(path, 'login')
    with connection(path, write=True) as db:
        state = auth_state(db)
        if not _matches(state, password, bootstrap): raise Problem('관리자 암호를 확인해 주세요.', 401, 'WRONG_PASSWORD')
        db.execute("DELETE FROM auth_attempt WHERE key='login'")
        return state['revision']

def security_info(db):
    state = auth_state(db)
    return {'recovery_ready': bool(state['recovery_hash']), 'changed_at': state['changed_at']}

def change_password(path, bootstrap, data):
    _limit(path, 'security')
    password = _new_password(data)
    with connection(path, write=True) as db:
        state = auth_state(db)
        if not _matches(state, data.get('current_password'), bootstrap): raise Problem('현재 암호를 확인해 주세요.', 400, 'WRONG_PASSWORD')
        if _matches(state, password, bootstrap): raise Problem('현재 암호와 다른 새 암호를 입력해 주세요.')
        salt = secrets.token_hex(16)
        db.execute('INSERT OR IGNORE INTO admin_auth(id) VALUES(1)')
        db.execute("UPDATE admin_auth SET password_hash=?,salt=?,iterations=100000,revision=revision+1,recovery_hash=NULL,changed_at=CURRENT_TIMESTAMP WHERE id=1", (_derive(password, salt), salt))
        db.execute("DELETE FROM auth_attempt WHERE key='security'")
    return {'ok': True}

def issue_recovery(path, bootstrap, data):
    _limit(path, 'security')
    with connection(path, write=True) as db:
        state = auth_state(db)
        if not _matches(state, data.get('current_password'), bootstrap): raise Problem('현재 암호를 확인해 주세요.', 400, 'WRONG_PASSWORD')
        code = secrets.token_hex(32)
        db.execute('INSERT OR IGNORE INTO admin_auth(id) VALUES(1)')
        db.execute('UPDATE admin_auth SET recovery_hash=? WHERE id=1', (_sha(code),))
        db.execute("DELETE FROM auth_attempt WHERE key='security'")
    return {'code': '-'.join(code[i:i+8] for i in range(0,64,8))}

def reset_password(path, data):
    _limit(path, 'reset')
    password = _new_password(data)
    code = re.sub(r'[\s-]', '', data.get('recovery_code', '')).lower() if isinstance(data.get('recovery_code'), str) else ''
    with connection(path, write=True) as db:
        state = auth_state(db)
        if not re.fullmatch(r'[a-f0-9]{64}', code) or not state['recovery_hash'] or not hmac.compare_digest(_sha(code), state['recovery_hash']):
            raise Problem('복구 코드를 확인해 주세요.', 400, 'WRONG_RECOVERY')
        salt = secrets.token_hex(16)
        db.execute("UPDATE admin_auth SET password_hash=?,salt=?,iterations=100000,revision=revision+1,recovery_hash=NULL,changed_at=CURRENT_TIMESTAMP WHERE id=1", (_derive(password, salt), salt))
        db.execute("DELETE FROM auth_attempt WHERE key='reset'")
    return {'ok': True}
