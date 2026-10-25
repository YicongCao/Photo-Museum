"""Persistent, fenced per-file telemetry. Percentages only describe measured work."""
import json
import time
import uuid

class Progress:
    def __init__(self, db, asset_id, revision, lane, token=None):
        self.db, self.asset, self.revision, self.lane = db, asset_id, revision, lane
        self.token = token or uuid.uuid4().hex
        self.stage = ''
        self.steps = {}
        self.last = 0
        with db.connect() as c:
            c.execute('INSERT OR REPLACE INTO processing_progress VALUES(?,?,?,?,?,?,?,?,?,?)',
                      (asset_id, revision, lane, self.token, '', 'running', '{}', 0, None, time.time()))

    def report(self, stage, status='running', done=None, total=None):
        self.stage = stage
        self.steps[stage] = status
        with self.db.connect() as c:
            c.execute('''UPDATE processing_progress SET stage=?,steps_json=?,bytes_done=coalesce(?,bytes_done),
                         bytes_total=coalesce(?,bytes_total),updated=?
                         WHERE asset_id=? AND revision=? AND lane=? AND token=?''',
                      (stage, json.dumps(self.steps), done, total, time.time(), self.asset, self.revision, self.lane, self.token))

    def transfer(self, done, total):
        now = time.monotonic()
        if now-self.last >= .3 or done == total:
            self.report('download', 'running', done, total)
            self.last = now

    def finish(self, status):
        if status not in ('ready','indexed') and self.stage:
            self.report(self.stage, status)
        with self.db.connect() as c:
            c.execute('UPDATE processing_progress SET status=?,updated=? WHERE asset_id=? AND revision=? AND lane=? AND token=?',
                      (status, time.time(), self.asset, self.revision, self.lane, self.token))


def complete_file(db, aid, revision):
    """Publish only when cache and every enabled analysis lane have settled."""
    from .photography import enabled,pipeline_suffix
    with db.connect() as c:
        c.execute('BEGIN IMMEDIATE')
        entry=c.execute('SELECT revision,missing,scope_excluded FROM entries WHERE id=?',(aid,)).fetchone()
        if not entry or entry['missing'] or entry['scope_excluded'] or entry['revision']!=revision:
            return
        lanes={r['lane']:dict(r) for r in c.execute('SELECT * FROM processing_progress WHERE asset_id=? AND revision=?',(aid,revision))}
        if any(lanes.get(lane,{}).get('status') not in ('ready','indexed') for lane in ('media','analysis')):
            return
        steps={}
        for lane in lanes.values():steps.update(json.loads(lane['steps_json']))
        required=('download','exif','display','thumb','publish','address','subject','faces','score')
        if any(steps.get(stage) not in ('done','skipped') for stage in required):
            return
        media=c.execute('SELECT data_json,updated FROM media_info WHERE asset_id=? AND revision=?',(aid,revision)).fetchone()
        analysis=c.execute("SELECT version,data_json FROM analysis WHERE asset_id=? AND revision=? AND provider='visual'",(aid,revision)).fetchone()
        media_version=json.loads(media['data_json']).get('version','unknown')
        visual_enabled=steps.get('subject')!='skipped'
        if visual_enabled and (not analysis or json.loads(analysis['data_json']).get('error') or json.loads(analysis['data_json']).get('input_media_version')!=media_version):
            return
        metadata_only=json.loads(media['data_json']).get('metadata_only')
        if enabled() and not metadata_only:
            photo=c.execute("SELECT version,data_json FROM analysis WHERE asset_id=? AND revision=? AND provider='photography'",(aid,revision)).fetchone()
            if (lanes.get('photography',{}).get('status')!='ready' or not photo
                or '|'+photo['version']!=pipeline_suffix(c) or json.loads(photo['data_json']).get('error')
                or json.loads(photo['data_json']).get('input_media_version')!=media_version
                or json.loads(photo['data_json']).get('input_preview_updated')!=media['updated']
                or any(steps.get(s) not in ('done','skipped') for s in ('style','topic'))):return
        pipeline=media_version+'|'+('metadata-only' if metadata_only else analysis['version'] if visual_enabled else 'disabled')
        if not metadata_only:pipeline+=pipeline_suffix(c)
        c.execute('INSERT OR IGNORE INTO file_completions(asset_id,revision,pipeline,steps_json,completed) VALUES(?,?,?,?,?)',
                  (aid,revision,pipeline,json.dumps(steps),time.time()))
