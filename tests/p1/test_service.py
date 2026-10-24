import hashlib
import json
import os
from pathlib import Path
import subprocess
import time
import httpx
import pytest
from fastapi.testclient import TestClient
from photo_museum.api import create_app
from photo_museum.auth import Security
from photo_museum.db import Database
from photo_museum.download import download, TransferCancelled
from photo_museum.webdav import WebDAV, DAVError, normalize
from photo_museum.worker import Worker
from .fixture import fixture, ROOT, EVENT

@pytest.fixture
def system(tmp_path):
    with fixture() as (remote, url):
        app=create_app(tmp_path/'server')
        client=TestClient(app,headers={'Origin':'http://testserver'})
        assert client.post('/api/setup',json={'password':'synthetic-owner-password'}).status_code==200
        r=client.post('/api/sources',json={'url':url,'root':ROOT,'username':'pulsar','password':'fixture-only','allow_http':True})
        assert r.status_code==200,r.text
        sid=r.json()['id']
        yield app,client,remote,sid

def source(app,sid):
    with app.state.db.connect() as conn:
        return dict(conn.execute('SELECT * FROM sources WHERE id=?',(sid,)).fetchone())

def dav(app,sid):
    s=source(app,sid)
    return WebDAV(s,app.state.security.decrypt(s['secret']))

def scan(app,client,sid,root=ROOT):
    r=client.post('/api/jobs',json={'source_id':sid,'root':root})
    assert r.status_code==200,r.text
    worker=Worker(app.state.db)
    for _ in range(20):
        if not worker.tick():break
    return r.json()['id']

def test_auth_boundary_no_secrets_and_logout(system):
    app,client,remote,sid=system
    assert client.get('/api/state').status_code==200
    assert 'fixture-only' not in Path(app.state.db.path).read_bytes().decode(errors='ignore')
    assert 'secret' not in client.get('/api/state').text
    bad = client.post('/api/login', json={'password': 'sensitive-value-' * 30})
    assert bad.status_code == 422 and 'sensitive-value' not in bad.text
    assert (app.state.db.directory/'secrets.key').stat().st_mode&0o777==0o600
    assert client.post('/api/setup',json={'password':'second-password'}).status_code==400
    assert client.post('/api/jobs',json={},headers={'Origin':'http://evil.example'}).status_code==403
    assert client.get('/api/state',headers={'Host':'evil.example'}).status_code==403
    assert client.post('/api/logout',json={}).status_code==200
    for path in ('/api/state','/api/assets','/api/assets/x/manifest','/api/assets/x/original?revision=x','/api/sources/'+sid+'/browse'):
        assert client.get(path).status_code==401
    assert client.post('/api/jobs',json={'source_id':sid,'root':ROOT}).status_code==401
    for i in range(5):
        assert client.post('/api/login',json={'password':'wrong'}).status_code==401
    assert client.post('/api/login',json={'password':'synthetic-owner-password'}).status_code==401


def test_permission_failure_credentials_update_and_resume(system):
    app,client,remote,sid=system
    client.put('/api/sources/'+sid+'/credentials',json={'password':'wrong'})
    jid=scan(app,client,sid)
    assert client.get('/api/state').json()['jobs'][0]['status']=='blocked'
    assert client.get('/api/state').json()['asset_count']==0
    client.put('/api/sources/'+sid+'/credentials',json={'password':'fixture-only'})
    client.post('/api/jobs/'+jid+'/resume',json={})
    w=Worker(app.state.db)
    while w.tick():pass
    assert client.get('/api/state').json()['jobs'][0]['status']=='completed'
    assert client.post('/api/jobs',json={'source_id':sid,'root':EVENT+'/原片'}).status_code==400


def test_real_socket_drop_retries_without_deletion(system):
    app,client,remote,sid=system
    scan(app,client,sid)
    remote.failure='disconnect'
    jid=client.post('/api/jobs',json={'source_id':sid,'root':ROOT}).json()['id']
    w=Worker(app.state.db)
    for i in range(4):
        assert w.tick()
        with app.state.db.connect() as c:c.execute('UPDATE scan_dirs SET available=0 WHERE job_id=?',(jid,))
    assert client.get('/api/state').json()['jobs'][0]['status']=='blocked'
    assert client.get('/api/state').json()['asset_count']==3
    remote.failure=None
    client.post('/api/jobs/'+jid+'/resume',json={})
    w=Worker(app.state.db)
    while w.tick():pass
    assert client.get('/api/state').json()['jobs'][0]['status']=='completed'


def test_chinese_scan_incremental_missing_and_metadata(system):
    app,client,remote,sid=system
    assert client.get('/api/sources/'+sid+'/browse').status_code==200
    scan(app,client,sid)
    items=client.get('/api/assets').json()['items']
    assert len(items)==3
    assert all('原片' not in a['path'] for a in items)
    assert items[0]['event']['month']==10
    old={a['path']:a for a in items}
    a,b=items[:2]
    db=app.state.db
    db.record_extraction(a['id'],a['revision'],'extracted','fixture-v1')
    db.set_metadata(a['id'],'gps',{'lat':1},'observed',a['revision'])
    db.set_metadata(b['id'],'gps',{'lat':1},'inferred',b['revision'],'nearest-v1',[(a['id'],a['revision'],db.effective(a['id'])['gps']['record_id'])])
    db.set_metadata(b['id'],'gps',{'lat':2},'manual')
    assert db.effective(b['id'])['gps']['layer']=='manual'
    remote.entries[a['path']]+=b'changed'
    remote.entries[EVENT+'/新照片.jpg']=b'new'
    del remote.entries[EVENT+'/照片 01.jpg']
    scan(app,client,sid)
    updated=client.get('/api/assets').json()['items']
    assert len(updated)==3
    assert next(x for x in updated if x['path']==a['path'])['id']==a['id']
    with db.connect() as conn:
        assert conn.execute("SELECT stale FROM metadata WHERE asset_id=? AND layer='inferred'",(b['id'],)).fetchone()[0]==1
        assert conn.execute("SELECT count(*) FROM entries WHERE missing=1").fetchone()[0]==1
    assert db.effective(b['id'])['gps']['value']=={'lat':2}
    assert db.effective(a['id'])=={}
    assert not any(call[0] in ('PUT','DELETE','HEAD') for call in remote.calls)

@pytest.mark.parametrize('failure',[403,500,'partial'])
def test_failed_listing_never_marks_missing(system,failure):
    app,client,remote,sid=system
    scan(app,client,sid)
    remote.entries.pop(EVENT+'/照片 01.jpg')
    remote.failure=failure
    scan(app,client,sid)
    assert len(client.get('/api/assets').json()['items'])==3
    with app.state.db.connect() as conn:
        assert conn.execute('SELECT count(*) FROM entries WHERE missing=1').fetchone()[0]==0


def test_pause_lease_fencing_resume_and_new_directories(system):
    app,client,remote,sid=system
    jid=client.post('/api/jobs',json={'source_id':sid,'root':ROOT}).json()['id']
    worker=Worker(app.state.db)
    task=worker.claim()
    d=dav(app,sid); entries=d.list(ROOT); d.close()
    client.post('/api/jobs/'+jid+'/pause',json={})
    worker.commit(task,entries)
    assert worker.claim() is None
    assert client.get('/api/state').json()['jobs'][0]['done_dirs']==0
    client.post('/api/jobs/'+jid+'/resume',json={})
    stale=worker.claim()
    with app.state.db.connect() as conn:
        conn.execute('UPDATE scan_dirs SET lease_until=0 WHERE id=?',(stale['id'],))
    fresh=Worker(app.state.db).claim()
    worker.commit(stale,entries)
    assert client.get('/api/state').json()['jobs'][0]['done_dirs']==0
    worker.commit(fresh,entries)
    assert worker.tick()
    assert client.get('/api/state').json()['jobs'][0]['status']=='completed'
    remote.entries[ROOT+'/2025-新活动']=None
    remote.entries[ROOT+'/2025-新活动/new.jpg']=b'new'
    scan(app,client,sid)
    assert len(client.get('/api/assets').json()['items'])==4


def test_worker_process_killed_reclaims_expired_task(system):
    app,client,remote,sid=system
    jid=client.post('/api/jobs',json={'source_id':sid,'root':EVENT}).json()['id']
    remote.delay=2
    process=subprocess.Popen([os.sys.executable,'-m','photo_museum.worker','--data',str(app.state.db.directory)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    try:
        deadline=time.time()+8
        while time.time()<deadline:
            with app.state.db.connect() as conn:
                lease=conn.execute("SELECT 1 FROM scan_dirs WHERE state='leased'").fetchone()
            if lease:break
            time.sleep(.05)
        assert lease
        process.kill();process.wait(timeout=5)
        with app.state.db.connect() as conn:
            conn.execute('UPDATE scan_dirs SET lease_until=0 WHERE job_id=?',(jid,))
        remote.delay=0
        assert Worker(app.state.db).tick()
        assert client.get('/api/state').json()['jobs'][0]['status']=='completed'
        assert len(client.get('/api/assets').json()['items'])==3
    finally:
        if process.poll() is None:process.kill();process.wait()

@pytest.mark.parametrize('etag',['"v1"','W/"v1"',None])
def test_version_quality_and_original_range(system,etag):
    app,client,remote,sid=system
    remote.etag=etag
    scan(app,client,sid)
    a=client.get('/api/assets').json()['items'][0]
    m=client.get('/api/assets/'+a['id']+'/manifest').json()
    r=client.get(m['original'],headers={'Range':'bytes=0-9'})
    assert r.status_code==206,r.text
    assert len(r.content)==10
    assert client.get('/api/assets/'+a['id']+'/original?revision=old').status_code==409
    remote.entries[a['path']]+=b'changed'
    assert client.get(m['original']).status_code==409
    assert client.get('/api/assets/../../anything/original?revision=x').status_code==404

@pytest.mark.parametrize('mode',['normal','ignore','416'])
def test_download_cancel_resume_and_server_range_fallback(system,tmp_path,mode):
    app,client,remote,sid=system
    d=dav(app,sid)
    entry=next(e for e in d.list(EVENT) if e.path.endswith('01.jpg'))
    calls=[0]
    def cancel():
        calls[0]+=1
        return calls[0]>=3
    with pytest.raises(TransferCancelled):download(d,entry,tmp_path/'spool',cancelled=cancel)
    partial=next((tmp_path/'spool').glob('*.part')).stat().st_size
    assert partial>0
    remote.range_mode=mode
    result=download(d,entry,tmp_path/'spool')
    assert result['resumed_bytes']==(partial if mode=='normal' else 0)
    assert result['path'].read_bytes()==remote.entries[entry.path]
    assert download(d,entry,tmp_path/'spool')['cached']
    d.close()

@pytest.mark.parametrize('etag',['W/"v1"',None])
def test_weak_or_no_etag_restarts_download(system,tmp_path,etag):
    app,client,remote,sid=system
    remote.etag=etag
    d=dav(app,sid)
    entry=next(e for e in d.list(EVENT) if e.path.endswith('01.jpg'))
    calls=[0]
    def cancel():calls[0]+=1;return calls[0]>1
    with pytest.raises(TransferCancelled):download(d,entry,tmp_path/'spool',cancelled=cancel)
    assert not list((tmp_path/'spool').glob('*.part'))
    result=download(d,entry,tmp_path/'spool')
    assert result['resumed_bytes']==0
    assert not any(c[0]=='GET' and c[2] for c in remote.calls)
    d.close()


def test_download_bounds_invalid_range_and_changed_source(system,tmp_path):
    app,client,remote,sid=system
    d=dav(app,sid);entry=next(e for e in d.list(EVENT) if e.path.endswith('01.jpg'))
    with pytest.raises(DAVError,match='download_size_limit'):download(d,entry,tmp_path/'size',max_bytes=1)
    with pytest.raises(DAVError,match='spool_budget_exceeded'):download(d,entry,tmp_path/'budget',budget=1)
    calls=[0]
    def cancel():calls[0]+=1;return calls[0]>1
    with pytest.raises(TransferCancelled):download(d,entry,tmp_path/'spool',cancelled=cancel)
    remote.range_mode='invalid'
    with pytest.raises(DAVError,match='invalid_content_range'):download(d,entry,tmp_path/'spool')
    remote.etag='"v2"'
    with pytest.raises(DAVError,match='source_version_changed'):download(d,entry,tmp_path/'changed')
    d.close()


def test_xml_attack_redirect_and_paths(tmp_path):
    s={'url':'http://example.test','root':ROOT,'username':'x','allow_http':True}
    for xml in (b'<!DOCTYPE x [<!ENTITY x SYSTEM "file:///etc/passwd">]><x>&x;</x>', b'<broken'):
        d=WebDAV(s,'x',httpx.MockTransport(lambda r:httpx.Response(207,content=xml)))
        with pytest.raises(Exception):d.list(ROOT)
        d.close()
    d=WebDAV(s,'x',httpx.MockTransport(lambda r:httpx.Response(302,headers={'Location':'http://evil.test'})))
    with pytest.raises(DAVError,match='redirect_refused'):d.list(ROOT)
    for path in (ROOT+'/../x','relative','/x\\y'):
        with pytest.raises(ValueError):normalize(path)
    with pytest.raises(DAVError,match='path_outside_root'):d.url('/工程/other')
    d.close()


def test_metadata_provenance_clear_history_and_stale_donor_record(system):
    app,client,remote,sid=system
    scan(app,client,sid)
    a,b=client.get('/api/assets').json()['items'][:2]
    db=app.state.db
    with pytest.raises(ValueError,match='successful extraction'):
        db.set_metadata(a['id'],'gps',{'lat':1},'observed',a['revision'])
    db.record_extraction(a['id'],a['revision'],'extracted','fixture-v1')
    db.set_metadata(a['id'],'gps',{'lat':1},'observed',a['revision'],info={'precision':'city'})
    record=db.effective(a['id'])['gps']['record_id']
    donor=[(a['id'],a['revision'],record)]
    db.set_metadata(b['id'],'gps',{'lat':1},'inferred',b['revision'],'v1',donor)
    assert db.effective(b['id'])=={}  # Tentative candidates do not become facts.
    db.set_metadata(b['id'],'gps',{'lat':1},'inferred',b['revision'],'v1',donor,{'accepted':True,'precision':'city','uncertainty':{'radius_m':5000}})
    effective=db.effective(b['id'])['gps']
    assert effective['is_estimated'] and effective['precision']=='city'
    db.set_metadata(b['id'],'gps',None,'manual')
    assert db.effective(b['id'])['gps']['value'] is None
    db.set_metadata(a['id'],'gps',{'lat':2},'observed',a['revision'])
    with pytest.raises(ValueError,match='current observed facts'):
        db.set_metadata(b['id'],'gps',{'lat':1},'inferred',b['revision'],'v1',donor)
    with pytest.raises(ValueError,match='must not be inferred'):
        db.set_metadata(b['id'],'exposure',1,'inferred',b['revision'],'v1',donor)
    with db.connect() as c:
        assert c.execute("SELECT count(*) FROM metadata_history WHERE asset_id=?",(a['id'],)).fetchone()[0]==1
        assert c.execute("SELECT stale FROM metadata WHERE asset_id=? AND layer='inferred'",(b['id'],)).fetchone()[0]==1
    assert db.effective(b['id'])['gps']['value'] is None


def test_schema_migration_preserves_data_and_rejects_newer_database(tmp_path):
    import sqlite3
    directory=tmp_path/'migration';directory.mkdir()
    c=sqlite3.connect(directory/'catalog.sqlite')
    c.executescript(Path('photo_museum/migrations/001_initial.sql').read_text())
    c.execute("INSERT INTO settings VALUES('sample','preserved')")
    c.execute('PRAGMA user_version=1');c.commit();c.close()
    db=Database(directory)
    with db.connect() as c:
        assert c.execute('PRAGMA user_version').fetchone()[0]==len(__import__('photo_museum.db',fromlist=['MIGRATIONS']).MIGRATIONS)
        assert c.execute("SELECT value FROM settings WHERE key='sample'").fetchone()[0]=='preserved'
        c.execute('PRAGMA user_version=999')
    with pytest.raises(RuntimeError,match='newer'):Database(directory)
