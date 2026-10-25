"""Separate, resumable file pipeline; one cache writer, fenced result publication."""
import argparse
import os
import signal
import json
import shutil
import subprocess
import threading
import time
import uuid
from pathlib import Path, PurePosixPath
from PIL import Image
from .processing import Progress, complete_file
from .work_queue import choose_directory
from .worker_runtime import is_database_busy, run_loop
from .auth import Security
from .cache import Cache, CacheFull
from .db import Database
from .download import download, TransferCancelled
from .media import metadata, facts, still, video, MediaUnsupported, VERSION, HDR_VERSION
from .webdav import WebDAV, Entry, DAVError

class MediaWorker:
    def __init__(self, database, dav_factory=WebDAV):
        self.db=database
        self.cache=Cache(database)
        self.security=Security(database)
        self.factory=dav_factory
        self.id='media-'+uuid.uuid4().hex
        self.policy_stamp=None

    def synchronize(self):
        with self.db.connect() as c:
            c.execute("INSERT OR IGNORE INTO media_jobs(asset_id,revision) SELECT id,revision FROM entries WHERE is_dir=0 AND missing=0 AND scope_excluded=0")
            c.execute("UPDATE media_jobs SET status='pending',available=0 WHERE status='ready' AND EXISTS(SELECT 1 FROM media_info m WHERE m.asset_id=media_jobs.asset_id AND m.revision=media_jobs.revision AND json_extract(m.data_json,'$.version') NOT IN (?,?))",(VERSION,HDR_VERSION))
            stamp=tuple(c.execute('SELECT coalesce(max(updated),0),count(*) FROM entries').fetchone())
            if stamp!=self.policy_stamp:
                photos={(r['source_id'],r['parent'],PurePosixPath(r['path']).stem.casefold()) for r in c.execute("SELECT source_id,parent,path FROM entries WHERE kind='image_candidate' AND missing=0 AND scope_excluded=0")}
                videos=c.execute("SELECT id,source_id,parent,path FROM entries WHERE kind='video_candidate' AND missing=0 AND scope_excluded=0").fetchall()
                for video in videos:
                    paired=(video['source_id'],video['parent'],PurePosixPath(video['path']).stem.casefold()) in photos
                    if paired:
                        c.execute("UPDATE media_jobs SET status='pending',available=0 WHERE asset_id=? AND status='indexed' AND NOT EXISTS(SELECT 1 FROM media_info m WHERE m.asset_id=media_jobs.asset_id AND m.revision=media_jobs.revision AND json_extract(m.data_json,'$.placeholder') IS NOT NULL)",(video['id'],))
                    else:
                        c.execute("UPDATE media_jobs SET status='pending',available=0,attempts=0,error=NULL WHERE asset_id=? AND status IN ('ready','failed','unsupported')",(video['id'],))
                self.policy_stamp=stamp
            c.execute("UPDATE media_jobs SET status='stale',token=NULL WHERE NOT EXISTS(SELECT 1 FROM entries e WHERE e.id=asset_id AND e.revision=media_jobs.revision AND e.missing=0 AND e.scope_excluded=0)")

    def claim(self):
        self.synchronize()
        focus=choose_directory(self.db)
        now=time.time()
        with self.db.connect() as c:
            c.execute('BEGIN IMMEDIATE')
            c.execute('INSERT OR REPLACE INTO workers VALUES(?,?)',(self.id,now))
            if c.execute("SELECT value FROM settings WHERE key='media_paused'").fetchone()[0]=='true':
                return None
            if not focus:return None
            row=c.execute("""SELECT e.*,q.attempts FROM media_jobs q JOIN entries e ON e.id=q.asset_id AND e.revision=q.revision JOIN jobs j ON j.id=e.seen_job
                WHERE e.missing=0 AND e.scope_excluded=0 AND e.source_id=? AND e.parent=? AND j.status NOT IN ('paused','cancelled','blocked') AND ((q.status='pending' AND q.available<=?) OR (q.status='running' AND q.lease_until<?)) ORDER BY e.path DESC LIMIT 1""",(focus['source_id'],focus['parent'],now,now)).fetchone()
            if not row:
                return None
            task=dict(row)|{'token':uuid.uuid4().hex}
            c.execute("UPDATE media_jobs SET status='running',token=?,lease_until=?,updated=? WHERE asset_id=? AND revision=?",(task['token'],now+30,now,task['id'],task['revision']))
            return task

    def cancelled(self,t):
        with self.db.connect() as c:
            paused=c.execute("SELECT value FROM settings WHERE key='media_paused'").fetchone()[0]=='true'
            row=c.execute("SELECT q.token,e.missing,e.scope_excluded,e.revision,j.status FROM media_jobs q JOIN entries e ON e.id=q.asset_id JOIN jobs j ON j.id=e.seen_job WHERE q.asset_id=? AND q.revision=?",(t['id'],t['revision'])).fetchone()
        return paused or not row or row['token']!=t['token'] or row['missing'] or row['scope_excluded'] or row['revision']!=t['revision'] or row['status'] in ('paused','cancelled','blocked')

    def stage(self,t,stage):
        if self.cancelled(t):
            raise TransferCancelled()
        with self.db.connect() as c:
            c.execute('UPDATE media_jobs SET stage=?,updated=? WHERE asset_id=? AND revision=? AND token=?',(stage,time.time(),t['id'],t['revision'],t['token']))

    def finish(self,t,status,error=None,retry=False):
        with self.db.connect() as c:
            c.execute("UPDATE media_jobs SET status=?,error=?,attempts=attempts+?,available=?,token=NULL,lease_until=NULL,updated=? WHERE asset_id=? AND revision=? AND token=?",
                      (status,error,int(error is not None),time.time()+(min(120,2**(t['attempts']+1)) if retry else 0),time.time(),t['id'],t['revision'],t['token']))

    def standalone_video(self,t):
        if t['kind']!='video_candidate':return False
        stem=PurePosixPath(t['path']).stem.casefold()
        with self.db.connect() as c:
            photos=c.execute("SELECT path FROM entries WHERE source_id=? AND parent=? AND kind='image_candidate' AND missing=0 AND scope_excluded=0",(t['source_id'],t['parent'])).fetchall()
        return not any(PurePosixPath(r['path']).stem.casefold()==stem for r in photos)

    def index_video(self,t,progress,placeholder=None):
        # WebDAV already supplied name, size, mtime, revision and activity. No GET/codec/model.
        self.stage(t,'publish')
        for step in ('download','exif','frame','display','thumb','playback'):
            progress.report(step,'skipped')
        progress.report('publish')
        with self.db.connect() as c:
            c.execute('BEGIN IMMEDIATE')
            owned=c.execute('SELECT token FROM media_jobs WHERE asset_id=? AND revision=?',(t['id'],t['revision'])).fetchone()
            if not owned or owned['token']!=t['token']:raise TransferCancelled()
            previous=c.execute('SELECT data_json FROM media_info WHERE asset_id=? AND revision=?',(t['id'],t['revision'])).fetchone()
            info=json.loads(previous['data_json']) if previous else {}
            has_cache=bool(c.execute("SELECT 1 FROM cache_files WHERE asset_id=? AND revision=? AND profile='thumb'",(t['id'],t['revision'])).fetchone())
            info.update(metadata_only=True,cached_preview=has_cache,version=VERSION,policy='oversized-index-only-v1' if placeholder else 'standalone-video-index-only-v1')
            if placeholder:info.update(placeholder=placeholder,score=None)
            c.execute('INSERT OR REPLACE INTO media_info VALUES(?,?,?,?)',(t['id'],t['revision'],json.dumps(info),time.time()))
        progress.report('publish','done')
        self.finish(t,'indexed')
        progress.finish('indexed')
        analysis=Progress(self.db,t['id'],t['revision'],'analysis')
        for step in ('address','subject','faces','score'):analysis.report(step,'skipped')
        analysis.finish('ready')
        complete_file(self.db,t['id'],t['revision'])

    def oversized(self,t):
        kind='video' if t['kind']=='video_candidate' else 'image'
        limit=2*1024**3 if kind=='video' else 256*1024**2
        if t['size'] is not None and t['size']>limit:return kind
        if kind=='image':
            values=self.db.effective(t['id'])
            w=values.get('width',{}).get('value',0);h=values.get('height',{}).get('value',0)
            if isinstance(w,(int,float)) and isinstance(h,(int,float)) and w*h>Image.MAX_IMAGE_PIXELS:return kind
        return None

    def index_placeholder(self,t,progress,kind,locked=False):
        def publish():
            self.stage(t,'publish')
            target=self.cache.root/(t['id']+'-'+t['revision']);target.mkdir(exist_ok=True)
            source=Path(__file__).parent/'static'/('oversized-'+kind+'.svg')
            with self.db.connect() as c:
                for profile in ('thumb','display'):
                    final=target/(profile+'.svg');shutil.copyfile(source,final)
                    self.cache.register(c,t['id'],t['revision'],profile,final)
            self.index_video(t,progress,placeholder=kind)
        if locked:publish()
        else:
            with self.cache.writer(reserve=4096):publish()

    def tick(self):
        t=self.claim()
        if not t:
            return False
        progress=Progress(self.db,t['id'],t['revision'],'media',t['token'])
        stop=threading.Event()
        def renew():
            while not stop.wait(5):
                try:
                    with self.db.connect() as c:
                        c.execute('UPDATE media_jobs SET lease_until=? WHERE asset_id=? AND revision=? AND token=?',(time.time()+30,t['id'],t['revision'],t['token']))
                        c.execute('INSERT OR REPLACE INTO workers VALUES(?,?)',(self.id,time.time()))
                        c.execute("UPDATE processing_progress SET updated=? WHERE asset_id=? AND revision=? AND lane='media' AND token=?",(time.time(),t['id'],t['revision'],t['token']))
                except Exception as exc:
                    if not is_database_busy(exc):raise
        thread=threading.Thread(target=renew,daemon=True)
        thread.start()
        dav=None
        scratch=self.cache.root/'work'
        try:
            if kind:=self.oversized(t):
                self.index_placeholder(t,progress,kind)
                return True
            if self.standalone_video(t):
                self.index_video(t,progress)
                return True
            if t['size'] is None or t['size']>2*1024**3:
                raise MediaUnsupported('source_exceeds_2gib_limit')
            with self.cache.writer(reserve=t['size']+2*1024**3):
                marker=scratch/'task'
                identity=t['id']+':'+t['revision']
                if not marker.exists() or marker.read_text()!=identity:
                    shutil.rmtree(scratch,ignore_errors=True)
                scratch.mkdir(exist_ok=True)
                marker.write_text(identity)
                # Retry spool is preserved; output artifacts can always be regenerated.
                outputs=scratch/'outputs'
                shutil.rmtree(outputs,ignore_errors=True)
                outputs.mkdir()
                with self.db.connect() as c:
                    source=dict(c.execute('SELECT * FROM sources WHERE id=?',(t['source_id'],)).fetchone())
                dav=self.factory(source,self.security.decrypt(source['secret']))
                self.stage(t,'download')
                progress.report('download')
                e=Entry(t['path'],False,t['size'],t['modified'],t['etag'])
                local=download(dav,e,scratch/'spool',lambda:self.cancelled(t),max_bytes=2*1024**3,budget=3*1024**3,progress=progress.transfer)['path']
                progress.report('download','done')
                self.stage(t,'metadata')
                progress.report('exif')
                meta=metadata(local)
                self.db.record_extraction(t['id'],t['revision'],'extracted',VERSION)
                for field,value in facts(meta).items():
                    self.db.set_metadata(t['id'],field,value,'observed',t['revision'],VERSION)
                progress.report('exif','done')
                self.stage(t,'cache')
                try:
                    if kind:=self.oversized(t):raise Image.DecompressionBombError()
                    result=(video if t['kind']=='video_candidate' else still)(local,outputs,meta,progress.report)
                except Image.DecompressionBombError:
                    self.index_placeholder(t,progress,'image',locked=True)
                    shutil.rmtree(scratch,ignore_errors=True)
                    return True
                result.update(file_type=meta.get('FileType'),version=result.pop('render_version',VERSION))
                self.stage(t,'publish')
                progress.report('publish')
                target=self.cache.root/(t['id']+'-'+t['revision'])
                target.mkdir(exist_ok=True)
                with self.db.connect() as c:
                    c.execute('BEGIN IMMEDIATE')
                    current=c.execute('SELECT token,lease_until FROM media_jobs WHERE asset_id=? AND revision=?',(t['id'],t['revision'])).fetchone()
                    entry=c.execute('SELECT revision,missing,scope_excluded FROM entries WHERE id=?',(t['id'],)).fetchone()
                    if not current or current['token']!=t['token'] or current['lease_until']<time.time() or entry['revision']!=t['revision'] or entry['missing'] or entry['scope_excluded']:
                        raise TransferCancelled()
                    for output in outputs.iterdir():
                        if output.stem not in ('thumb','display'):continue
                        final=target/output.name
                        output.replace(final)
                        self.cache.register(c,t['id'],t['revision'],output.stem,final)
                    c.execute('INSERT OR REPLACE INTO media_info VALUES(?,?,?,?)',(t['id'],t['revision'],json.dumps(result),time.time()))
                shutil.rmtree(scratch)
                self.finish(t,'ready')
                progress.report('publish','done')
                progress.finish('ready')
                if os.environ.get('MUSEUM_ANALYSIS_ENABLED')!='1':
                    analysis=Progress(self.db,t['id'],t['revision'],'analysis')
                    for step in ('address','subject','faces','score'):analysis.report(step,'skipped')
                    analysis.finish('ready')
                complete_file(self.db,t['id'],t['revision'])
                # Directory rules are local, conservative and independent of NAS reads.
                from .inference import infer_directory
                with self.db.connect() as c:
                    pending=c.execute("SELECT 1 FROM media_jobs q JOIN entries e ON e.id=q.asset_id AND e.revision=q.revision WHERE e.source_id=? AND e.parent=? AND q.status IN ('pending','running') LIMIT 1",(t['source_id'],t['parent'])).fetchone()
                if not pending:
                    infer_directory(self.db,t['source_id'],t['parent'])
        except TransferCancelled:
            self.finish(t,'pending')
        except MediaUnsupported as exc:
            self.finish(t,'unsupported',str(exc))
        except DAVError as exc:
            retry=exc.retryable and t['attempts']<3
            self.finish(t,'pending' if retry else 'failed',exc.code,retry)
        except CacheFull:
            self.finish(t,'failed','cache_budget_exceeded')
        except subprocess.TimeoutExpired:
            self.finish(t,'failed','codec_timeout')
        except Exception as exc:
            if is_database_busy(exc):raise
            # Never expose ExifTool/ffmpeg stderr, filenames or credentials in public logs.
            self.finish(t,'failed','media_'+type(exc).__name__)
        finally:
            stop.set()
            thread.join()
            if dav:
                dav.close()
            with self.db.connect() as c:
                status=c.execute('SELECT status FROM media_jobs WHERE asset_id=? AND revision=?',(t['id'],t['revision'])).fetchone()
            if status:
                if status['status']=='running':self.finish(t,'pending')
                progress.finish(status['status'] if status['status']!='running' else 'pending')
        return True

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--data',default='data/server')
    p.add_argument('--once',action='store_true')
    a=p.parse_args()
    def shutdown(*_):
        raise SystemExit(0)
    signal.signal(signal.SIGTERM,shutdown)
    worker=MediaWorker(Database(a.data))
    run_loop(worker.tick,once=a.once)

if __name__=='__main__':
    main()
