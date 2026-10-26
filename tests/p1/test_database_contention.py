import contextlib
import os
from pathlib import Path
import signal
import socket
import sqlite3
import subprocess
import sys
import threading
import time

import httpx
import pytest

from photo_museum.db import Database
from photo_museum.worker import Worker
from photo_museum.worker_runtime import is_database_busy, run_loop
from photo_museum.work_queue import choose_directory
from photo_museum.supervisor import supervise
from .test_service import system, scan
from .fixture import ROOT, EVENT
from .test_media import jpeg


def test_busy_classification_does_not_hide_permanent_database_errors():
    assert is_database_busy(sqlite3.OperationalError('database is locked'))
    assert is_database_busy(sqlite3.OperationalError('database table is locked'))
    error=sqlite3.OperationalError('snapshot');error.sqlite_errorcode=sqlite3.SQLITE_BUSY_SNAPSHOT
    assert is_database_busy(error)
    for error in (sqlite3.OperationalError('no such table: broken'),sqlite3.OperationalError('disk I/O error'),ValueError('database is locked')):
        assert not is_database_busy(error)
        with pytest.raises(type(error)):
            run_loop(lambda: (_ for _ in ()).throw(error),sleep=lambda _:pytest.fail('permanent error was retried'))


def test_loop_recovers_from_a_real_writer_lock_without_replaying_commits(tmp_path):
    db=Database(tmp_path);held=threading.Event();release=threading.Event();waits=[]
    def holder():
        with db.connect() as c:
            c.execute('BEGIN IMMEDIATE');held.set();assert release.wait(5)
    thread=threading.Thread(target=holder);thread.start();assert held.wait(3)
    calls=0
    def tick():
        nonlocal calls
        calls+=1
        with db.connect(timeout=.01) as c:
            c.execute('BEGIN IMMEDIATE')
            c.execute("INSERT INTO settings VALUES('committed_once','1')")
        return False
    class Finished(Exception):pass
    def wait(seconds):
        waits.append(seconds)
        if len(waits)==1:
            release.set();thread.join(3)
        else:raise Finished
    try:
        with pytest.raises(Finished):run_loop(tick,sleep=wait,log=lambda *a,**k:None)
        assert calls==2 and waits[0]<=.3
        with db.connect() as c:assert c.execute("SELECT count(*) FROM settings WHERE key='committed_once'").fetchone()[0]==1
    finally:release.set();thread.join(3)


def test_failed_transaction_rolls_back_and_once_reports_busy(tmp_path):
    db=Database(tmp_path)
    def tick():
        with db.connect() as c:
            c.execute("INSERT INTO settings VALUES('partial','wrong')")
            raise sqlite3.OperationalError('database is locked')
    with pytest.raises(sqlite3.OperationalError):run_loop(tick,once=True)
    with db.connect() as c:assert c.execute("SELECT 1 FROM settings WHERE key='partial'").fetchone() is None


def test_directory_projection_allows_another_writer_and_idle_does_not_write(tmp_path,monkeypatch):
    import photo_museum.work_queue as queue
    db=Database(tmp_path);original=queue.directory_focus;other_writes=[]
    def project(c,**kwargs):
        result=original(c,**kwargs)
        with db.connect(timeout=.01) as other:
            other.execute('BEGIN IMMEDIATE')
            other.execute("INSERT OR REPLACE INTO settings VALUES('concurrent','ok')")
        other_writes.append(True)
        return result
    monkeypatch.setattr(queue,'directory_focus',project)
    assert choose_directory(db) is None and other_writes
    monkeypatch.setattr(queue,'directory_focus',original)
    changes=[];connect=db.connect
    @contextlib.contextmanager
    def inspect():
        with connect() as c:
            yield c
            changes.append(c.total_changes)
    monkeypatch.setattr(db,'connect',inspect)
    assert choose_directory(db) is None
    assert sum(changes)==0


def test_focus_compare_and_set_does_not_overwrite_a_newer_selection(tmp_path,monkeypatch):
    import photo_museum.work_queue as queue
    db=Database(tmp_path);original=queue.directory_focus;calls=0
    def project(c,**kwargs):
        nonlocal calls
        calls+=1;result=original(c,**kwargs)
        if calls==1:
            with db.connect() as other:other.execute("INSERT INTO settings VALUES('media_directory','null')")
        return result
    monkeypatch.setattr(queue,'directory_focus',project)
    assert choose_directory(db) is None and calls==2


def test_scan_commit_busy_does_not_block_job_or_mark_sources_missing(system,monkeypatch):
    app,client,remote,sid=system
    jid=client.post('/api/jobs',json={'source_id':sid,'root':ROOT}).json()['id']
    worker=Worker(app.state.db);original=worker.commit
    def busy(*args):raise sqlite3.OperationalError('database is locked')
    monkeypatch.setattr(worker,'commit',busy)
    with pytest.raises(sqlite3.OperationalError):worker.tick()
    with app.state.db.connect() as c:
        row=c.execute('SELECT status,error FROM jobs WHERE id=?',(jid,)).fetchone()
        assert row['status']=='running' and row['error'] is None
        assert c.execute('SELECT sum(attempts) FROM scan_dirs').fetchone()[0]==0
        assert c.execute('SELECT count(*) FROM entries').fetchone()[0]==0
        c.execute('UPDATE scan_dirs SET lease_until=0')
    monkeypatch.setattr(worker,'commit',original)
    while worker.tick():pass
    with app.state.db.connect() as c:assert c.execute('SELECT status FROM jobs WHERE id=?',(jid,)).fetchone()[0]=='completed'


def test_media_busy_does_not_become_a_codec_failure(system,monkeypatch):
    from photo_museum.media_worker import MediaWorker
    import photo_museum.media_worker as media
    app,client,remote,sid=system;scan(app,client,sid)
    worker=MediaWorker(app.state.db)
    monkeypatch.setattr(media,'still',lambda *a,**k:(_ for _ in ()).throw(sqlite3.OperationalError('database is locked')))
    with pytest.raises(sqlite3.OperationalError):worker.tick()
    with app.state.db.connect() as c:
        assert not c.execute("SELECT 1 FROM media_jobs WHERE status='failed' OR error IS NOT NULL OR attempts>0").fetchone()
        assert not c.execute("SELECT 1 FROM media_jobs WHERE status='running'").fetchone()
    assert not any(t.is_alive() and t.name.startswith('Thread') and t._target and getattr(t._target,'__name__','')=='renew' for t in threading.enumerate())


def test_supervisor_worker_crash_backoff_keeps_listener_running():
    now=[0.];spawned=[];children=[]
    class Process:
        def __init__(self,listener):self.listener=listener;self.stopped=False
        def poll(self):return 0 if self.stopped else None if self.listener else 1
        def terminate(self):self.stopped=True
        def wait(self,timeout=None):return 0
    def popen(command,**kwargs):
        p=Process(command[0]=='api');children.append(p);spawned.append((command[0],now[0]));return p
    def sleep(seconds):
        assert children[0].poll() is None
        now[0]+=seconds
    assert supervise([['api'],['worker']],{},lambda:now[0]>=100,popen=popen,clock=lambda:now[0],sleep=sleep,log=lambda *a,**k:None)==0
    starts=[t for label,t in spawned if label=='worker']
    intervals=[b-a for a,b in zip(starts,starts[1:])]
    assert len(starts)>5 and intervals[-1]>=30 and intervals[0]>=1
    assert children[0].stopped


def test_supervisor_listener_exit_is_fatal_and_stops_workers():
    class Process:
        def __init__(self,code):self.code=code;self.stopped=False
        def poll(self):return self.code
        def terminate(self):self.code=0;self.stopped=True
        def wait(self,timeout=None):return self.code
    api=Process(1);worker=Process(None);processes=iter([api,worker])
    assert supervise([['api'],['worker']],{},lambda:False,popen=lambda *a,**k:next(processes))==1
    assert worker.stopped


def _children(parent):
    output=subprocess.check_output(['ps','-axo','pid=,ppid=,command='],text=True)
    return [(int(pid),command) for line in output.splitlines() if len(parts:=line.strip().split(None,2))==3 for pid,ppid,command in [parts] if int(ppid)==parent]


def _eventually(fn,seconds=15):
    deadline=time.monotonic()+seconds
    while time.monotonic()<deadline:
        value=fn()
        if value:return value
        time.sleep(.1)
    raise AssertionError('condition did not recover')


def test_real_supervisor_survives_worker_kill_and_lock_timeout(tmp_path):
    # Separate empty catalog: no production connection, media, models or NAS access.
    directory=tmp_path/'service';db=Database(directory)
    with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
    env={**os.environ,'MUSEUM_MODELS':str(tmp_path/'no-models'),'MUSEUM_HOSTS':f'127.0.0.1:{port}'}
    log=tmp_path/'supervisor.log'
    with log.open('w') as stream:
        process=subprocess.Popen([sys.executable,'-m','photo_museum','--data',str(directory),'--port',str(port)],env=env,stdout=stream,stderr=subprocess.STDOUT)
        client=httpx.Client(timeout=2,trust_env=False)
        def ready():
            try:return client.get(f'http://127.0.0.1:{port}/api/bootstrap').status_code==200
            except httpx.HTTPError:return False
        try:
            _eventually(ready)
            children=_eventually(lambda:_children(process.pid))
            api=next(pid for pid,cmd in children if '-m uvicorn ' in cmd)
            scan_pid=_eventually(lambda:next((pid for pid,cmd in _children(process.pid) if '-m photo_museum.worker ' in cmd),None))
            os.kill(scan_pid,signal.SIGKILL)
            new_pid=_eventually(lambda:next((pid for pid,cmd in _children(process.pid) if '-m photo_museum.worker ' in cmd and pid!=scan_pid),None))
            assert new_pid!=scan_pid and ready() and process.poll() is None
            def initialized():
                with db.connect() as c:return c.execute('SELECT count(*) FROM workers').fetchone()[0]>=3
            _eventually(initialized)
            assert api in [pid for pid,_ in _children(process.pid)]
            with db.connect() as locker:
                locker.execute('BEGIN IMMEDIATE')
                # Exceed the real production 10-second busy timeout.
                _eventually(lambda:'Database busy; worker will retry' in log.read_text(),seconds=18)  # five-second heartbeat + ten-second SQLite busy timeout
                assert ready() and process.poll() is None
                assert api in [pid for pid,_ in _children(process.pid)]
            released=time.time()
            def resumed():
                with db.connect() as c:return c.execute('SELECT count(*) FROM workers WHERE heartbeat>?',(released,)).fetchone()[0]>=2
            _eventually(resumed)
            assert new_pid in [pid for pid,_ in _children(process.pid)]
        finally:
            client.close();process.terminate()
            try:process.wait(timeout=18)
            except subprocess.TimeoutExpired:process.kill();process.wait();pytest.fail('supervisor did not stop')
        assert not _children(process.pid)


def test_analysis_busy_is_not_saved_as_failed_recognition(system,monkeypatch):
    from photo_museum.analysis_worker import AnalysisWorker
    from photo_museum.media_worker import MediaWorker
    from .test_delivery import FakeProvider
    app,client,remote,sid=system;remote.entries={ROOT:None,EVENT:None,EVENT+'/one.jpg':jpeg()};scan(app,client,sid)
    assert MediaWorker(app.state.db).tick()
    provider=FakeProvider();worker=AnalysisWorker(app.state.db,provider);analyze=provider.analyze
    monkeypatch.setattr(provider,'analyze',lambda *a,**k:(_ for _ in ()).throw(sqlite3.OperationalError('database is locked')))
    with pytest.raises(sqlite3.OperationalError):worker.tick()
    with app.state.db.connect() as c:assert not c.execute("SELECT 1 FROM analysis WHERE provider='visual'").fetchone()
    monkeypatch.setattr(provider,'analyze',analyze)
    assert worker.tick()
    with app.state.db.connect() as c:assert not c.execute("SELECT 1 FROM analysis WHERE json_extract(data_json,'$.error') IS NOT NULL").fetchone()


def test_photography_busy_is_not_saved_as_failed_style(system,monkeypatch):
    from photo_museum.analysis_worker import AnalysisWorker
    from photo_museum.photography_worker import PhotographyWorker
    from photo_museum.media_worker import MediaWorker
    from .test_delivery import FakeProvider
    from .test_photography import FakePhotography
    app,client,remote,sid=system;remote.entries={ROOT:None,EVENT:None,EVENT+'/one.jpg':jpeg()};scan(app,client,sid)
    assert MediaWorker(app.state.db).tick()
    assert AnalysisWorker(app.state.db,FakeProvider()).tick()
    provider=FakePhotography();worker=PhotographyWorker(app.state.db,provider);analyze=provider.analyze
    monkeypatch.setattr(provider,'analyze',lambda *a,**k:(_ for _ in ()).throw(sqlite3.OperationalError('database is locked')))
    with pytest.raises(sqlite3.OperationalError):worker.tick()
    with app.state.db.connect() as c:assert not c.execute("SELECT 1 FROM analysis WHERE provider='photography'").fetchone()
    monkeypatch.setattr(provider,'analyze',analyze)
    assert worker.tick()
    with app.state.db.connect() as c:assert not c.execute("SELECT 1 FROM analysis WHERE json_extract(data_json,'$.error') IS NOT NULL").fetchone()
