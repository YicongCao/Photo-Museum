import pytest
from photo_museum.runtime_revision import revision
from photo_museum.worker_runtime import run_loop
from .test_service import system, scan
from .fixture import ROOT

def test_revision_ignores_heartbeat_and_noop_but_tracks_work_and_catalog(system):
    app,client,remote,sid=system;db=app.state.db
    before=(revision(db),revision(db,'catalog'))
    with db.connect() as c:
        c.execute("INSERT OR REPLACE INTO workers VALUES('test',123)")
        c.execute("UPDATE settings SET value=value")
    assert before==(revision(db),revision(db,'catalog'))
    with db.connect() as c:c.execute("UPDATE settings SET value='true' WHERE key='media_paused'")
    assert revision(db)>before[0] and revision(db,'catalog')>before[1]
    before=revision(db)
    with pytest.raises(RuntimeError):
        with db.connect() as c:
            c.execute("UPDATE settings SET value='false' WHERE key='media_paused'")
            raise RuntimeError()
    assert revision(db)==before

def test_idle_wait_wakes_on_change_and_has_bounded_timer_fallback():
    calls=[];waits=[];token=[0]
    class Done(Exception):pass
    def tick():
        calls.append(len(waits))
        if len(calls)==3:raise Done()
        return False
    def sleep(delay):
        waits.append(delay)
        if len(waits)==2:token[0]+=1
    with pytest.raises(Done):run_loop(tick,revision=lambda:token[0],sleep=sleep,max_idle=5)
    assert calls==[0,2,5] and waits==[1,2,1,2,2]

def test_idle_change_during_tick_is_not_lost():
    calls=[];token=[0];waits=[]
    class Done(Exception):pass
    def tick():
        calls.append(1);token[0]+=1
        if len(calls)==2:raise Done()
        return False
    with pytest.raises(Done):run_loop(tick,revision=lambda:token[0],sleep=waits.append)
    assert waits==[1]

def test_catalog_single_flight_snapshot_invalidation_and_auth(system,monkeypatch):
    app,client,remote,sid=system;db=app.state.db
    scan(app,client,sid)
    import contextlib
    connect=db.connect;sql=[]
    @contextlib.contextmanager
    def traced(*a,**kw):
        with connect(*a,**kw) as c:
            c.set_trace_callback(sql.append);yield c
    monkeypatch.setattr(db,'connect',traced)
    first=client.get('/api/gallery');assert first.status_code==200
    sql.clear();assert client.get('/api/gallery').json()==first.json()
    assert client.get('/api/gallery',params={'since':first.json()['revision']}).json()=={'revision':first.json()['revision'],'unchanged':True}
    assert not any('SELECT e.*,m.data_json' in q for q in sql)
    with db.connect() as c:c.execute("INSERT OR REPLACE INTO settings VALUES('analysis_version','new')")
    sql.clear();assert client.get('/api/gallery').status_code==200
    assert any('SELECT e.*,m.data_json' in q for q in sql)
    assert 'activities' in client.get('/api/gallery',params={'since':first.json()['revision']}).json()
    assert client.get('/api/session').json()=={'authenticated':True}
    client.post('/api/logout')
    assert client.get('/api/session').status_code==401
    assert client.get('/api/gallery').status_code==401
    assert client.get('/api/gallery',params={'since':first.json()['revision']}).status_code==401

def test_progress_and_source_edits_invalidate_snapshot_without_lru_waking_workers(system):
    from photo_museum.read_snapshot import cached_read
    from photo_museum.processing import Progress
    app,client,remote,sid=system;db=app.state.db;scan(app,client,sid)
    calls=[]
    @cached_read(db)
    def read():
        calls.append(1)
        return {'active':[], 'count':len(calls)}
    assert read()['count']==read()['count']==1
    with db.connect() as c:r=c.execute('SELECT id,revision FROM entries WHERE is_dir=0 LIMIT 1').fetchone()
    work=revision(db)
    p=Progress(db,r['id'],r['revision'],'media');assert read()['count']==2
    p.report('download',done=10,total=100);assert read()['count']==3
    assert revision(db)==work  # Telemetry cannot wake every expensive analysis worker.
    with db.connect() as c:c.execute("UPDATE sources SET name='Changed fixture' WHERE id=?",(sid,))
    assert read()['count']==4
    with db.connect() as c:c.execute("INSERT INTO cache_files VALUES('test',?,?, 'thumb','test.webp',4,0)",(r['id'],r['revision']))
    assert read()['count']==5
    with db.connect() as c:c.execute("UPDATE cache_files SET accessed=123 WHERE key='test'")
    assert read()['count']==5 and revision(db)==work


def test_idle_backoff_bounds_probes_and_preserves_heartbeat():
    clock=[0];probes=[];beats=[];ticks=[]
    class Done(Exception):pass
    def tick():
        ticks.append(clock[0])
        if len(ticks)==3:raise Done()
        return False
    def token():probes.append(clock[0]);return 0
    with pytest.raises(Done):
        run_loop(tick,revision=token,sleep=lambda n:clock.__setitem__(0,clock[0]+n),heartbeat=lambda:beats.append(clock[0]))
    assert ticks==[0,30,60]
    assert beats==list(range(5,61,5))
    assert len(probes)<20  # previously >60 connections per idle minute
    assert max(b-a for a,b in zip(probes,probes[1:]))<=5


def test_no_revision_backoff_resets_after_work():
    waits=[];answers=iter([False]*6+[True,False])
    class Done(Exception):pass
    def tick():
        try:return next(answers)
        except StopIteration:raise Done()
    with pytest.raises(Done):run_loop(tick,idle=2,sleep=waits.append,max_idle=30)
    assert waits==[2,4,8,16,30,30,2]


def test_worker_backoff_wakes_changed_token_within_five_seconds():
    clock=[0];ticks=[]
    class Done(Exception):pass
    def tick():
        ticks.append(clock[0])
        if len(ticks)==2:raise Done()
        return False
    with pytest.raises(Done):
        run_loop(tick,revision=lambda:int(clock[0]>=9),sleep=lambda n:clock.__setitem__(0,clock[0]+n))
    assert 9<=ticks[1]<=14


def test_state_catalogue_cached_but_auth_and_liveness_are_fresh(system,monkeypatch):
    import contextlib,time
    app,client,remote,sid=system;db=app.state.db;scan(app,client,sid)
    first=client.get('/api/state').json();sql=[];connect=db.connect
    @contextlib.contextmanager
    def traced(*a,**kw):
        with connect(*a,**kw) as c:
            c.set_trace_callback(sql.append);yield c
    monkeypatch.setattr(db,'connect',traced)
    assert client.get('/api/state').json()==first
    assert not any('SELECT j.*' in q for q in sql)
    with db.connect() as c:c.execute('UPDATE workers SET heartbeat=0')
    assert client.get('/api/state').json()['worker_online'] is False
    with db.connect() as c:c.execute("INSERT OR REPLACE INTO workers VALUES('fresh',?)",(time.time(),))
    assert client.get('/api/state').json()['worker_online'] is True
    with db.connect() as c:c.execute("UPDATE sources SET name='new source name' WHERE id=?",(sid,))
    assert client.get('/api/state').json()['sources'][0]['name']=='new source name'
    client.post('/api/logout');assert client.get('/api/state').status_code==401
