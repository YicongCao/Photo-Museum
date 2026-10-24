import json
from photo_museum.media_worker import MediaWorker
from .test_service import system, scan
from .test_media import jpeg
from .fixture import ROOT, EVENT


def test_inspection_reuses_complete_spool_then_converted_cache(system, monkeypatch):
    import photo_museum.media_worker as module
    app, client, remote, sid = system
    payload = jpeg()
    remote.entries = {ROOT:None, EVENT:None, EVENT+'/one.jpg':payload}
    scan(app,client,sid)
    with app.state.db.connect() as c:
        row = dict(c.execute('SELECT * FROM entries WHERE is_dir=0').fetchone())
    url = f"/api/assets/{row['id']}/inspection?revision={row['revision']}"
    image_url = f"/api/assets/{row['id']}/inspection-image?revision={row['revision']}"
    assert client.get(url).json()['image'] is None
    assert client.get(image_url).status_code == 404
    extract = module.metadata
    def during_extraction(path):
        calls = len(remote.calls)
        info = client.get(url).json()
        assert info['image_label'] == '临时原图'
        response = client.get(info['image'])
        assert response.status_code == 200 and response.content == payload
        assert 'no-store' in response.headers['cache-control']
        assert len(remote.calls) == calls  # inspection cannot access NAS
        # Worker may advance while a browser request is in flight; marker fences it.
        marker = path.parent.parent/'task'
        identity = marker.read_text(); marker.write_text('different:revision')
        assert client.get(image_url).status_code == 404
        marker.write_text(identity)
        return extract(path)
    monkeypatch.setattr(module,'metadata',during_extraction)
    assert MediaWorker(app.state.db).tick()
    info=client.get(url).json()
    assert info['image_label'] == '4K SDR 兼容预览'
    assert info['metadata']['width']['value']==240
    assert client.get(info['image']).headers['content-type']=='image/webp'
    assert not (app.state.db.directory/'cache/work').exists()
    assert client.get(url.replace(row['revision'],'old')).status_code==409
    with app.state.db.connect() as c:c.execute('UPDATE entries SET scope_excluded=1 WHERE id=?',(row['id'],))
    assert client.get(url).status_code==404
    client.post('/api/logout',json={})
    assert client.get(image_url).status_code==401


def test_analysis_failure_counts_as_attention_not_pending(system,monkeypatch):
    from photo_museum.media import VERSION
    app,client,remote,sid=system
    remote.entries={ROOT:None,EVENT:None,EVENT+'/one.jpg':jpeg()}
    scan(app,client,sid);monkeypatch.setenv('MUSEUM_ANALYSIS_ENABLED','1')
    assert MediaWorker(app.state.db).tick()
    with app.state.db.connect() as c:
        row=c.execute('SELECT id,revision FROM entries WHERE is_dir=0').fetchone()
        c.execute("INSERT OR REPLACE INTO settings VALUES('analysis_version','failed-test')")
        c.execute('INSERT INTO analysis VALUES(?,?,?,?,?,0)',(row['id'],row['revision'],'visual','failed-test',json.dumps({'error':'ModelFailure','input_media_version':VERSION})))
    state=client.get('/api/media/state').json()
    assert state['error_count']==1 and state['fully_done']==0
    assert state['errors'][0]['stage']=='analysis'
    dirs=client.get('/api/media/directories').json()['items']
    assert next(d for d in dirs if d['path']==EVENT)['status']=='failed'
