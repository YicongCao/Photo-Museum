"""Local cache. Single writer lock covers reservations, staging and publication."""
from contextlib import contextmanager
import fcntl
import os
import time

class CacheFull(Exception):
    pass

class Cache:
    def __init__(self, database):
        self.db = database
        self.root = database.directory / 'cache'
        self.root.mkdir(mode=0o700, exist_ok=True)

    def used(self):
        return sum(p.stat().st_size for p in self.root.rglob('*') if p.is_file())

    @contextmanager
    def writer(self, reserve=0):
        with open(self.root / '.lock', 'a+b') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            self.make_room(reserve)
            yield

    def make_room(self, reserve):
        with self.db.connect() as c:
            budget = int(c.execute("SELECT value FROM settings WHERE key='cache_budget'").fetchone()[0])
            used = self.used()
            # Preserve thumbnail/4K whenever possible; original/compatible assets evict first.
            rows = c.execute("SELECT * FROM cache_files WHERE accessed < unixepoch('now')-120 ORDER BY CASE WHEN profile IN ('thumb','display') THEN 1 ELSE 0 END,accessed").fetchall()
            for row in rows:
                if used + reserve <= budget:
                    break
                path = self.root / row['path']
                size = path.stat().st_size if path.exists() else 0
                path.unlink(missing_ok=True)
                used -= size
                c.execute('DELETE FROM cache_files WHERE key=?', (row['key'],))
                c.execute("UPDATE derivatives SET status='evicted' WHERE asset_id=? AND revision=? AND profile=?", (row['asset_id'],row['revision'],row['profile']))
        if used + reserve > budget:
            raise CacheFull('cache_budget_exceeded')

    def register(self, c, aid, revision, profile, path):
        relative = str(path.relative_to(self.root))
        key = f'{aid}:{revision}:{profile}'
        c.execute('INSERT OR REPLACE INTO cache_files VALUES(?,?,?,?,?,?,?)', (key,aid,revision,profile,relative,path.stat().st_size,time.time()))
        c.execute("INSERT OR REPLACE INTO derivatives VALUES(?,?,?,'ready',?)", (aid,revision,profile,relative))
        os.chmod(path, 0o600)

    def lookup(self, aid, revision, profile):
        with self.db.connect() as c:
            row = c.execute('SELECT * FROM cache_files WHERE asset_id=? AND revision=? AND profile=?', (aid,revision,profile)).fetchone()
            if not row:
                return None
            path = self.root / row['path']
            if not path.is_file():
                c.execute('DELETE FROM cache_files WHERE key=?',(row['key'],))
                c.execute("UPDATE derivatives SET status='evicted' WHERE asset_id=? AND revision=? AND profile=?",(aid,revision,profile))
                return None
            # Coalesce hot preview touches; reads should not serialize on SQLite writes.
            now=time.time()
            if now-row['accessed'] >= 30:
                c.execute('UPDATE cache_files SET accessed=? WHERE key=?', (now,row['key']))
            return path
