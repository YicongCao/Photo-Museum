from .test_service import system,scan
from .test_media import jpeg
from .fixture import ROOT,EVENT
from photo_museum.media_worker import MediaWorker
from photo_museum.cache import Cache


def prepare(system):
    app,client,remote,sid=system
    remote.entries={ROOT:None,EVENT:None,EVENT+'/one.jpg':jpeg()}
    scan(app,client,sid)
    assert MediaWorker(app.state.db).tick()
    group=client.get('/api/gallery').json()['activities'][0]
    return client.get('/api/gallery/'+group['id']).json()['items'][0]


def test_conditional_preview_still_checks_auth_scope_and_revision(system):
    app,client,remote,sid=system
    photo=prepare(system)
    for variant in ('thumbnail','preview'):
        url=photo[variant];first=client.get(url)
        assert first.status_code==200
        assert first.headers['cache-control']=='private, no-cache, must-revalidate'
        assert first.headers['vary']=='Cookie'
        etag=first.headers['etag'];conditional={'If-None-Match':etag}
        again=client.get(url,headers=conditional)
        assert again.status_code==304 and again.content==b''
        assert client.get(url,headers={'If-None-Match':'W/'+etag}).status_code==304
        assert client.get(url.replace(photo['revision'],'stale'),headers=conditional).status_code==409
        client.post('/api/assets/'+photo['id']+'/curation',json={'excluded':True})
        hidden=client.get(url,headers=conditional)
        assert hidden.status_code==409 and hidden.headers['cache-control']=='no-store'
        client.post('/api/assets/'+photo['id']+'/curation',json={'excluded':False})
    assert client.get('/api/gallery').headers['cache-control']=='no-store'
    client.post('/api/logout',json={})
    denied=client.get(photo['thumbnail'],headers=conditional)
    assert denied.status_code==401 and denied.headers['cache-control']=='no-store'


def test_rebuilt_and_evicted_cache_cannot_reuse_old_validator(system):
    app,client,remote,sid=system;photo=prepare(system);url=photo['thumbnail']
    first=client.get(url);headers={'If-None-Match':first.headers['etag']}
    path=Cache(app.state.db).lookup(photo['id'],photo['revision'],'thumb')
    path.write_bytes(path.read_bytes()+b'changed')
    changed=client.get(url,headers=headers)
    assert changed.status_code==200 and changed.headers['etag']!=first.headers['etag']
    path.unlink();missing=client.get(url,headers=headers)
    assert missing.status_code==404 and missing.headers['cache-control']=='no-store'


def test_cache_hits_do_not_write_access_time_on_every_request(system):
    app,client,remote,sid=system;photo=prepare(system)
    def accessed():
        with app.state.db.connect() as c:return c.execute("SELECT accessed FROM cache_files WHERE asset_id=? AND profile='thumb'",(photo['id'],)).fetchone()[0]
    before=accessed()
    for _ in range(4):assert client.get(photo['thumbnail']).status_code==200
    assert accessed()==before
