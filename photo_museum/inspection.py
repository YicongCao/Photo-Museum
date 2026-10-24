"""Read-only view of the current pipeline's local files; never fetch from NAS."""
import hashlib
import json
from pathlib import PurePosixPath
from fastapi import Depends, HTTPException
from fastapi.responses import StreamingResponse, JSONResponse
from starlette.background import BackgroundTask
from .cache import Cache


def register(app, database, owner):
    cache = Cache(database)

    def snapshot(aid, revision):
        with database.connect() as c:
            row = c.execute('SELECT * FROM entries WHERE id=? AND is_dir=0 AND missing=0 AND scope_excluded=0', (aid,)).fetchone()
            if not row:
                raise HTTPException(404, '文件不在当前范围')
            if row['revision'] != revision:
                raise HTTPException(409, '源版本已更新')
            steps = {}
            for p in c.execute('SELECT steps_json FROM processing_progress WHERE asset_id=? AND revision=?', (aid, revision)):
                steps.update(json.loads(p[0]))
            info = c.execute('SELECT data_json FROM media_info WHERE asset_id=? AND revision=?', (aid, revision)).fetchone()
            analysis = {r['provider']: {'version':r['version'], 'data':json.loads(r['data_json'])} for r in c.execute('SELECT provider,version,data_json FROM analysis WHERE asset_id=? AND revision=?', (aid, revision))}
            version = c.execute("SELECT value FROM settings WHERE key='analysis_version'").fetchone()
            job = c.execute('SELECT status,error FROM media_jobs WHERE asset_id=? AND revision=?',(aid,revision)).fetchone()
            faces = c.execute('SELECT count(*) FROM faces WHERE asset_id=? AND revision=?', (aid, revision)).fetchone()[0]
            derivatives = [dict(r) for r in c.execute('SELECT profile,size FROM cache_files WHERE asset_id=? AND revision=?', (aid, revision))]
        metadata = database.effective(aid)
        gps = metadata.get('gps')
        place = analysis.get('places', {}).get('data')
        if place and (not gps or place.get('input_record') != gps['record_id']):
            place = None
        visual_row = analysis.get('visual', {})
        visual = visual_row.get('data', {})
        media = json.loads(info[0]) if info else {}
        if (version and visual_row.get('version') != version[0]) or visual.get('input_media_version') != media.get('version'):
            visual = {}
        return dict(row), {'steps': steps, 'metadata': metadata, 'media': json.loads(info[0]) if info else {},
                          'derivatives': derivatives, 'tags': visual.get('tags', []), 'score': visual.get('score'),
                          'faces': faces if visual and not visual.get('error') else None,
                          'place': place, 'analysis_error': visual.get('error'), 'status':job['status'] if job else 'pending', 'error':job['error'] if job else None}

    def candidate(row, details):
        aid, rev = row['id'], row['revision']
        work = cache.root / 'work'
        identity = aid + ':' + rev
        try:
            if (work / 'task').read_text() == identity:
                ext = PurePosixPath(row['path']).suffix.lower()
                native = {'.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp'}
                key = hashlib.sha256((row['path'] + '\0' + rev).encode()).hexdigest()
                original = work / 'spool' / (key + '.bin')
                # Complete local spool only; no .part, no video, bounded browser decode input.
                if ext in native and details['steps'].get('download') == 'done' and (row['size'] or 0) <= 64 * 1024**2 and original.is_file() and original.stat().st_size == row['size']:
                    return original, native[ext], '临时原图', work / 'task', identity
                display = work / 'outputs' / 'display.webp'
                if details['steps'].get('display') == 'done' and display.is_file():
                    return display, 'image/webp', '4K SDR 兼容预览', work / 'task', identity
        except OSError:
            pass  # Worker has advanced and removed its temporary spool.
        display = cache.lookup(aid, rev, 'display')
        if display:
            return display, 'image/webp', '4K SDR 兼容预览', None, None
        return None

    @app.get('/api/assets/{aid}/inspection', dependencies=[Depends(owner)])
    def inspection(aid: str, revision: str):
        row, details = snapshot(aid, revision)
        image = candidate(row, details)
        return JSONResponse({'id': aid, 'revision': revision, 'name': PurePosixPath(row['path']).name,
                'size': row['size'], 'kind': row['kind'], **details,
                'image': f'/api/assets/{aid}/inspection-image?revision={revision}&view={"original" if image and image[2]=="临时原图" else "display"}' if image else None,
                'image_label': image[2] if image else None}, headers={'Cache-Control':'private, no-store'})

    @app.get('/api/assets/{aid}/inspection-image', dependencies=[Depends(owner)])
    def inspection_image(aid: str, revision: str, view: str | None = None):
        row, details = snapshot(aid, revision)
        choice = candidate(row, details)
        if choice and view and view != ('original' if choice[2]=='临时原图' else 'display'):
            choice = None
        if not choice:
            raise HTTPException(404, '本地预览尚未就绪', headers={'Cache-Control': 'no-store'})
        path, mime, _, marker, identity = choice
        handle = None
        try:
            handle = path.open('rb')
            if marker and marker.read_text() != identity:
                raise OSError('Worker advanced')
        except OSError:
            if handle: handle.close()
            raise HTTPException(404, '临时文件已释放', headers={'Cache-Control': 'no-store'}) from None
        def chunks():
            try:
                while chunk := handle.read(64 * 1024):
                    yield chunk
            finally:
                handle.close()
        return StreamingResponse(chunks(), media_type=mime, headers={'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff'}, background=BackgroundTask(handle.close))
