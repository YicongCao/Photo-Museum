"""Authenticated exhibition API. Paths never become filesystem/URL parameters."""
import fcntl
import os
import hashlib
import json
import time
from datetime import datetime
from pathlib import PurePosixPath
from fastapi import Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from .cache import Cache
from .photography import enabled as photography_enabled

def activity_time(event, rows):
    """Latest observed capture within the declared period; never invent a day."""
    dates = []
    for row in rows:
        value = json.loads(row['data_json']).get('captured_at')
        if not isinstance(value, str):
            continue
        try:
            date = datetime.strptime(value[:19].replace('T', ' ').replace('-', ':'), '%Y:%m:%d %H:%M:%S')
        except ValueError:
            continue
        if event.get('year') and date.year != event['year']:
            continue
        if event.get('month') and date.month != event['month']:
            continue
        dates.append(date.isoformat())
    return max(dates, default='')

def event_id(source,path):
    return hashlib.sha256((source+'\0'+path).encode()).hexdigest()[:24]

def media_url(row,profile):
    row=dict(row)
    info=json.loads(row.get('data_json') or '{}')
    preview='&render='+info['version'] if info.get('hdr_policy') else ''
    return f"/api/assets/{row['id']}/media/{profile}?revision={row['revision']}"+preview

class QueueControl(BaseModel):
    action: str

class CurateInput(BaseModel):
    pinned: bool=False
    excluded: bool=False

class MetadataInput(BaseModel):
    field: str
    value: str | dict | None

class BudgetInput(BaseModel):
    gib: int=Field(ge=4,le=200)

def register(app,database,owner):
    cache=Cache(database)
    def pipeline(c):
        from .photography import pipeline_suffix
        version=c.execute("SELECT value FROM settings WHERE key='analysis_version'").fetchone()
        return '|'+(version['value'] if version and os.environ.get('MUSEUM_ANALYSIS_ENABLED')=='1' else 'disabled')+pipeline_suffix(c)
    @app.get('/api/media/state',dependencies=[Depends(owner)])
    def media_state(after: int | None = None):
        with database.connect() as c:
            c.execute('BEGIN')
            current_pipeline=pipeline(c)
            counts={r['status']:r['n'] for r in c.execute("SELECT q.status,count(*) n FROM media_jobs q JOIN entries e ON e.id=q.asset_id AND e.revision=q.revision WHERE e.missing=0 AND e.scope_excluded=0 GROUP BY q.status")}
            errors=[dict(r) for r in c.execute("SELECT q.asset_id,q.status,q.stage,q.error,e.path FROM media_jobs q JOIN entries e ON e.id=q.asset_id AND e.revision=q.revision WHERE e.missing=0 AND e.scope_excluded=0 AND q.status IN ('failed','unsupported')")]
            if os.environ.get('MUSEUM_ANALYSIS_ENABLED')=='1':
                errors.extend(dict(r) for r in c.execute("""SELECT e.id asset_id,'failed' status,'analysis' stage,json_extract(a.data_json,'$.error') error,e.path FROM analysis a JOIN entries e ON e.id=a.asset_id AND e.revision=a.revision JOIN media_info m ON m.asset_id=e.id AND m.revision=e.revision JOIN media_jobs q ON q.asset_id=e.id AND q.revision=e.revision WHERE e.missing=0 AND e.scope_excluded=0 AND q.status='ready' AND a.provider='visual' AND a.version=(SELECT value FROM settings WHERE key='analysis_version') AND json_extract(a.data_json,'$.input_media_version') IS json_extract(m.data_json,'$.version') AND json_extract(a.data_json,'$.error') IS NOT NULL"""))
            if photography_enabled():
                errors.extend(dict(r) for r in c.execute("""SELECT e.id asset_id,'failed' status,'photography' stage,json_extract(a.data_json,'$.error') error,e.path FROM analysis a JOIN entries e ON e.id=a.asset_id AND e.revision=a.revision JOIN media_info m ON m.asset_id=e.id AND m.revision=e.revision JOIN media_jobs q ON q.asset_id=e.id AND q.revision=e.revision WHERE e.missing=0 AND e.scope_excluded=0 AND q.status='ready' AND a.provider='photography' AND a.version=(SELECT value FROM settings WHERE key='photography_version') AND json_extract(a.data_json,'$.input_media_version') IS json_extract(m.data_json,'$.version') AND json_extract(a.data_json,'$.error') IS NOT NULL"""))
            active=[dict(r) for r in c.execute("""SELECT q.asset_id,q.stage,e.path,e.kind,e.revision,e.size,'media' lane FROM media_jobs q JOIN entries e ON e.id=q.asset_id AND e.revision=q.revision WHERE e.missing=0 AND e.scope_excluded=0 AND q.status='running' AND q.lease_until>? ORDER BY q.updated DESC LIMIT 4""",(time.time(),))]
            analyzing=[dict(r) for r in c.execute("""SELECT p.asset_id,p.stage,e.path,e.kind,e.revision,e.size,p.lane FROM processing_progress p JOIN entries e ON e.id=p.asset_id AND e.revision=p.revision WHERE e.missing=0 AND e.scope_excluded=0 AND p.lane IN ('analysis','photography') AND p.status='running' AND p.updated>? ORDER BY p.updated DESC LIMIT 2""",(time.time()-60,))]
            active.extend(r for r in analyzing if not any(a['asset_id']==r['asset_id'] for a in active))
            for item in active:
                item['photography_enabled']=photography_enabled()
                item['steps']={}
                item['bytes_done']=0
                item['bytes_total']=item['size']
                for p in c.execute('SELECT * FROM processing_progress WHERE asset_id=? AND revision=?',(item['asset_id'],item['revision'])):
                    item['steps'].update(json.loads(p['steps_json']))
                    if p['lane']=='media':
                        item.update(bytes_done=p['bytes_done'],bytes_total=p['bytes_total'] if p['bytes_total'] is not None else item['size'])
            recent=[pack(dict(r)) for r in c.execute("""SELECT e.*,m.data_json,f.completed completed_at FROM media_info m JOIN entries e ON e.id=m.asset_id AND e.revision=m.revision JOIN file_completions f ON f.asset_id=e.id AND f.revision=e.revision AND f.pipeline IN (json_extract(m.data_json,'$.version')||?,json_extract(m.data_json,'$.version')||?) JOIN media_jobs q ON q.asset_id=e.id AND q.revision=e.revision WHERE e.missing=0 AND e.scope_excluded=0 AND q.status='ready' AND EXISTS(SELECT 1 FROM cache_files f WHERE f.asset_id=e.id AND f.revision=e.revision AND f.profile='thumb') AND EXISTS(SELECT 1 FROM cache_files f WHERE f.asset_id=e.id AND f.revision=e.revision AND f.profile='display') ORDER BY f.completed DESC,e.id LIMIT 20""",(current_pipeline,'|metadata-only'))]
            recent.reverse()
            cursor=c.execute('SELECT coalesce(max(id),0) FROM file_completions').fetchone()[0] if after is None else max(0,after)
            events=[]
            if after is not None:
                for r in c.execute("""SELECT e.*,m.data_json,f.id completion_id,f.steps_json,f.completed completed_at FROM file_completions f JOIN media_info m ON m.asset_id=f.asset_id AND m.revision=f.revision JOIN entries e ON e.id=f.asset_id AND e.revision=f.revision JOIN media_jobs q ON q.asset_id=e.id AND q.revision=e.revision WHERE q.status IN ('ready','indexed') AND f.id>? AND e.missing=0 AND e.scope_excluded=0 AND f.pipeline IN (json_extract(m.data_json,'$.version')||?,json_extract(m.data_json,'$.version')||?) ORDER BY f.id LIMIT 100""",(cursor,current_pipeline,'|metadata-only')):
                    event=pack(dict(r))
                    event.update(completion_id=r['completion_id'],asset_id=r['id'],path=r['path'],steps=json.loads(r['steps_json']),completed=True)
                    events.append(event)
                    cursor=r['completion_id']
            if after is not None and not events:cursor=c.execute('SELECT coalesce(max(id),0) FROM file_completions').fetchone()[0]
            fully_done=c.execute("SELECT count(DISTINCT f.asset_id) FROM file_completions f JOIN entries e ON e.id=f.asset_id AND e.revision=f.revision JOIN media_info m ON m.asset_id=e.id AND m.revision=e.revision JOIN media_jobs q ON q.asset_id=e.id AND q.revision=e.revision WHERE q.status IN ('ready','indexed') AND e.missing=0 AND e.scope_excluded=0 AND f.pipeline IN (json_extract(m.data_json,'$.version')||?,json_extract(m.data_json,'$.version')||?)",(current_pipeline,'|metadata-only')).fetchone()[0]
            settings=dict(c.execute("SELECT key,value FROM settings WHERE key IN ('media_paused','cache_budget')"))
            bytes_used=c.execute('SELECT coalesce(sum(size),0) FROM cache_files').fetchone()[0]
        temporary_bytes=0
        for path in (cache.root/'work').rglob('*'):
            try:
                if path.is_file():temporary_bytes+=path.stat().st_size
            except FileNotFoundError:
                pass
        return {'completion_cursor':cursor,'completion_events':events,'fully_done':fully_done,'counts':counts,'error_count':len(errors),'errors':errors[:100],'active':active,'recent':recent,'paused':settings['media_paused']=='true','cache_bytes':bytes_used+temporary_bytes,'temporary_bytes':temporary_bytes,'budget_bytes':int(settings['cache_budget'])}

    @app.get('/api/media/directories',dependencies=[Depends(owner)])
    def directories():
        with database.connect() as c:
            rows=[dict(r) for r in c.execute("""WITH latest AS (
              SELECT d.*,j.source_id,j.status job_status,s.root source_root,
                row_number() OVER(PARTITION BY j.source_id,d.path ORDER BY j.created DESC,d.id DESC) position
              FROM scan_dirs d JOIN jobs j ON j.id=d.job_id JOIN sources s ON s.id=j.source_id
            ), totals AS (
              SELECT e.source_id,e.parent,count(*) total,
                sum(q.status='ready') cached,
                sum(q.status IN ('failed','unsupported') OR (?=1 AND q.status='ready' AND EXISTS(SELECT 1 FROM analysis a JOIN media_info m ON m.asset_id=a.asset_id AND m.revision=a.revision WHERE a.asset_id=e.id AND a.revision=e.revision AND a.provider='visual' AND a.version=(SELECT value FROM settings WHERE key='analysis_version') AND json_extract(a.data_json,'$.input_media_version') IS json_extract(m.data_json,'$.version') AND json_extract(a.data_json,'$.error') IS NOT NULL)) OR (?=1 AND q.status='ready' AND EXISTS(SELECT 1 FROM analysis a WHERE a.asset_id=e.id AND a.revision=e.revision AND a.provider='photography' AND a.version=(SELECT value FROM settings WHERE key='photography_version') AND json_extract(a.data_json,'$.input_media_version') IS json_extract(m.data_json,'$.version') AND json_extract(a.data_json,'$.error') IS NOT NULL))) errors,
                sum(q.status='running' AND q.lease_until>unixepoch('now')) active,
                sum(EXISTS(SELECT 1 FROM file_completions f WHERE f.asset_id=e.id AND f.revision=e.revision AND q.status IN ('ready','indexed') AND f.pipeline IN (json_extract(m.data_json,'$.version')||?,json_extract(m.data_json,'$.version')||?))) done,
                min(CASE WHEN q.status='running' AND q.lease_until>unixepoch('now') THEN e.path END) current_file
              FROM entries e LEFT JOIN media_jobs q ON q.asset_id=e.id AND q.revision=e.revision LEFT JOIN media_info m ON m.asset_id=e.id AND m.revision=e.revision
              WHERE e.missing=0 AND e.scope_excluded=0 AND e.is_dir=0 GROUP BY e.source_id,e.parent
            ) SELECT l.source_id,l.path,l.source_root,l.state,l.lease_until,l.job_status,l.error,coalesce(t.total,0) total,
                coalesce(t.cached,0) cached,coalesce(t.errors,0) errors,coalesce(t.active,0) active,coalesce(t.done,0) done,t.current_file
              FROM latest l LEFT JOIN totals t ON t.source_id=l.source_id AND t.parent=l.path WHERE l.position=1 AND l.state!='excluded' AND NOT EXISTS(SELECT 1 FROM entries gone WHERE gone.source_id=l.source_id AND gone.path=l.path AND gone.missing=1) ORDER BY l.path DESC""",(int(os.environ.get('MUSEUM_ANALYSIS_ENABLED')=='1'),int(photography_enabled()),pipeline(c),'|metadata-only'))]
            analysis_dirs={tuple(r) for r in c.execute("SELECT e.source_id,e.parent FROM processing_progress p JOIN entries e ON e.id=p.asset_id AND e.revision=p.revision WHERE p.status='running' AND p.lane IN ('analysis','photography') AND p.updated>? AND e.missing=0 AND e.scope_excluded=0",(time.time()-60,))}
            focus_row=c.execute("SELECT value FROM settings WHERE key='media_directory'").fetchone()
            focus=json.loads(focus_row['value']) if focus_row else None
            paused=c.execute("SELECT value FROM settings WHERE key='media_paused'").fetchone()[0]=='true'
            for r in rows:
                r['current']=bool(focus and r['source_id']==focus['source_id'] and r['path']==focus['parent'])
                r['active']=bool(r['active'] or (r['state']=='leased' and (r['lease_until'] or 0)>time.time()) or (r['source_id'],r['path']) in analysis_dirs)
                r['status']='paused' if paused and r['done']<r['total'] else 'running' if r['active'] else 'paused' if r['job_status']=='paused' else 'failed' if r['errors'] or r['error'] else 'completed' if r['state']=='done' and r['done']==r['total'] else 'pending'
                r['relative_path']=r['path'][len(r['source_root']):].strip('/') or r['path'].split('/')[-1]
        return {'items':rows,'total':len(rows),'current':next((r for r in rows if r['current']),None)}

    @app.post('/api/media/control',dependencies=[Depends(owner)])
    def media_control(body:QueueControl):
        if body.action not in ('pause','resume','retry'):
            raise HTTPException(400,'无效操作')
        with database.connect() as c:
            if body.action=='retry':
                c.execute("UPDATE media_jobs SET status='pending',attempts=0,available=0,error=NULL WHERE status IN ('failed','unsupported')")
                c.execute("DELETE FROM analysis WHERE json_extract(data_json,'$.error') IS NOT NULL")
            else:
                c.execute("UPDATE settings SET value=? WHERE key='media_paused'",('true' if body.action=='pause' else 'false',))
        return {'ok':True}

    @app.post('/api/cache/budget',dependencies=[Depends(owner)])
    def budget(body:BudgetInput):
        with open(cache.root/'.lock','a+b') as lock:
            try:
                fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
            except BlockingIOError:
                raise HTTPException(409,'请先暂停媒体处理，再修改缓存预算')
            if cache.used()>body.gib*1024**3:
                raise HTTPException(409,'预算低于当前占用，请先清理可重建缓存')
            with database.connect() as c:
                c.execute("UPDATE settings SET value=? WHERE key='cache_budget'",(str(body.gib*1024**3),))
        return {'ok':True}

    def pack(row):
        result={k:row[k] for k in ('id','revision','kind')}
        result['photography_enabled']=photography_enabled()
        result.update(name=PurePosixPath(row['path']).name,thumbnail=media_url(row,'thumb'),preview=media_url(row,'display'),pinned=bool(row.get('pinned')),excluded=bool(row.get('excluded')))
        result['info']=json.loads(row['data_json']) if row.get('data_json') else {}
        result['metadata_only']=bool(result['info'].get('metadata_only'))
        if result['metadata_only'] and not result['info'].get('cached_preview'):
            result['thumbnail']=None;result['preview']=None
        result['score']=row.get('score')
        result['captured_at']=capture_value(row)
        if row.get('completed_at'):result['completed_at']=row['completed_at']
        return result

    def capture_value(row):
        value=json.loads(row['capture_json']) if row.get('capture_json') else json.loads(row.get('data_json') or '{}').get('captured_at')
        if not isinstance(value,str):return None
        try:return datetime.fromisoformat(value[:10].replace(':','-')+value[10:19].replace(' ','T')).isoformat()
        except ValueError:return None

    def rows():
        with database.connect() as c:
            result=[dict(r) for r in c.execute("""SELECT e.*,m.data_json,coalesce(u.pinned,0) pinned,coalesce(u.excluded,0) excluded,
                CASE WHEN json_extract(a.data_json,'$.error') IS NULL AND json_extract(a.data_json,'$.input_media_version') IS json_extract(m.data_json,'$.version') THEN json_extract(a.data_json,'$.score') END score,
                (SELECT md.value_json FROM metadata md WHERE md.asset_id=e.id AND md.field='captured_at' AND md.stale=0 AND (md.layer!='inferred' OR json_extract(md.info_json,'$.accepted')=1) ORDER BY CASE md.layer WHEN 'manual' THEN 0 WHEN 'observed' THEN 1 ELSE 2 END LIMIT 1) capture_json,json_extract(a.data_json,'$.signature') signature,json_extract(a.data_json,'$.tags[0].label') concept,s.root source_root FROM entries e JOIN sources s ON s.id=e.source_id
                JOIN media_info m ON m.asset_id=e.id AND m.revision=e.revision
                LEFT JOIN curation u ON u.asset_id=e.id LEFT JOIN analysis a ON a.asset_id=e.id AND a.revision=e.revision AND a.provider='visual'
                WHERE e.missing=0 AND e.scope_excluded=0 AND (EXISTS(SELECT 1 FROM derivatives d WHERE d.asset_id=e.id AND d.revision=e.revision AND d.profile='thumb' AND d.status='ready') OR json_extract(m.data_json,'$.metadata_only')=1) ORDER BY e.path""")]
            pairs={}
            for r in c.execute("""SELECT e.id,e.source_id,e.parent,e.kind,m.value_json FROM entries e JOIN metadata m ON m.asset_id=e.id AND m.source_revision=e.revision WHERE e.missing=0 AND e.scope_excluded=0 AND m.field='content_identifier' AND m.layer='observed' AND m.stale=0"""):
                group=pairs.setdefault((r['source_id'],r['parent'],r['value_json']),{'images':[],'videos':[]})
                group['videos' if r['kind']=='video_candidate' else 'images'].append(r['id'])
            hidden={g['videos'][0] for g in pairs.values() if g['images'] and len(g['videos'])==1}
            return [r for r in result if r['id'] not in hidden]

    def group_key(r):
        first=r['path'][len(r['source_root']):].strip('/').split('/')[0]
        return event_id(r['source_id'],first)

    @app.get('/api/gallery',dependencies=[Depends(owner)])
    def gallery():
        groups={}
        for r in rows():
            key=group_key(r)
            group=groups.setdefault(key,{'id':key,'event':json.loads(r['event_json']),'rows':[]})
            group['rows'].append(r)
        result=[]
        for g in groups.values():
            all_rows=g.pop('rows')
            candidates=[r for r in all_rows if not r['excluded'] and r['kind']=='image_candidate' and not json.loads(r['data_json']).get('placeholder')]
            # Strict score Top10. Pins remain user annotations, never override this ranking.
            ranked=sorted((r for r in candidates if isinstance(r['score'],(int,float))),key=lambda r:(-r['score'],r['path'],r['id']))
            selected=ranked[:10]
            g.update(latest_capture=activity_time(g['event'],[{'data_json':json.dumps({'captured_at':capture_value(r)})} for r in all_rows]),count=len(all_rows),
                     photos=sum(r['kind']=='image_candidate' for r in all_rows),videos=sum(r['kind']=='video_candidate' for r in all_rows),
                     selection_policy='score-top10',unscored=sum(r['score'] is None for r in candidates),selected=[pack(r) for r in selected])
            result.append(g)
        result.sort(key=lambda g:(g['event'].get('year') or 0,g['event'].get('month') or 0,g['latest_capture'],g['event'].get('theme') or '',g['id']),reverse=True)
        return {'activities':result}

    @app.get('/api/gallery/{gid}',dependencies=[Depends(owner)])
    def activity(gid:str,offset:int=0,limit:int=100):
        if offset<0 or not 1<=limit<=200:
            raise HTTPException(400)
        selected=[r for r in rows() if group_key(r)==gid]
        selected.sort(key=lambda r:(capture_value(r) is None,capture_value(r) or '',r['path'],r['id']))
        previews=[pack(r) for r in selected if r['kind']=='image_candidate' and not json.loads(r['data_json']).get('metadata_only')][:15] if offset==0 else []
        return {'items':[pack(r) for r in selected[offset:offset+limit]],'total':len(selected),
                'previews':[{'id':p['id'],'preview':p['preview']} for p in previews],
                'photos':sum(r['kind']=='image_candidate' for r in selected),'videos':sum(r['kind']=='video_candidate' for r in selected),'order':'capture-ascending'}

    @app.get('/api/assets/{aid}/media/{profile}',dependencies=[Depends(owner)])
    def cached(aid:str,profile:str,revision:str):
        if profile not in ('thumb','display','compatible','playback'):
            raise HTTPException(404)
        with database.connect() as c:
            r=c.execute('SELECT revision FROM entries WHERE id=? AND missing=0 AND scope_excluded=0',(aid,)).fetchone()
        if not r or r['revision']!=revision:
            raise HTTPException(409,'媒体版本已更新')
        path=cache.lookup(aid,revision,profile)
        if not path:
            # Evicted media are reconstructible. Do not retry permanent codec errors per view.
            with database.connect() as c:
                c.execute("UPDATE media_jobs SET status='pending',available=0 WHERE asset_id=? AND revision=? AND status='ready'",(aid,revision))
            raise HTTPException(404,'缓存等待生成')
        return FileResponse(path)

    @app.post('/api/assets/{aid}/curation',dependencies=[Depends(owner)])
    def curate(aid:str,body:CurateInput):
        if body.pinned and body.excluded:
            raise HTTPException(400)
        with database.connect() as c:
            if not c.execute('SELECT 1 FROM entries WHERE id=?',(aid,)).fetchone():
                raise HTTPException(404)
            c.execute('INSERT OR REPLACE INTO curation VALUES(?,?,?,?)',(aid,int(body.pinned),int(body.excluded),time.time()))
        app.state.exhibitions.invalidate()
        return {'ok':True}

    @app.post('/api/assets/{aid}/metadata',dependencies=[Depends(owner)])
    def manual(aid:str,body:MetadataInput):
        if body.field not in ('gps','location','captured_at'):
            raise HTTPException(400)
        if body.field=='gps' and body.value is not None:
            v=body.value
            if not isinstance(v,dict) or not all(isinstance(v.get(k),(int,float)) and not isinstance(v[k],bool) and -bound<=v[k]<=bound for k,bound in [('latitude',90),('longitude',180)]):
                raise HTTPException(400,'GPS 坐标无效')
        try:
            database.set_metadata(aid,body.field,body.value,'manual',info={'precision':'manual'})
        except ValueError:
            raise HTTPException(404,'照片不存在')
        app.state.exhibitions.invalidate()
        return {'ok':True}

def live_pair(database,row):
    if row['kind']!='image_candidate':return None
    with database.connect() as c:
        siblings=[dict(r) for r in c.execute("SELECT e.*,m.value_json content_id FROM entries e LEFT JOIN metadata m ON m.asset_id=e.id AND m.field='content_identifier' AND m.layer='observed' AND m.stale=0 WHERE e.source_id=? AND e.parent=? AND e.missing=0 AND e.scope_excluded=0 AND e.is_dir=0",(row['source_id'],row['parent']))]
    current=next((r for r in siblings if r['id']==row['id']),{})
    exact=[r for r in siblings if r['kind']=='video_candidate' and current.get('content_id') and r.get('content_id')==current['content_id']]
    same=[r for r in siblings if r['kind']=='video_candidate' and PurePosixPath(r['path']).stem.casefold()==PurePosixPath(row['path']).stem.casefold()]
    if len(exact)==1:
        video=exact[0]
        return {'id':video['id'],'match':'content_identifier','confirmed':True,'playback':f"/api/assets/{video['id']}/original?revision={video['revision']}" if video['size'] is not None and video['size']<=256*1024**2 else None}
    if len(same)==1:
        return {'id':same[0]['id'],'match':'same_name_candidate','confirmed':False,'playback':None}
    return None
