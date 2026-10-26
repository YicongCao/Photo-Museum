"""Resumable local-only enrichment of cached previews; never constructs a NAS client."""
import argparse
import json
import time
from .cache import Cache
from .db import Database
from .processing import Progress,complete_file
from .work_queue import choose_directory
from .worker_runtime import is_database_busy, run_loop


class PhotographyWorker:
    provider_id = "photography"
    steps = ("style", "topic")
    profiles = ("thumb", "display")
    def __init__(self,database,provider):
        self.db,self.provider=database,provider
        self.cache=Cache(database)
        with self.db.connect() as c:
            c.execute("INSERT OR REPLACE INTO settings VALUES(?,?)",(self.provider_id+'_version',provider.version))

    def tick(self):
        with self.db.connect() as c:
            if c.execute("SELECT value FROM settings WHERE key='media_paused'").fetchone()[0]=='true':return False
        focus=choose_directory(self.db)
        with self.db.connect() as c:
            r=c.execute("""SELECT e.id,e.revision,e.kind,m.updated media_updated,m.data_json FROM entries e
                JOIN media_info m ON m.asset_id=e.id AND m.revision=e.revision
                JOIN media_jobs q ON q.asset_id=e.id AND q.revision=e.revision
                JOIN jobs j ON j.id=e.seen_job
                WHERE q.status='ready' AND e.missing=0 AND e.scope_excluded=0
                AND j.status NOT IN ('paused','cancelled','blocked')
                AND coalesce(json_extract(m.data_json,'$.metadata_only'),0)=0
                AND (? IS NULL OR (e.source_id=? AND e.parent=?))
                AND NOT EXISTS(SELECT 1 FROM analysis a WHERE a.asset_id=e.id AND a.revision=e.revision
                    AND a.provider=? AND a.version=?
                    AND json_extract(a.data_json,'$.input_media_version') IS json_extract(m.data_json,'$.version')
                    AND json_extract(a.data_json,'$.input_preview_updated') IS m.updated)
                ORDER BY e.parent DESC,e.path DESC LIMIT 1""",(focus['source_id'] if focus else None,
                    focus['source_id'] if focus else None,focus['parent'] if focus else None,self.provider_id,self.provider.version)).fetchone()
        if not r:return False
        info=json.loads(r['data_json'])
        progress=Progress(self.db,r['id'],r['revision'],self.provider_id)
        if r['kind']=='video_candidate':
            result={'status':'not_applicable','offline':True}
            for step in self.steps:progress.report(step,'skipped')
        else:
            path=next((path for profile in self.profiles if (path:=self.cache.lookup(r['id'],r['revision'],profile))),None)
            if not path:
                result={'error':'preview_cache_missing','offline':True}
                for step in self.steps:progress.report(step,'failed')
            else:
                try:result=self.provider.analyze(path,progress=progress.report)
                except Exception as exc:
                    if is_database_busy(exc):raise
                    result={'error':type(exc).__name__,'offline':True}
                    for step in self.steps:progress.report(step,'failed')
        with self.db.connect() as c:
            c.execute('BEGIN IMMEDIATE')
            latest=c.execute("""SELECT m.updated,q.status,e.missing,e.scope_excluded FROM media_info m
                JOIN entries e ON e.id=m.asset_id AND e.revision=m.revision
                JOIN media_jobs q ON q.asset_id=e.id AND q.revision=e.revision
                WHERE e.id=? AND e.revision=?""",(r['id'],r['revision'])).fetchone()
            if not latest or latest['updated']!=r['media_updated'] or latest['status']!='ready' or latest['missing'] or latest['scope_excluded']:
                c.execute("UPDATE processing_progress SET status='stale',updated=? WHERE asset_id=? AND revision=? AND lane=? AND token=?",(time.time(),r['id'],r['revision'],self.provider_id,progress.token))
                return True
            result['input_media_version']=info.get('version')
            result['input_preview_updated']=r['media_updated']
            c.execute('INSERT OR REPLACE INTO analysis VALUES(?,?,?,?,?,?)',
                      (r['id'],r['revision'],self.provider_id,self.provider.version,json.dumps(result),time.time()))
        progress.finish('failed' if result.get('error') else 'ready')
        if not result.get('error'):complete_file(self.db,r['id'],r['revision'])
        return True


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--data',default='data/server')
    p.add_argument('--models',default='data/models');p.add_argument('--once',action='store_true');a=p.parse_args()
    from .photography import LocalPhotography
    worker=PhotographyWorker(Database(a.data),LocalPhotography(a.models))
    run_loop(worker.tick,idle=2,once=a.once)


if __name__=='__main__':main()
