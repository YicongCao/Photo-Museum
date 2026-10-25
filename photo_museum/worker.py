"""Run as a separate process: python -m photo_museum.worker --data data/server."""
import argparse
import json
import posixpath
import threading
import time
import uuid
from .auth import Security
from .db import Database, invalidate
from .webdav import WebDAV, DAVError
from .worker_runtime import is_database_busy, run_loop
from tools.inventory import classify, excluded_directory, parse_event

LEASE = 30

class Worker:
    def __init__(self, database, dav_factory=WebDAV):
        self.db = database
        self.security = Security(database)
        self.id = uuid.uuid4().hex
        self.factory = dav_factory

    def claim(self):
        now = time.time()
        with self.db.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            db.execute('INSERT OR REPLACE INTO workers VALUES(?,?)', (self.id, now))
            row = db.execute("""SELECT d.*, j.source_id, j.root FROM scan_dirs d JOIN jobs j ON j.id=d.job_id
                WHERE j.status IN ('queued','running') AND ((d.state='pending' AND d.available<=?)
                OR (d.state='leased' AND d.lease_until<?)) ORDER BY d.id LIMIT 1""", (now, now)).fetchone()
            if not row:
                return None
            token = uuid.uuid4().hex
            db.execute("UPDATE scan_dirs SET state='leased',token=?,lease_until=? WHERE id=?", (token, now + LEASE, row['id']))
            db.execute("UPDATE jobs SET status='running',updated=? WHERE id=?", (now, row['job_id']))
            return dict(row) | {'token': token}

    def renew(self, task):
        with self.db.connect() as db:
            db.execute('UPDATE scan_dirs SET lease_until=? WHERE id=? AND token=?', (time.time() + LEASE, task['id'], task['token']))
            db.execute('INSERT OR REPLACE INTO workers VALUES(?,?)', (self.id, time.time()))

    def tick(self):
        task = self.claim()
        if not task:
            return False
        stop = threading.Event()
        def heartbeat():
            while not stop.wait(5):
                try:
                    self.renew(task)
                except Exception as exc:
                    if not is_database_busy(exc):
                        raise
        thread = threading.Thread(target=heartbeat, daemon=True)
        thread.start()
        dav = None
        try:
            with self.db.connect() as db:
                source = dict(db.execute('SELECT * FROM sources WHERE id=?', (task['source_id'],)).fetchone())
            dav = self.factory(source, self.security.decrypt(source['secret']))
            entries = dav.list(task['path'])
            self.commit(task, entries)
        except DAVError as exc:
            self.failure(task, exc.code, exc.retryable)
        except Exception as exc:
            if is_database_busy(exc):
                raise
            self.failure(task, 'worker_internal_error', False)
        finally:
            stop.set()
            thread.join()
            if dav:
                dav.close()
        return True

    def commit(self, task, entries):
        now = time.time()
        with self.db.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            owner = db.execute('SELECT * FROM scan_dirs WHERE id=? AND token=?', (task['id'], task['token'])).fetchone()
            if not owner or owner['lease_until'] < now:
                return
            job = db.execute('SELECT * FROM jobs WHERE id=?', (task['job_id'],)).fetchone()
            if job['status'] not in ('queued', 'running'):
                db.execute("UPDATE scan_dirs SET state='pending',token=NULL,lease_until=NULL WHERE id=?", (task['id'],))
                return
            included = set()
            files = 0
            root = source_root(db, task['source_id'])
            for entry in entries:
                name = posixpath.basename(entry.path)
                event_name = entry.path[len(root):].strip('/').split('/')[0]
                is_event = task['path'] == root and parse_event(name)['precision'] != 'unknown'
                if entry.is_dir and excluded_directory(name) and not is_event:
                    continue
                if entry.is_dir and '/' in entry.path[len(root.rstrip('/')):].strip('/'):
                    # An excluded subtree still exists on the NAS; exclusion is not deletion.
                    included.add(entry.path)
                    db.execute('UPDATE entries SET scope_excluded=1 WHERE source_id=? AND (path=? OR substr(path,1,?)=?)',(task['source_id'],entry.path,len(entry.path)+1,entry.path+'/'))
                    continue
                kind = 'directory' if entry.is_dir else classify(name)
                if kind not in ('directory', 'image_candidate', 'video_candidate'):
                    continue
                included.add(entry.path)
                old = db.execute('SELECT * FROM entries WHERE source_id=? AND path=?', (task['source_id'], entry.path)).fetchone()
                aid = old['id'] if old else uuid.uuid4().hex
                if old and (old['revision'] != entry.revision or old['missing']):
                    invalidate(db, aid)
                db.execute('''INSERT INTO entries(id,source_id,path,parent,is_dir,kind,size,modified,etag,revision,version_quality,event_json,missing,seen_job,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(source_id,path) DO UPDATE SET
                    parent=excluded.parent,is_dir=excluded.is_dir,kind=excluded.kind,size=excluded.size,modified=excluded.modified,
                    etag=excluded.etag,revision=excluded.revision,version_quality=excluded.version_quality,event_json=excluded.event_json,
                    missing=0,scope_excluded=0,seen_job=excluded.seen_job,updated=excluded.updated''',
                    (aid, task['source_id'], entry.path, task['path'], int(entry.is_dir), kind, entry.size, entry.modified,
                     entry.etag, entry.revision, entry.quality, json.dumps(parse_event(event_name), ensure_ascii=False), 0, task['job_id'], now))
                if entry.is_dir:
                    db.execute('INSERT OR IGNORE INTO scan_dirs(job_id,path) VALUES(?,?)', (task['job_id'], entry.path))
                else:
                    files += 1
            # Only reached after a complete, validated successful snapshot. Prefix matching is escaped using substr.
            old_rows = db.execute('SELECT id,path,is_dir FROM entries WHERE source_id=? AND parent=? AND missing=0', (task['source_id'], task['path'])).fetchall()
            for old in old_rows:
                if old['path'] not in included:
                    gone = db.execute('SELECT id FROM entries WHERE source_id=? AND (path=? OR substr(path,1,?)=?)',
                        (task['source_id'], old['path'], len(old['path']) + 1, old['path'] + '/')).fetchall()
                    for item in gone:
                        invalidate(db, item['id'])
                        db.execute('UPDATE entries SET missing=1,updated=? WHERE id=?', (now, item['id']))
            db.execute("UPDATE scan_dirs SET state='done',token=NULL,lease_until=NULL,error=NULL WHERE id=?", (task['id'],))
            pending = db.execute("SELECT 1 FROM scan_dirs WHERE job_id=? AND state NOT IN ('done','excluded')", (task['job_id'],)).fetchone()
            db.execute('UPDATE jobs SET status=?,files_seen=files_seen+?,updated=?,error=NULL WHERE id=?', ('running' if pending else 'completed', files, now, task['job_id']))

    def failure(self, task, code, retryable):
        with self.db.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT attempts,lease_until FROM scan_dirs WHERE id=? AND token=?', (task['id'], task['token'])).fetchone()
            if not row or row['lease_until'] < time.time():
                return
            attempts = row['attempts'] + 1
            db.execute("UPDATE scan_dirs SET state='pending',token=NULL,lease_until=NULL,attempts=?,available=?,error=? WHERE id=?", (attempts, time.time() + min(60, 2 ** attempts), code, task['id']))
            db.execute("UPDATE jobs SET status=CASE WHEN status IN ('paused','cancelled') THEN status ELSE ? END,error=?,updated=? WHERE id=?",
                       ('running' if retryable and attempts < 4 else 'blocked', code, time.time(), task['job_id']))


def source_root(db, source_id):
    return db.execute('SELECT root FROM sources WHERE id=?', (source_id,)).fetchone()[0]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data', default='data/server')
    args = parser.parse_args()
    worker = Worker(Database(args.data))
    try:
        run_loop(worker.tick)
    except KeyboardInterrupt:
        pass

if __name__ == '__main__':
    main()
