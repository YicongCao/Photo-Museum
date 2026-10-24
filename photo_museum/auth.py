import hashlib
import os
from pathlib import Path
import secrets
import time
from argon2 import PasswordHasher
from argon2.exceptions import VerificationError
from cryptography.fernet import Fernet

HASHER = PasswordHasher()

class Security:
    def __init__(self, db):
        self.db = db
        key = db.directory / 'secrets.key'
        if not key.exists():
            # Publish a complete key atomically even when API and worker start together.
            temporary = db.directory / ('key-' + secrets.token_hex(12) + '.tmp')
            fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, 'wb') as f:
                f.write(Fernet.generate_key())
                f.flush()
                os.fsync(f.fileno())
            try:
                os.link(temporary, key)
            except FileExistsError:
                pass
            finally:
                temporary.unlink()
        os.chmod(key, 0o600)
        self.cipher = Fernet(key.read_bytes())

    def initialized(self):
        with self.db.connect() as db:
            return db.execute("SELECT 1 FROM settings WHERE key='password_hash'").fetchone() is not None

    def setup(self, password):
        if not 12 <= len(password) <= 256:
            raise ValueError('馆主密码需要 12–256 个字符')
        encoded = HASHER.hash(password)
        with self.db.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            if db.execute("SELECT 1 FROM settings WHERE key='password_hash'").fetchone():
                raise ValueError('已初始化，请登录')
            db.execute('INSERT INTO settings VALUES(?,?)', ('password_hash', encoded))

    def login(self, password, peer):
        now = time.time()
        with self.db.connect() as db:
            attempt = db.execute('SELECT * FROM login_attempts WHERE peer=?', (peer,)).fetchone()
            if attempt and attempt['until'] > now:
                raise ValueError('尝试过多，请稍后重试')
            row = db.execute("SELECT value FROM settings WHERE key='password_hash'").fetchone()
        try:
            valid = row and HASHER.verify(row['value'], password)
        except VerificationError:
            valid = False
        with self.db.connect() as db:
            if not valid:
                count = (attempt['failures'] if attempt else 0) + 1
                db.execute('INSERT OR REPLACE INTO login_attempts VALUES(?,?,?)', (peer, count, now + 60 if count >= 5 else 0))
            else:
                token = secrets.token_urlsafe(32)
                db.execute('DELETE FROM login_attempts WHERE peer=?', (peer,))
                db.execute('DELETE FROM sessions WHERE expires<?', (now,))
                db.execute('INSERT INTO sessions VALUES(?,?)', (self.digest(token), now + 12 * 3600))
                return token
        raise ValueError('密码不正确')

    @staticmethod
    def digest(token):
        return hashlib.sha256(token.encode()).hexdigest()

    def authenticated(self, token):
        if not token:
            return False
        with self.db.connect() as db:
            return db.execute('SELECT 1 FROM sessions WHERE token_hash=? AND expires>?', (self.digest(token), time.time())).fetchone() is not None

    def encrypt(self, value):
        return self.cipher.encrypt(value.encode()).decode()

    def decrypt(self, value):
        return self.cipher.decrypt(value.encode()).decode()
