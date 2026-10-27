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
    url=f"/api/assets/{row['id']}/original-compatible?revision={row['revision']}&progress_id={'a'*32}"
    progress_url=url.replace('original-compatible','original-progress')
    assert client.get(progress_url).json()['stage']=='waiting'
    calls=len([r for r in remote.calls if r[0]=='GET'])
    def conversion(source,outputs,cancelled):
        progress=client.get(progress_url).json()
        assert progress['stage']=='convert' and progress['done']==progress['total']>0
        (outputs/'compatible.jpg').write_bytes(source.read_bytes())
    monkeypatch.setattr(module,'convert_in_process',conversion)
    response=client.get(url)
    assert response.status_code==200 and response.content==remote.entries[EVENT+'/one.jpg']
    assert 'no-store' in response.headers['cache-control']
    assert int(response.headers['content-length'])==len(response.content)
    assert client.get(progress_url).json()['stage']=='delivery'
    assert client.get(progress_url.replace('a'*32,'b'*32)).json()['stage']=='waiting'
    assert client.get(progress_url.replace('a'*32,'invalid')).status_code==422
    assert len([r for r in remote.calls if r[0]=='GET'])==calls+1
    assert list((app.state.db.directory/'view-work').iterdir())==[]
    with app.state.db.connect() as c:assert not c.execute("SELECT 1 FROM cache_files WHERE profile='compatible'").fetchone()
    def fail(*a,**kwargs):raise module.MediaUnsupported('test')
    monkeypatch.setattr(module,'convert_in_process',fail)
    assert client.get(url).status_code==415
    assert client.get(progress_url).json()['stage']=='failed'
    assert list((app.state.db.directory/'view-work').iterdir())==[]
    assert client.get(url.replace(row['revision'],'old')).status_code==409
    client.post('/api/logout',json={});assert client.get(url).status_code==401
    assert client.get(progress_url).status_code==401


def test_progress_registry_bounded_and_expired(monkeypatch):
    import photo_museum.view_progress as module
    progress=module.ViewProgress()
    for i in range(70):progress.report(i,'download',i,100)
    assert len(progress.items)==64 and progress.read(0) is None
    assert progress.read(69)=={'stage':'download','done':69,'total':100}
    now=module.time.monotonic()
    monkeypatch.setattr(module.time,'monotonic',lambda:now+601)
    assert progress.read(69) is None


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
    monkeypatch.setattr(module,'convert_in_process',lambda source,outputs,cancelled:(outputs/'compatible.jpg').write_bytes(b'jpeg'))
    response=module.converted_original(app.state.db,{'size':100,'path':entry.path,'revision':entry.revision},Remote())
    async def disconnect(*args):raise OSError('disconnected')
    with pytest.raises(ClientDisconnect):asyncio.run(response({'type':'http','asgi':{'spec_version':'2.4'}},disconnect,disconnect))
    assert list((app.state.db.directory/'view-work').iterdir())==[]
    assert module._slots.acquire(blocking=False)
    module._slots.release()


def test_cancelled_download_releases_slot_and_next_request_waits(system,monkeypatch):
    import threading,time
    import photo_museum.view_original as module
    from photo_museum.download import TransferCancelled
    from photo_museum.webdav import Entry
    app,_,_,_=system
    entry=Entry(EVENT+'/one.heic',False,100,None,'"fixture"')
    class Remote:
        def list(self,*args,**kwargs):return [entry]
        def close(self):pass
    started=threading.Event();cancel=threading.Event();calls=[]
    def transfer(remote,entry,spool,**kwargs):
        calls.append(1)
        if len(calls)==1:
            started.set()
            while not kwargs['cancelled']():time.sleep(.01)
            raise TransferCancelled()
        spool.mkdir();path=spool/'source';path.write_bytes(b'fixture');return {'path':path}
    monkeypatch.setattr(module,'download',transfer)
    monkeypatch.setattr(module,'convert_in_process',lambda source,outputs,cancelled:(outputs/'compatible.jpg').write_bytes(b'jpeg'))
    row={'size':100,'path':entry.path,'revision':entry.revision};out=[]
    def first():
        try:module.converted_original(app.state.db,row,Remote(),cancelled=cancel.is_set)
        except TransferCancelled:out.append('cancelled')
    def second():out.append(module.converted_original(app.state.db,row,Remote()))
    a=threading.Thread(target=first);a.start();assert started.wait(3)
    b=threading.Thread(target=second);b.start();time.sleep(.1);assert len(calls)==1
    cancel.set();a.join(3);b.join(3)
    assert not a.is_alive() and not b.is_alive() and 'cancelled' in out
    response=next(item for item in out if item!='cancelled')
    import asyncio
    async def deliver():
        async def receive():await asyncio.sleep(30)
        async def send(message):pass
        await response({'type':'http','asgi':{'spec_version':'2.4'}},receive,send)
    asyncio.run(deliver())
    assert list((app.state.db.directory/'view-work').iterdir())==[]
    assert module._slots.acquire(blocking=False);module._slots.release()


def test_cancelled_converter_terminates_process_group(system,monkeypatch,tmp_path):
    import os,subprocess,sys,threading,time
    import photo_museum.view_original as module
    original=subprocess.Popen;started=threading.Event();cancel=threading.Event();process=[]
    def launch(*args,**kwargs):
        child=original([sys.executable,'-c','import time;time.sleep(60)'],**kwargs)
        process.append(child);started.set();return child
    monkeypatch.setattr(module.subprocess,'Popen',launch)
    def work():
        from photo_museum.download import TransferCancelled
        with pytest.raises(TransferCancelled):module.convert_in_process(tmp_path/'source',tmp_path,cancel.is_set)
    thread=threading.Thread(target=work);thread.start();assert started.wait(3);cancel.set();thread.join(3)
    assert not thread.is_alive() and process[0].poll() is not None


def test_real_isolated_converter_produces_compatible_jpeg(tmp_path):
    from PIL import Image
    from photo_museum.view_original import convert_in_process
    source=tmp_path/'source.jpg';source.write_bytes(jpeg())
    outputs=tmp_path/'outputs';outputs.mkdir()
    convert_in_process(source,outputs,lambda:False)
    with Image.open(outputs/'compatible.jpg') as result:
        result.load();assert result.format=='JPEG'


def test_http_disconnect_before_headers_cancels_worker_and_unblocks_next(system,monkeypatch):
    import asyncio,socket,threading,time,httpx,uvicorn
    import photo_museum.view_original as module
    from photo_museum.download import TransferCancelled
    app,fixture_client,remote,sid=system
    remote.entries={ROOT:None,EVENT:None,EVENT+'/one.jpg':jpeg()}
    scan(app,fixture_client,sid);MediaWorker(app.state.db).tick()
    row=fixture_client.get('/api/assets').json()['items'][0]
    started=threading.Event();stopped=threading.Event();counter=[]
    def transfer(remote,entry,spool,**kwargs):
        counter.append(1)
        if len(counter)==1:
            started.set()
            for _ in range(500):
                if kwargs['cancelled']():stopped.set();raise TransferCancelled()
                time.sleep(.01)
            raise RuntimeError('disconnect not detected')
        spool.mkdir();path=spool/'source';path.write_bytes(b'fixture');return {'path':path}
    monkeypatch.setattr(module,'download',transfer)
    monkeypatch.setattr(module,'convert_in_process',lambda source,outputs,cancelled:(outputs/'compatible.jpg').write_bytes(b'jpeg'))
    sock=socket.socket();sock.bind(('127.0.0.1',0));sock.listen();port=sock.getsockname()[1]
    server=uvicorn.Server(uvicorn.Config(app,host='127.0.0.1',port=port,log_level='critical',lifespan='off'))
    thread=threading.Thread(target=server.run,kwargs={'sockets':[sock]},daemon=True);thread.start()
    async def exercise():
        async with httpx.AsyncClient(base_url=f'http://127.0.0.1:{port}',
                                     headers={'Host':'testserver','Origin':'http://testserver'},timeout=8) as client:
            assert (await client.post('/api/login',json={'password':'synthetic-owner-password'})).status_code==200
            url=f"/api/assets/{row['id']}/original-compatible?revision={row['revision']}"
            first=asyncio.create_task(client.get(url))
            assert await asyncio.to_thread(started.wait,5)
            first.cancel()
            with pytest.raises(asyncio.CancelledError):await first
            assert await asyncio.to_thread(stopped.wait,5)
            response=await client.get(url)
            assert response.status_code==200 and response.content==b'jpeg'
    try:asyncio.run(exercise())
    finally:server.should_exit=True;thread.join(5);sock.close()
    assert list((app.state.db.directory/'view-work').iterdir())==[]
