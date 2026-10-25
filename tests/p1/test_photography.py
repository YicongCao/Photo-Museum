import json
import time
from pathlib import Path
import pytest
from photo_museum.photography import CATALOG,select_candidates
from photo_museum.photography_worker import PhotographyWorker
from photo_museum.media_worker import MediaWorker
from photo_museum.analysis_worker import AnalysisWorker
from .test_service import system,scan
from .test_media import jpeg
from .test_delivery import FakeProvider
from .fixture import ROOT,EVENT


class FakePhotography:
    id='photography';version='photography-fixture-v1'
    def analyze(self,path,progress=lambda *a:None):
        for s in ('style','topic'):progress(s,'done')
        return {'style':{'status':'candidates','labels':[{'id':'minimal','label':'极简留白','similarity':.31,'margin':.04,'candidate':True}]},
                'topic':{'status':'candidates','labels':[{'id':'landscape','label':'自然风光','similarity':.32,'margin':.06,'candidate':True}]},
                'offline':True,'calibrated':False,'score_kind':'cosine_similarity'}


def seed(system):
    app,client,remote,sid=system
    remote.entries={ROOT:None,EVENT:None,EVENT+'/one.jpg':jpeg()}
    scan(app,client,sid);assert MediaWorker(app.state.db).tick()
    assert AnalysisWorker(app.state.db,FakeProvider()).tick()
    with app.state.db.connect() as c:return dict(c.execute('SELECT * FROM entries WHERE is_dir=0').fetchone())


def test_taxonomy_multilabel_abstains_and_prevents_contradictory_styles():
    catalog=json.loads(CATALOG.read_text());scores={}
    for axis in ('style','topic'):
        for item in catalog[axis]['labels']+catalog[axis]['neutral_labels']:scores[item['id']]=.2
    assert all(select_candidates(catalog,scores)[a]['status']=='uncertain' for a in ('style','topic'))
    scores.update(monochrome=.32,vibrant=.31,minimal=.30,landscape=.31,mountains=.30)
    result=select_candidates(catalog,scores)
    assert [r['id'] for r in result['style']['labels']]==['monochrome','minimal']
    assert [r['id'] for r in result['topic']['labels']]==['landscape','mountains']
    assert all('confidence' not in r for r in result['style']['labels'])
    scores['monochrome']=float('nan');scores['vibrant']=float('inf')
    assert [r['id'] for r in select_candidates(catalog,scores)['style']['labels']]==['minimal']


def test_cached_backfill_completion_and_api_are_versioned_without_nas(system,monkeypatch):
    row=seed(system);app,client,remote,sid=system;db=app.state.db
    with db.connect() as c:
        original_visual=dict(c.execute("SELECT * FROM analysis WHERE provider='visual'").fetchone())
        media_updated=c.execute('SELECT updated FROM media_info').fetchone()[0]
    monkeypatch.setenv('MUSEUM_ANALYSIS_ENABLED','1');monkeypatch.setenv('MUSEUM_PHOTOGRAPHY_ENABLED','1')
    worker=PhotographyWorker(db,FakePhotography());before=list(remote.calls)
    assert client.get('/api/media/state').json()['fully_done']==0
    assert worker.tick() and not worker.tick()
    state=client.get('/api/media/state?after=0').json()
    assert state['fully_done']==1 and len(state['completion_events'])==1
    assert all(state['completion_events'][0]['steps'][s]=='done' for s in ('style','topic'))
    assert state['completion_events'][0]['photography_enabled']
    result=client.get('/api/assets/'+row['id']+'/analysis').json()['photography']
    assert result['data']['style']['labels'][0]['label']=='极简留白'
    assert result['data']['calibrated'] is False
    inspect=client.get('/api/assets/'+row['id']+'/inspection',params={'revision':row['revision']}).json()
    assert inspect['photography']==result
    assert remote.calls==before
    with db.connect() as c:
        assert dict(c.execute("SELECT * FROM analysis WHERE provider='visual'").fetchone())==original_visual
        assert c.execute('SELECT updated FROM media_info').fetchone()[0]==media_updated
    # A taxonomy upgrade touches this analysis only, preserving human edits and other models.
    client.post('/api/assets/'+row['id']+'/curation',json={'pinned':True})
    upgraded=FakePhotography();upgraded.version='photography-fixture-v2'
    worker=PhotographyWorker(db,upgraded)
    assert 'photography' not in client.get('/api/assets/'+row['id']+'/analysis').json()
    assert client.get('/api/media/state').json()['fully_done']==0
    assert worker.tick();assert client.get('/api/media/state').json()['fully_done']==1
    assert remote.calls==before
    with db.connect() as c:assert c.execute('SELECT pinned FROM curation').fetchone()[0]==1


def test_photography_failure_pause_retry_and_directory_error(system,monkeypatch):
    row=seed(system);app,client,remote,sid=system;db=app.state.db
    monkeypatch.setenv('MUSEUM_PHOTOGRAPHY_ENABLED','1')
    class Broken(FakePhotography):
        def analyze(self,*args,**kwargs):raise ValueError('synthetic failure')
    worker=PhotographyWorker(db,Broken())
    client.post('/api/media/control',json={'action':'pause'});assert not worker.tick()
    client.post('/api/media/control',json={'action':'resume'});assert worker.tick() and not worker.tick()
    state=client.get('/api/media/state').json();assert state['error_count']==1 and state['errors'][0]['stage']=='photography'
    dirs=client.get('/api/media/directories').json();assert next(r for r in dirs['items'] if r['path']==EVENT)['status']=='failed'
    client.post('/api/media/control',json={'action':'retry'})
    worker.provider=FakePhotography();assert worker.tick()
    assert client.get('/api/media/state').json()['error_count']==0


def test_changed_preview_cannot_publish_stale_semantics(system,monkeypatch):
    row=seed(system);app,client,remote,sid=system;db=app.state.db
    monkeypatch.setenv('MUSEUM_PHOTOGRAPHY_ENABLED','1')
    class ChangesPreview(FakePhotography):
        def analyze(self,*args,**kwargs):
            with db.connect() as c:c.execute('UPDATE media_info SET updated=updated+1')
            return super().analyze(*args,**kwargs)
    worker=PhotographyWorker(db,ChangesPreview());assert worker.tick()
    with db.connect() as c:assert not c.execute("SELECT 1 FROM analysis WHERE provider='photography'").fetchone()
    worker.provider=FakePhotography();assert worker.tick()
    with db.connect() as c:
        data=json.loads(c.execute('SELECT data_json FROM media_info').fetchone()[0]);data['version']='different-preview'
        c.execute('UPDATE media_info SET data_json=?',(json.dumps(data),))
    assert 'photography' not in client.get('/api/assets/'+row['id']+'/analysis').json()


def test_directory_waits_for_photography_and_metadata_only_video_skips(system,monkeypatch):
    app,client,remote,sid=system;db=app.state.db
    newer=ROOT+'/2026-10-new';older=ROOT+'/2024-10-old'
    remote.entries={ROOT:None,newer:None,older:None,newer+'/one.jpg':jpeg(),older+'/video.mp4':b'never get'}
    scan(app,client,sid);monkeypatch.setenv('MUSEUM_PHOTOGRAPHY_ENABLED','1')
    photo=PhotographyWorker(db,FakePhotography());media=MediaWorker(db)
    assert media.tick() and not media.tick()
    assert photo.tick()
    before=len([c for c in remote.calls if c[0]=='GET'])
    assert media.tick() and not photo.tick()
    assert len([c for c in remote.calls if c[0]=='GET'])==before
    state=client.get('/api/media/state').json();assert state['fully_done']==2


def test_missing_cached_previews_never_schedule_nas_download(system,monkeypatch):
    row=seed(system);app,client,remote,sid=system;db=app.state.db
    monkeypatch.setenv('MUSEUM_PHOTOGRAPHY_ENABLED','1')
    with db.connect() as c:
        for r in c.execute('SELECT path FROM cache_files'):(db.directory/'cache'/r[0]).unlink()
    before=list(remote.calls);worker=PhotographyWorker(db,FakePhotography())
    assert worker.tick() and not worker.tick()
    assert remote.calls==before
    with db.connect() as c:
        assert c.execute('SELECT status FROM media_jobs').fetchone()[0]=='ready'
        assert json.loads(c.execute("SELECT data_json FROM analysis WHERE provider='photography'").fetchone()[0])['error']=='preview_cache_missing'
