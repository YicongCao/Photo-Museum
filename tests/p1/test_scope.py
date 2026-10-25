import uuid
from .schema_helpers import drop_lexicon
from photo_museum.db import Database
from photo_museum.media_worker import MediaWorker
from photo_museum.worker import Worker
from .test_service import system,scan
from .test_media import jpeg
from .fixture import ROOT,EVENT


def test_no_secondary_listing_or_files(system):
    app,client,remote,sid=system
    sub=EVENT+'/Photomator';other=EVENT+'/跑山视频'
    remote.entries={ROOT:None,EVENT:None,EVENT+'/one.jpg':jpeg(),sub:None,sub+'/ignored.jpg':jpeg(),other:None,other+'/ignored.MOV':b'video'}
    scan(app,client,sid)
    assert client.get('/api/state').json()['asset_count']==1
    assert client.get('/api/state').json()['jobs'][0]['total_dirs']==2
    assert not any(call[1] in (sub,other) for call in remote.calls)
    assert client.post('/api/jobs',json={'source_id':sid,'root':sub}).status_code==400
    assert len(client.get('/api/media/directories').json()['items'])==2


def test_standalone_video_has_zero_get_and_full_index_completion(system):
    app,client,remote,sid=system
    video=EVENT+'/independent.MP4'
    remote.entries={ROOT:None,EVENT:None,video:b'large original stays on NAS'}
    scan(app,client,sid)
    with app.state.db.connect() as c:c.execute('UPDATE entries SET size=? WHERE is_dir=0',(3*1024**3,))
    worker=MediaWorker(app.state.db);assert worker.tick()
    assert not any(call[0]=='GET' for call in remote.calls)
    state=client.get('/api/media/state?after=0').json()
    assert state['counts']=={'indexed':1}
    assert state['fully_done']==1
    assert state['recent']==[]
    assert state['completion_events'][0]['metadata_only']
    assert state['completion_events'][0]['steps']['download']=='skipped'
    assert client.get('/api/media/directories').json()['items'][0]['done']==1


def test_same_name_video_still_downloads_and_late_photo_requeues(system):
    app,client,remote,sid=system
    video=EVENT+'/pair.MOV'
    remote.entries={ROOT:None,EVENT:None,video:b'fixture invalid codec'}
    scan(app,client,sid);worker=MediaWorker(app.state.db);worker.tick()
    assert not any(call[0]=='GET' for call in remote.calls)
    remote.entries[EVENT+'/pair.JPG']=jpeg()
    scan(app,client,sid)
    # Descending filenames choose video first; invalid codec remains isolated after its GET.
    assert worker.tick()
    assert any(call[0]=='GET' and call[1]==video for call in remote.calls)


def test_existing_nested_catalog_is_excluded_without_marking_nas_missing(system):
    app,client,remote,sid=system
    remote.entries={ROOT:None,EVENT:None,EVENT+'/one.jpg':jpeg()};jid=scan(app,client,sid)
    db=app.state.db
    with db.connect() as c:
        row=dict(c.execute('SELECT * FROM entries WHERE is_dir=0').fetchone())
        row.update(id=uuid.uuid4().hex,path=EVENT+'/Photomator/old.jpg',parent=EVENT+'/Photomator')
        c.execute('INSERT INTO entries('+','.join(row)+') VALUES('+','.join('?' for _ in row)+')',list(row.values()))
        c.execute('INSERT INTO media_jobs(asset_id,revision) VALUES(?,?)',(row['id'],row['revision']))
        c.execute('INSERT INTO scan_dirs(job_id,path) VALUES(?,?)',(jid,row['parent']))
        drop_lexicon(c)
        c.execute('ALTER TABLE entries DROP COLUMN scope_excluded')
        c.execute('DROP INDEX cache_asset_revision_profile')
        # The simulated v5 catalog must not retain tables introduced by v8/v9.
        for table in ('creative_pairs','creative_layouts','curator_exhibitions','curator_events','curator_runs'):c.execute('DROP TABLE '+table)
        c.execute('PRAGMA user_version=5')
    Database(db.directory)
    with db.connect() as c:
        old=c.execute('SELECT missing,scope_excluded FROM entries WHERE id=?',(row['id'],)).fetchone()
        assert old['missing']==0 and old['scope_excluded']==1
        assert c.execute('SELECT status FROM media_jobs WHERE asset_id=?',(row['id'],)).fetchone()[0]=='excluded'
    assert client.get('/api/assets/'+row['id']+'/manifest').status_code==404
    assert client.get('/api/state').json()['asset_count']==1
    assert client.get('/api/state').json()['jobs'][0]['total_dirs']==2
