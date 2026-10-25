"""P1 local service. Run with uvicorn photo_museum.api:create_app --factory --host 127.0.0.1 --port 8790."""
import json
import os
from pathlib import Path
import re
import time
import uuid
import httpx
import anyio
from fastapi import FastAPI, HTTPException, Request, Response, Depends
from fastapi.responses import FileResponse, StreamingResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, Field
from .auth import Security
from .db import Database
from .cache import Cache
from .gallery import register as register_gallery, live_pair, media_url
from .webdav import WebDAV, DAVError, normalize, within, strong
from tools.inventory import excluded_directory, parse_event

ROOT = Path(__file__).resolve().parents[1]

class Password(BaseModel):
    password: str = Field(min_length=1, max_length=256)

class SourceInput(BaseModel):
    name: str = Field(default='Farmer', min_length=1, max_length=80)
    url: str = Field(max_length=2048)
    root: str = Field(max_length=4096)
    username: str = Field(min_length=1, max_length=256)
    password: str = Field(min_length=1, max_length=1024)
    ca_pem: str | None = Field(default=None, max_length=16000)
    allow_http: bool = False

class Credentials(BaseModel):
    password: str = Field(min_length=1, max_length=1024)
    ca_pem: str | None = Field(default=None, max_length=16000)

class ScanInput(BaseModel):
    source_id: str
    root: str


def create_app(directory=None, dav_factory=WebDAV):
    app = FastAPI(title='Photo Museum', docs_url=None, redoc_url=None, openapi_url=None)
    db = Database(directory or os.environ.get('MUSEUM_DATA', ROOT / 'data/server'))
    security = Security(db)
    app.state.db, app.state.security = db, security
    allowed = set(os.environ.get('MUSEUM_HOSTS', '127.0.0.1:8790,localhost:8790,testserver').split(','))

    @app.middleware('http')
    async def boundary(request, call_next):
        host = request.headers.get('host', '')
        if host not in allowed:
            return JSONResponse({'detail': 'Host refused'}, 403)
        if request.method in ('POST', 'PUT', 'PATCH', 'DELETE'):
            origin = request.headers.get('origin')
            expected = str(request.base_url).rstrip('/')
            if origin != expected:
                return JSONResponse({'detail': 'Same-origin request required'}, 403)
            length = request.headers.get('content-length')
            limit = 262144 if request.method == 'PUT' and re.fullmatch(
                r'/api/(?:curator/exhibitions/[^/]+/)?exhibitions/creative/scroll', request.url.path
            ) else 32768
            if not length or not length.isdigit() or int(length) > limit:
                return JSONResponse({'detail': 'Request body too large or length missing'}, 413)
        result = await call_next(request)
        result.headers['Cache-Control'] = 'no-store'
        result.headers['X-Content-Type-Options'] = 'nosniff'
        result.headers['Referrer-Policy'] = 'no-referrer'
        result.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; media-src 'self' blob:; img-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
        return result

    @app.exception_handler(DAVError)
    async def dav_error(request, error):
        return JSONResponse({'detail': error.code, 'retryable': error.retryable}, 502)

    @app.exception_handler(ValueError)
    async def value_error(request, error):
        return JSONResponse({'detail': str(error)}, 400)

    @app.exception_handler(RequestValidationError)
    async def invalid_input(request, error):
        # FastAPI's default 422 body includes submitted values, potentially passwords.
        return JSONResponse({'detail': '输入格式不正确，请检查必填项与长度'}, 422)

    @app.exception_handler(httpx.HTTPError)
    async def upstream_error(request, error):
        return JSONResponse({'detail': 'network_unavailable'}, 502)

    def owner(request: Request):
        if not security.authenticated(request.cookies.get('museum_session')):
            raise HTTPException(401, '请先登录')

    def source(sid):
        with db.connect() as conn:
            row = conn.execute('SELECT * FROM sources WHERE id=?', (sid,)).fetchone()
        if not row:
            raise HTTPException(404, '照片源不存在')
        return dict(row)

    def dav_for(sid):
        row = source(sid)
        return dav_factory(row, security.decrypt(row['secret']))

    def cookie(response, token, request):
        response.set_cookie('museum_session', token, httponly=True, samesite='strict', secure=request.url.scheme == 'https', max_age=43200, path='/')

    @app.get('/api/bootstrap')
    def bootstrap():
        return {'initialized': security.initialized()}

    @app.post('/api/setup')
    def setup(body: Password, request: Request, response: Response):
        if request.client.host not in ('127.0.0.1', '::1', 'testclient') and os.environ.get('MUSEUM_CONTAINER_SETUP') != '1':
            raise HTTPException(403, '首次设置只允许本机访问')
        security.setup(body.password)
        cookie(response, security.login(body.password, request.client.host), request)
        return {'ok': True}

    @app.post('/api/login')
    def login(body: Password, request: Request, response: Response):
        try:
            token = security.login(body.password, request.client.host)
        except ValueError as exc:
            raise HTTPException(401, str(exc))
        cookie(response, token, request)
        return {'ok': True}

    @app.post('/api/logout', dependencies=[Depends(owner)])
    def logout(request: Request, response: Response):
        with db.connect() as conn:
            conn.execute('DELETE FROM sessions WHERE token_hash=?', (security.digest(request.cookies['museum_session']),))
        response.delete_cookie('museum_session')
        return {'ok': True}

    @app.get('/api/state', dependencies=[Depends(owner)])
    def state():
        with db.connect() as conn:
            sources = [dict(r) for r in conn.execute('SELECT id,name,url,root,allow_http FROM sources ORDER BY created')]
            jobs = [dict(r) for r in conn.execute('''SELECT j.*, (SELECT count(*) FROM scan_dirs WHERE job_id=j.id AND state!='excluded') AS total_dirs,
                (SELECT count(*) FROM scan_dirs WHERE job_id=j.id AND state='done') AS done_dirs,
                (SELECT count(*) FROM scan_dirs WHERE job_id=j.id AND state='leased') AS active_dirs FROM jobs j ORDER BY created DESC LIMIT 30''')]
            for job in jobs:
                cover=conn.execute("SELECT e.id,e.revision FROM entries e JOIN derivatives d ON d.asset_id=e.id AND d.revision=e.revision AND d.profile='thumb' AND d.status='ready' WHERE e.source_id=? AND e.missing=0 AND e.scope_excluded=0 AND (e.parent=? OR substr(e.path,1,?)=?) ORDER BY e.path LIMIT 1",(job['source_id'],job['root'],len(job['root'])+1,job['root']+'/')).fetchone()
                job['cover']=f"/api/assets/{cover['id']}/media/thumb?revision={cover['revision']}" if cover else None
            count = conn.execute('SELECT count(*) FROM entries WHERE is_dir=0 AND missing=0 AND scope_excluded=0').fetchone()[0]
            heartbeat = conn.execute('SELECT max(heartbeat) FROM workers').fetchone()[0]
        return {'sources': sources, 'jobs': jobs, 'asset_count': count, 'worker_online': bool(heartbeat and heartbeat > time.time() - 15)}

    @app.post('/api/sources', dependencies=[Depends(owner)])
    def add_source(body: SourceInput):
        values = body.model_dump()
        values['root'] = normalize(body.root)
        # Validate before storing; connection testing remains a separate explicit action.
        client = dav_factory(values, body.password)
        client.close()
        sid = uuid.uuid4().hex
        with db.connect() as conn:
            if conn.execute('SELECT 1 FROM sources WHERE url=? AND root=?', (body.url.rstrip('/'), values['root'])).fetchone():
                raise HTTPException(409, '该源已存在；请使用更新凭据')
            conn.execute('INSERT INTO sources VALUES(?,?,?,?,?,?,?,?,?)', (sid, body.name, body.url.rstrip('/'), values['root'], body.username,
                         security.encrypt(body.password), body.ca_pem, int(body.allow_http), time.time()))
        return {'id': sid}

    @app.put('/api/sources/{sid}/credentials', dependencies=[Depends(owner)])
    def credentials(sid: str, body: Credentials):
        values = source(sid) | {'ca_pem': body.ca_pem}
        client = dav_factory(values, body.password)
        client.close()
        with db.connect() as conn:
            conn.execute('UPDATE sources SET secret=?,ca_pem=? WHERE id=?', (security.encrypt(body.password), body.ca_pem, sid))
        return {'ok': True}

    @app.get('/api/sources/{sid}/browse', dependencies=[Depends(owner)])
    def browse(sid: str):
        client = dav_for(sid)
        try:
            entries = client.list(client.root)
            return {'directories': [{'path': e.path, 'name': e.path.rsplit('/', 1)[-1]} for e in entries if e.is_dir and (not excluded_directory(e.path.rsplit('/', 1)[-1]) or parse_event(e.path.rsplit('/', 1)[-1])['precision'] != 'unknown')],
                    'files': sum(not e.is_dir for e in entries)}
        finally:
            client.close()

    @app.post('/api/jobs', dependencies=[Depends(owner)])
    def scan(body: ScanInput):
        s = source(body.source_id)
        root = normalize(body.root)
        if not within(root, s['root']):
            raise HTTPException(400, '扫描范围超出照片根目录')
        if '/' in root[len(s['root'].rstrip('/')):].strip('/'):
            raise HTTPException(400,'只扫描一级主题目录，不进入二级目录')
        for index, segment in enumerate(root[len(s['root']):].strip('/').split('/')):
            if excluded_directory(segment) and not (index == 0 and parse_event(segment)['precision'] != 'unknown'):
                raise HTTPException(400, '原片或系统目录不纳入照片库')
        return {'id': db.new_job(body.source_id, root)}

    @app.post('/api/jobs/{jid}/{action}', dependencies=[Depends(owner)])
    def control(jid: str, action: str):
        if action not in ('pause', 'resume', 'cancel'):
            raise HTTPException(404)
        with db.connect() as conn:
            conn.execute('BEGIN IMMEDIATE')
            job = conn.execute('SELECT * FROM jobs WHERE id=?', (jid,)).fetchone()
            if not job:
                raise HTTPException(404)
            if job['status'] in ('completed', 'cancelled'):
                raise HTTPException(409, '任务已结束')
            status = {'pause': 'paused', 'resume': 'queued', 'cancel': 'cancelled'}[action]
            conn.execute('UPDATE jobs SET status=?,updated=? WHERE id=?', (status, time.time(), jid))
            if action == 'resume':
                conn.execute("UPDATE scan_dirs SET available=0,attempts=0 WHERE job_id=? AND state='pending'", (jid,))
        return {'status': status}

    @app.get('/api/assets', dependencies=[Depends(owner)])
    def assets(offset: int = 0, limit: int = 50):
        if offset < 0 or not 1 <= limit <= 100:
            raise HTTPException(400)
        with db.connect() as conn:
            rows = conn.execute('SELECT id,path,kind,size,revision,version_quality,event_json FROM entries WHERE is_dir=0 AND missing=0 AND scope_excluded=0 ORDER BY path LIMIT ? OFFSET ?', (limit, offset)).fetchall()
        return {'items': [dict(r) | {'event': json.loads(r['event_json'])} for r in rows]}

    def asset(aid):
        with db.connect() as conn:
            row = conn.execute('SELECT * FROM entries WHERE id=? AND is_dir=0 AND missing=0 AND scope_excluded=0', (aid,)).fetchone()
        if not row:
            raise HTTPException(404, '照片不存在或不在当前刮削范围')
        return dict(row)

    @app.get('/api/assets/{aid}/manifest', dependencies=[Depends(owner)])
    def manifest(aid: str):
        row = asset(aid)
        with db.connect() as c:
            media = c.execute('SELECT data_json FROM media_info WHERE asset_id=? AND revision=?',(aid,row['revision'])).fetchone()
        media_info = json.loads(media[0]) if media else {}
        preview_row = row | {'data_json':media[0] if media else '{}'}
        return {'id': aid, 'revision': row['revision'], 'version_quality': row['version_quality'],
                'size': row['size'],
                'placeholder': media_info.get('placeholder'),
                'media': media_info,
                'original': None if media_info.get('placeholder') else f"/api/assets/{aid}/original?revision={row['revision']}",
                'original_compatible': None if media_info.get('placeholder') else f"/api/assets/{aid}/original-compatible?revision={row['revision']}" if media_info.get('hdr_source') or Cache(db).lookup(aid,row['revision'],'compatible') or Path(row['path']).suffix.lower() in ('.heic','.heif','.hif','.avif') else None,
                'live': live_pair(db,row),
                'preview': media_url(preview_row,'display') if Cache(db).lookup(aid,row['revision'],'display') else None,
                'thumbnail': media_url(preview_row,'thumb') if Cache(db).lookup(aid,row['revision'],'thumb') else None,
                'compatible': f"/api/assets/{aid}/media/compatible?revision={row['revision']}" if Cache(db).lookup(aid,row['revision'],'compatible') else None,
                'playback': f"/api/assets/{aid}/original?revision={row['revision']}" if row['kind']=='video_candidate' and not media_info.get('placeholder') else None,
                'derivatives_status': 'ready' if Cache(db).lookup(aid,row['revision'],'display') else 'pending',
                'effective_metadata': db.effective(aid)}

    @app.get('/api/assets/{aid}/suggestions', dependencies=[Depends(owner)])
    def suggestions(aid: str):
        asset(aid)
        with db.connect() as c:
            rows=c.execute("SELECT field,value_json,info_json,record_id FROM metadata WHERE asset_id=? AND layer='inferred' AND stale=0",(aid,)).fetchall()
        return {'items':[{'field':r['field'],'value':json.loads(r['value_json']),'info':json.loads(r['info_json']),'record_id':r['record_id']} for r in rows]}

    @app.post('/api/assets/{aid}/suggestions/{record_id}/{action}', dependencies=[Depends(owner)])
    def review_suggestion(aid:str,record_id:str,action:str):
        if action not in ('accept','reject'):raise HTTPException(400)
        with db.connect() as c:
            r=c.execute("SELECT * FROM metadata WHERE asset_id=? AND record_id=? AND layer='inferred' AND stale=0",(aid,record_id)).fetchone()
            if not r:raise HTTPException(409,'推断已经更新')
            info=json.loads(r['info_json']);info.update(accepted=action=='accept',reviewed=action)
            c.execute("UPDATE metadata SET info_json=? WHERE asset_id=? AND record_id=?",(json.dumps(info),aid,record_id))
        app.state.exhibitions.invalidate()
        return {'ok':True}

    def reject_placeholder(row):
        with db.connect() as c:
            info=c.execute('SELECT data_json FROM media_info WHERE asset_id=? AND revision=?',(row['id'],row['revision'])).fetchone()
        if info and json.loads(info[0]).get('placeholder'):
            raise HTTPException(413,'超大文件仅索引')

    @app.get('/api/assets/{aid}/original-compatible', dependencies=[Depends(owner)])
    def original_compatible(aid: str, revision: str):
        from .view_original import converted_original
        row = asset(aid)
        if row['revision'] != revision:
            raise HTTPException(409, '源版本已变更')
        reject_placeholder(row)
        return converted_original(db, row, dav_for(row['source_id']))

    @app.get('/api/assets/{aid}/original', dependencies=[Depends(owner)])
    def original(aid: str, revision: str, request: Request):
        row = asset(aid)
        if revision != row['revision']:
            raise HTTPException(409, '源版本已变更，请刷新索引')
        if row['size'] is None or row['size'] > 256 * 1024 * 1024:
            raise HTTPException(413, 'P1 单次原文件读取上限 256 MiB')
        reject_placeholder(row)
        range_value = request.headers.get('range')
        if range_value and not re.fullmatch(r'bytes=(\d+-\d*|-\d+)', range_value):
            raise HTTPException(416, '仅支持一个字节范围')
        client = dav_for(row['source_id'])
        try:
            # Preflight also catches weak/missing ETag changes by size/mtime; cannot prove same-size same-time mutations.
            current = client.list(row['path'], depth=0)
            if len(current) != 1 or current[0].revision != revision:
                raise HTTPException(409, 'NAS 文件版本变化，请重新扫描')
            headers = {'Accept-Encoding': 'identity'}
            if strong(row['etag']):
                headers['If-Match'] = row['etag']
            if range_value:
                headers['Range'] = range_value
                if request.headers.get('if-range'):
                    headers['If-Range'] = request.headers['if-range']
            upstream = client.client.send(client.client.build_request('GET', client.url(row['path']), headers=headers), stream=True)
            if upstream.status_code in (412, 416):
                status = upstream.status_code
                upstream.close()
                client.close()
                raise HTTPException(409 if status == 412 else 416, '源版本变化或范围不可用')
            client.check(upstream.status_code)
            if upstream.status_code not in (200, 206):
                raise DAVError('unexpected_media_response')
            if strong(row['etag']) and upstream.headers.get('etag') != row['etag']:
                raise HTTPException(409, '原文件校验标记不匹配')
            if int(upstream.headers.get('content-length', row['size'])) > 256 * 1024 * 1024:
                raise HTTPException(413)
            out = {k: upstream.headers[k] for k in ('content-length', 'content-range', 'etag', 'accept-ranges', 'last-modified') if k in upstream.headers}
            out['X-Content-Version'] = revision
            out['Content-Disposition'] = 'inline'
            content_type = upstream.headers.get('content-type', 'application/octet-stream').split(';')[0]
            if not (content_type.startswith('image/') or content_type.startswith('video/')) or content_type == 'image/svg+xml':
                content_type = 'application/octet-stream'
            async def chunks():
                total, started = 0, time.monotonic()
                iterator = upstream.iter_raw(128 * 1024)
                def next_chunk():
                    return next(iterator, None)
                try:
                    while True:
                        chunk = await anyio.to_thread.run_sync(next_chunk)
                        if chunk is None:
                            break
                        total += len(chunk)
                        if total > 256 * 1024 * 1024 or time.monotonic() - started > 120:
                            raise RuntimeError('Bounded media stream limit exceeded')
                        yield chunk
                finally:
                    upstream.close()
                    client.close()
            return StreamingResponse(chunks(), status_code=upstream.status_code, headers=out, media_type=content_type)
        except BaseException:
            if 'upstream' in locals():
                upstream.close()
            client.close()
            raise

    register_gallery(app, db, owner)
    from .exhibitions import register as register_exhibitions
    register_exhibitions(app, db, owner)
    from .curator import register as register_curator
    register_curator(app, db, security, owner)
    from .settings_api import register as register_settings
    register_settings(app, db, security, owner, dav_factory)
    from .inspection import register as register_inspection
    register_inspection(app, db, owner)
    from .intelligence_api import register as register_intelligence
    register_intelligence(app, db, owner)

    build = Path(os.environ.get('MUSEUM_WEB_DIST', ROOT / 'web/dist')).resolve()
    if (build / 'assets').exists():
        app.mount('/assets', StaticFiles(directory=build / 'assets'), name='static')

    if (build / 'brand').exists():
        app.mount('/brand', StaticFiles(directory=build / 'brand'), name='brand')

    @app.get('/')
    def home():
        if not (build / 'index.html').exists():
            raise HTTPException(503, '先运行 npm run build --prefix web')
        return FileResponse(build / 'index.html')

    return app
