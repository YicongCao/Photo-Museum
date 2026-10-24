"""Local SQLite catalog. Network work never holds a transaction."""
import contextlib
import fcntl
import json
import os
from pathlib import Path
import sqlite3
import time
import uuid

MIGRATIONS = sorted((Path(__file__).parent / 'migrations').glob('*.sql'))


class Database:
    def __init__(self, directory):
        self.directory = Path(directory).resolve()
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(self.directory, 0o700)
        self.path = self.directory / 'catalog.sqlite'
        with open(self.directory / '.migrate.lock', 'a+b') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            with self.connect() as db:
                version = db.execute('PRAGMA user_version').fetchone()[0]
                if version > len(MIGRATIONS):
                    raise RuntimeError('Database is newer than this server')
                for target, migration in enumerate(MIGRATIONS, 1):
                    if target > version:
                        db.executescript('BEGIN IMMEDIATE;\n' + migration.read_text() + f'\nPRAGMA user_version={target}; COMMIT;')
        os.chmod(self.path, 0o600)

    @contextlib.contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA foreign_keys=ON')
        db.execute('PRAGMA journal_mode=WAL')
        try:
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    def effective(self, asset_id):
        with self.connect() as db:
            rows = db.execute('SELECT * FROM metadata WHERE asset_id=? AND stale=0', (asset_id,)).fetchall()
        result = {}
        for layer in ('inferred', 'observed', 'manual'):
            for row in rows:
                info = json.loads(row['info_json'])
                if row['layer'] == layer and (layer != 'inferred' or info.get('accepted') is True):
                    result[row['field']] = {'value': json.loads(row['value_json']), 'layer': layer,
                        'rule_version': row['rule_version'], 'record_id': row['record_id'],
                        'is_estimated': layer == 'inferred', 'precision': info.get('precision'),
                        'uncertainty': info.get('uncertainty'), 'confidence': info.get('confidence')}
        return result

    def set_metadata(self, asset_id, field, value, layer, revision=None, rule=None, donors=(), info=None):
        if layer == 'inferred' and field not in ('gps', 'location', 'captured_at'):
            raise ValueError('This per-file fact must not be inferred')
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            asset = db.execute('SELECT * FROM entries WHERE id=?', (asset_id,)).fetchone()
            if not asset or (layer != 'manual' and revision != asset['revision']):
                raise ValueError('Stale source revision')
            if layer not in ('observed', 'inferred', 'manual'):
                raise ValueError('Unknown metadata layer')
            info = dict(info or {})
            if layer == 'observed':
                extraction = db.execute("SELECT status FROM extractions WHERE asset_id=? AND source_revision=?", (asset_id, revision)).fetchone()
                if not extraction or extraction['status'] != 'extracted':
                    raise ValueError('Observed facts require a successful extraction')
            if layer == 'inferred':
                info.setdefault('accepted', False)
                for donor_id, donor_revision, donor_record_id in donors:
                    donor = db.execute('SELECT * FROM entries WHERE id=?', (donor_id,)).fetchone()
                    fact = db.execute("SELECT record_id FROM metadata WHERE asset_id=? AND field=? AND layer='observed' AND stale=0", (donor_id, field)).fetchone()
                    if not donor or donor['revision'] != donor_revision or not fact or fact['record_id'] != donor_record_id or donor['parent'] != asset['parent'] or donor['source_id'] != asset['source_id'] or donor_id == asset_id:
                        raise ValueError('Donors must have current observed facts')
                if not donors or not rule:
                    raise ValueError('Inference requires donors and rule version')
                db.execute('DELETE FROM dependencies WHERE asset_id=? AND field=?', (asset_id, field))
                db.executemany('INSERT INTO dependencies VALUES(?,?,?,?,?)', [(asset_id, field, *d) for d in donors])
            elif layer == 'observed':
                db.execute("UPDATE metadata SET stale=1 WHERE layer='inferred' AND (asset_id,field) IN (SELECT asset_id,field FROM dependencies WHERE donor_id=?)", (asset_id,))
            previous = db.execute('SELECT * FROM metadata WHERE asset_id=? AND field=? AND layer=?', (asset_id, field, layer)).fetchone()
            if previous:
                db.execute('INSERT INTO metadata_history(asset_id,field,layer,record_json,archived) VALUES(?,?,?,?,?)', (asset_id, field, layer, json.dumps(dict(previous)), time.time()))
            db.execute('INSERT OR REPLACE INTO metadata VALUES(?,?,?,?,?,?,0,?,?,?)',
                       (asset_id, field, layer, json.dumps(value, ensure_ascii=False), revision, rule, time.time(), uuid.uuid4().hex, json.dumps(info)))

    def record_extraction(self, asset_id, revision, status, extractor_version):
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            asset = db.execute('SELECT revision FROM entries WHERE id=?', (asset_id,)).fetchone()
            if not asset or asset['revision'] != revision:
                raise ValueError('Stale source revision')
            db.execute('INSERT OR REPLACE INTO extractions VALUES(?,?,?,?,?)',
                       (asset_id, revision, status, extractor_version, time.time()))

    def new_job(self, source_id, root):
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            if db.execute("SELECT 1 FROM jobs WHERE source_id=? AND status IN ('queued','running','paused','blocked')", (source_id,)).fetchone():
                raise ValueError('该照片源已有未完成任务，请先恢复或取消')
            jid = uuid.uuid4().hex
            now = time.time()
            db.execute('INSERT INTO jobs(id,source_id,root,status,created,updated) VALUES(?,?,?,\'queued\',?,?)', (jid, source_id, root, now, now))
            db.execute('INSERT INTO scan_dirs(job_id,path) VALUES(?,?)', (jid, root))
            return jid


def invalidate(db, asset_id):
    db.execute("UPDATE metadata SET stale=1 WHERE asset_id=? AND layer!='manual'", (asset_id,))
    db.execute("UPDATE metadata SET stale=1 WHERE layer='inferred' AND (asset_id,field) IN (SELECT asset_id,field FROM dependencies WHERE donor_id=?)", (asset_id,))
    db.execute("UPDATE derivatives SET status='stale' WHERE asset_id=?", (asset_id,))
