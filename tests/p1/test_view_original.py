import pytest
from photo_museum.media_worker import MediaWorker
from .test_service import system, scan
from .test_media import jpeg
from .fixture import ROOT, EVENT


def test_on_demand_compatible_original_fetches_nas_and_cleans(system,monkeypatch):
    import photo_museum.view_original as module
    app,client,remote,sid=system
    remote.entries={ROOT:None,EVENT:None,EVENT+'/one.jpg':jpeg()}
    scan(app,client,sid);MediaWorker(app.state.db).tick()
    row=client.get('/api/assets').json()['items'][0]
    url=f"/api/assets/{row['id']}/original-compatible?revision={row['revision']}"
    calls=len([r for r in remote.calls if r[0]=='GET'])
    def conversion(source,outputs,meta,**kwargs):
        (outputs/'compatible.jpg').write_bytes(source.read_bytes())
    monkeypatch.setattr(module,'still',conversion)
    response=client.get(url)
    assert response.status_code==200 and response.content==remote.entries[EVENT+'/one.jpg']
    assert 'no-store' in response.headers['cache-control']
    assert len([r for r in remote.calls if r[0]=='GET'])==calls+1
    assert list((app.state.db.directory/'view-work').iterdir())==[]
    with app.state.db.connect() as c:assert not c.execute("SELECT 1 FROM cache_files WHERE profile='compatible'").fetchone()
    def fail(*a,**kwargs):raise module.MediaUnsupported('test')
    monkeypatch.setattr(module,'still',fail)
    assert client.get(url).status_code==415
    assert list((app.state.db.directory/'view-work').iterdir())==[]
    assert client.get(url.replace(row['revision'],'old')).status_code==409
    client.post('/api/logout',json={});assert client.get(url).status_code==401


def test_converted_response_cleans_if_client_disconnects_before_body(system,monkeypatch):
    import asyncio
    from starlette.requests import ClientDisconnect
    import photo_museum.view_original as module
    from photo_museum.webdav import Entry
    app,client,remote,sid=system
    entry=Entry(EVENT+'/one.heic',False,100,None,'"fixture"')
    class Remote:
        def list(self,*args,**kwargs):return [entry]
        def close(self):pass
    def transfer(remote,entry,spool,**kwargs):
        spool.mkdir();path=spool/'source';path.write_bytes(b'fixture');return {'path':path}
    monkeypatch.setattr(module,'download',transfer)
    monkeypatch.setattr(module,'metadata',lambda path:{})
    monkeypatch.setattr(module,'still',lambda source,outputs,meta,**kwargs:(outputs/'compatible.jpg').write_bytes(b'jpeg'))
    response=module.converted_original(app.state.db,{'size':100,'path':entry.path,'revision':entry.revision},Remote())
    async def disconnect(*args):raise OSError('disconnected')
    with pytest.raises(ClientDisconnect):asyncio.run(response({'type':'http','asgi':{'spec_version':'2.4'}},disconnect,disconnect))
    assert list((app.state.db.directory/'view-work').iterdir())==[]
    assert module._slots.acquire(blocking=False)
    module._slots.release()
