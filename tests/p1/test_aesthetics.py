import json
from photo_museum.aesthetics_worker import AestheticsWorker
from photo_museum.exhibitions import ExhibitionCatalog
from photo_museum.curator_tools import Filters,LocalTools
from .test_service import system,scan
from .test_photography import seed
from .test_delivery import FakeProvider
from .test_media import jpeg
from .fixture import ROOT,EVENT
from photo_museum.media_worker import MediaWorker
from photo_museum.analysis_worker import AnalysisWorker


class FakeAesthetics:
    id='aesthetics';version='aesthetics-fixture-v1'
    def analyze(self,path,progress=lambda *a:None):
        assert path.name=='display.webp'
        progress('aesthetic','done')
        return {'score':6.75,'nominal_scale':10,'calibrated_for_owner':False,'offline':True}


def test_backfill_uses_display_preserves_other_analysis_and_publishes_completion(system,monkeypatch):
    row=seed(system);app,client,remote,_=system;db=app.state.db
    monkeypatch.setenv('MUSEUM_ANALYSIS_ENABLED','1');monkeypatch.setenv('MUSEUM_AESTHETICS_ENABLED','1')
    with db.connect() as c:
        original=[tuple(r) for r in c.execute("SELECT * FROM analysis WHERE provider!='aesthetics'")]
        original_media=[tuple(r) for r in c.execute('SELECT * FROM media_info')]
    client.post('/api/assets/'+row['id']+'/curation',json={'pinned':True})
    worker=AestheticsWorker(db,FakeAesthetics());before=list(remote.calls)
    assert client.get('/api/media/state').json()['fully_done']==0
    assert client.get('/api/gallery').json()['activities'][0]['selection_policy']=='technical-top10-backfill'
    assert worker.tick() and not worker.tick()
    state=client.get('/api/media/state?after=0').json()
    assert state['fully_done']==1 and state['completion_events'][0]['steps']['aesthetic']=='done'
    g=client.get('/api/gallery').json()['activities'][0]
    assert g['selection_policy']=='aesthetic-top10' and g['selected'][0]['score']==6.75
    assert g['selected'][0]['technical_score']==70 and g['selected'][0]['pinned']
    assert client.get('/api/assets/'+row['id']+'/analysis').json()['aesthetics']['data']['score']==6.75
    inspection=client.get('/api/assets/'+row['id']+'/inspection',params={'revision':row['revision']}).json()
    assert inspection['aesthetics']['data']['score']==6.75 and inspection['score']==70
    assert remote.calls==before
    with db.connect() as c:
        assert [tuple(r) for r in c.execute("SELECT * FROM analysis WHERE provider!='aesthetics'")]==original
        assert [tuple(r) for r in c.execute('SELECT * FROM media_info')]==original_media
    photos=ExhibitionCatalog(db).photos()
    assert photos[0]['score']==6.75 and photos[0]['technical_score']==70
    tools=LocalTools(db,ExhibitionCatalog(db),'test-run')
    photo=tools.load()[0]
    assert tools.matches(photo,Filters(min_score=65,min_aesthetic_score=6.5))
    assert not tools.matches(photo,Filters(min_score=80))
    assert not tools.matches(photo,Filters(min_aesthetic_score=7))


def test_pause_missing_display_failure_retry_no_thumb_or_nas_fallback(system,monkeypatch):
    row=seed(system);app,client,remote,_=system;db=app.state.db
    monkeypatch.setenv('MUSEUM_AESTHETICS_ENABLED','1');worker=AestheticsWorker(db,FakeAesthetics())
    client.post('/api/media/control',json={'action':'pause'});assert not worker.tick()
    with db.connect() as c:
        path=db.directory/'cache'/c.execute("SELECT path FROM cache_files WHERE profile='display'").fetchone()[0]
    saved=path.read_bytes();path.unlink();before=list(remote.calls)
    client.post('/api/media/control',json={'action':'resume'})
    assert worker.tick() and not worker.tick()
    state=client.get('/api/media/state').json()
    assert state['error_count']==1 and state['errors'][0]['stage']=='aesthetics'
    assert next(r for r in client.get('/api/media/directories').json()['items'] if r['path']==EVENT)['status']=='failed'
    assert remote.calls==before
    path.write_bytes(saved)
    with db.connect() as c:worker.cache.register(c,row['id'],row['revision'],'display',path)
    client.post('/api/media/control',json={'action':'retry'})
    assert worker.tick() and client.get('/api/media/state').json()['error_count']==0


def test_preview_race_and_version_change_reject_old_scores(system,monkeypatch):
    row=seed(system);app,client,remote,_=system;db=app.state.db
    monkeypatch.setenv('MUSEUM_AESTHETICS_ENABLED','1')
    class Changes(FakeAesthetics):
        def analyze(self,*args,**kwargs):
            with db.connect() as c:c.execute('UPDATE media_info SET updated=updated+1')
            return super().analyze(*args,**kwargs)
    worker=AestheticsWorker(db,Changes());assert worker.tick()
    with db.connect() as c:assert not c.execute("SELECT 1 FROM analysis WHERE provider='aesthetics'").fetchone()
    worker.provider=FakeAesthetics();assert worker.tick()
    newer=FakeAesthetics();newer.version='aesthetics-fixture-v2';worker=AestheticsWorker(db,newer)
    assert 'aesthetics' not in client.get('/api/assets/'+row['id']+'/analysis').json()
    assert client.get('/api/gallery').json()['activities'][0]['selection_policy']=='technical-top10-backfill'
    assert worker.tick()


def test_activity_switches_only_when_all_photos_are_scored(system,monkeypatch):
    app,client,remote,sid=system;db=app.state.db
    remote.entries={ROOT:None,EVENT:None,EVENT+'/a.jpg':jpeg(),EVENT+'/z.jpg':jpeg()}
    scan(app,client,sid);media=MediaWorker(db);visual=AnalysisWorker(db,FakeProvider())
    while media.tick():pass
    while visual.tick():pass
    monkeypatch.setenv('MUSEUM_AESTHETICS_ENABLED','1');worker=AestheticsWorker(db,FakeAesthetics())
    assert worker.tick()
    g=client.get('/api/gallery').json()['activities'][0]
    assert g['aesthetic_pending']==1 and {p['score'] for p in g['selected']}=={70}
    assert worker.tick()
    g=client.get('/api/gallery').json()['activities'][0]
    assert g['aesthetic_pending']==0 and {p['score'] for p in g['selected']}=={6.75}
