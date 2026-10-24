import json
import time
from photo_museum.processing import Progress
from photo_museum.media_worker import MediaWorker
from .test_service import system, scan
from .test_media import jpeg
from .fixture import ROOT, EVENT


def test_recent_twenty_current_revision_order_and_auth(system):
    app, client, remote, sid = system
    remote.entries = {ROOT: None, EVENT: None, **{EVENT+f'/IMG_{n:04}.jpg': jpeg() for n in range(22)}}
    scan(app, client, sid)
    worker = MediaWorker(app.state.db)
    while worker.tick():
        pass
    state = client.get('/api/media/state').json()
    assert len(state['recent']) == 20
    assert [a['completed_at'] for a in state['recent']] == sorted(a['completed_at'] for a in state['recent'])
    assert all(client.get(a['preview']).status_code == 200 for a in state['recent'])
    with app.state.db.connect() as c:
        p = c.execute('SELECT steps_json,bytes_done,bytes_total FROM processing_progress LIMIT 1').fetchone()
        assert p['bytes_done'] == p['bytes_total'] == len(jpeg())
        assert all(json.loads(p['steps_json'])[s] == 'done' for s in ('download','exif','thumb','display','publish'))
        last = state['recent'][-1]
        c.execute('UPDATE entries SET revision=? WHERE id=?', ('changed',last['id']))
    assert last['id'] not in [a['id'] for a in client.get('/api/media/state').json()['recent']]
    client.post('/api/logout',json={})
    assert client.get('/api/media/state').status_code == 401


def test_measured_progress_fences_old_attempts_and_expires(system):
    app, client, remote, sid = system
    remote.entries = {ROOT: None, EVENT: None, EVENT+'/one.jpg': jpeg()}
    scan(app,client,sid)
    db=app.state.db
    worker=MediaWorker(db)
    task=worker.claim()
    old=Progress(db,task['id'],task['revision'],'media','old')
    current=Progress(db,task['id'],task['revision'],'media',task['token'])
    current.transfer(128,1024)
    old.report('download','done',1024,1024)
    old.finish('ready')
    active=client.get('/api/media/state').json()['active'][0]
    assert active['bytes_done']==128 and active['bytes_total']==1024
    assert active['steps']['download']=='running'
    with db.connect() as c:
        c.execute('UPDATE media_jobs SET lease_until=?',(time.time()-1,))
    assert not client.get('/api/media/state').json()['active']


def test_full_completion_waits_for_analysis_and_directory_queue(system, monkeypatch):
    from photo_museum.analysis_worker import AnalysisWorker
    from .test_delivery import FakeProvider
    app,client,remote,sid=system
    remote.entries={ROOT:None,EVENT:None,EVENT+'/one.jpg':jpeg(),ROOT+'/2023-第二活动':None,ROOT+'/2023-第二活动/two.jpg':jpeg()}
    scan(app,client,sid)
    monkeypatch.setenv('MUSEUM_ANALYSIS_ENABLED','1')
    worker=MediaWorker(app.state.db)
    assert worker.tick()
    initial=client.get('/api/media/state?after=0').json()
    assert initial['fully_done']==0 and initial['completion_events']==[]
    assert AnalysisWorker(app.state.db,FakeProvider()).tick()
    done=client.get('/api/media/state?after=0').json()
    assert len(done['completion_events'])==1
    event=done['completion_events'][0]
    assert all(event['steps'][stage] in ('done','skipped') for stage in ('download','exif','display','thumb','publish','address','subject','faces','score'))
    assert not client.get('/api/media/state?after='+str(done['completion_cursor'])).json()['completion_events']
    dirs=client.get('/api/media/directories').json()
    assert dirs['total']==3
    assert sum(d['total'] for d in dirs['items'])==2
    assert sum(d['done'] for d in dirs['items'])==1
    assert any(d['status']=='pending' for d in dirs['items'])
    # A lost worker lease is not displayed as an active directory.
    task=worker.claim()
    with app.state.db.connect() as c:
        c.execute('UPDATE media_jobs SET lease_until=0 WHERE asset_id=?',(task['id'],))
    assert not any(d['active'] for d in client.get('/api/media/directories').json()['items'])


def test_descending_directory_order_waits_for_local_analysis(system,monkeypatch):
    from photo_museum.analysis_worker import AnalysisWorker
    from .test_delivery import FakeProvider
    app,client,remote,sid=system
    newer=ROOT+'/2025-12-新活动';older=ROOT+'/2024-01-旧活动'
    remote.entries={ROOT:None,newer:None,older:None,**{folder+'/'+name:jpeg() for folder in (newer,older) for name in ('A.jpg','Z.jpg')}}
    scan(app,client,sid);monkeypatch.setenv('MUSEUM_ANALYSIS_ENABLED','1')
    worker=MediaWorker(app.state.db)
    assert worker.tick() and worker.tick()
    with app.state.db.connect() as c:
        paths=[r[0] for r in c.execute("SELECT e.path FROM media_info m JOIN entries e ON e.id=m.asset_id ORDER BY m.updated")]
    assert paths==[newer+'/Z.jpg',newer+'/A.jpg']
    assert not worker.tick(), 'Do not move directory before its local analysis settles'
    a=AnalysisWorker(app.state.db,FakeProvider());assert a.tick() and a.tick()
    assert worker.tick()
    dirs=client.get('/api/media/directories').json()
    assert dirs['current']['path']==older
    assert [d['path'] for d in dirs['items']]==sorted([d['path'] for d in dirs['items']],reverse=True)


def test_media_process_stop_requeues_without_waiting_for_lease(system):
    import os,subprocess
    app,client,remote,sid=system
    remote.entries={ROOT:None,EVENT:None,EVENT+'/one.jpg':jpeg()}
    scan(app,client,sid);remote.delay=2
    proc=subprocess.Popen([os.sys.executable,'-m','photo_museum.media_worker','--data',str(app.state.db.directory),'--once'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    try:
        deadline=time.time()+5
        while time.time()<deadline:
            with app.state.db.connect() as c:
                active=c.execute("SELECT 1 FROM processing_progress WHERE stage='download'").fetchone()
            if active:break
            time.sleep(.02)
        assert active
        proc.terminate();proc.wait(timeout=5)
        with app.state.db.connect() as c:
            assert c.execute('SELECT status FROM media_jobs').fetchone()[0]=='pending'
    finally:
        if proc.poll() is None:proc.kill();proc.wait()
