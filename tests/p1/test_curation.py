import json
import time
import pytest
from photo_museum.media_worker import MediaWorker
from photo_museum.analysis_worker import AnalysisWorker
from photo_museum.gallery import live_pair
from photo_museum.cache import Cache,CacheFull
from .test_service import system,scan
from .test_media import jpeg
from .test_delivery import FakeProvider
from .fixture import ROOT,EVENT


def test_live_pair_identifier_not_filename_proof(system):
    app,client,remote,sid=system
    remote.entries={ROOT:None,EVENT:None,EVENT+'/one.jpg':jpeg(),EVENT+'/one.MOV':b'video'}
    scan(app,client,sid)
    db=app.state.db
    with db.connect() as c:
        entries=[dict(r) for r in c.execute('SELECT * FROM entries WHERE is_dir=0 ORDER BY kind')]
    photo,video=entries
    assert not live_pair(db,photo)['confirmed']
    for r in entries:
        db.record_extraction(r['id'],r['revision'],'extracted','fixture')
        db.set_metadata(r['id'],'content_identifier','same-live-id','observed',r['revision'])
    assert live_pair(db,photo)['confirmed']
    db.set_metadata(video['id'],'content_identifier','different-live-id','observed',video['revision'])
    assert not live_pair(db,photo)['confirmed']


class FaceProvider(FakeProvider):
    def analyze(self,path):
        result=super().analyze(path)
        result['faces']=[{'embedding':[1.,0.,0.],'box':[.2,.2,.3,.3]}]
        return result


def test_named_face_and_manual_split_survive_model_upgrade(system):
    app,client,remote,sid=system
    remote.entries={ROOT:None,EVENT:None,EVENT+'/one.jpg':jpeg()}
    scan(app,client,sid);MediaWorker(app.state.db).tick()
    worker=AnalysisWorker(app.state.db,FaceProvider());worker.tick()
    p=client.get('/api/people').json()['people'][0]
    assert client.post('/api/people/'+p['id'],json={'label':'合成测试人物'}).status_code==200
    fid=client.get('/api/people/'+p['id']+'/faces').json()['items'][0]['face_id']
    moved=client.post('/api/faces/'+fid+'/assign',json={'person_id':None}).json()['person_id']
    worker.provider.version='fixture-upgraded';worker.tick()
    assert client.get('/api/people/'+moved+'/faces').json()['items'][0]['face_id']==fid
    with app.state.db.connect() as c:
        assert c.execute('SELECT label FROM people WHERE id=?',(p['id'],)).fetchone()[0]=='合成测试人物'


def test_cache_eviction_commits_ledger_even_if_reservation_cannot_fit(system):
    app,client,remote,sid=system
    remote.entries={ROOT:None,EVENT:None,EVENT+'/one.jpg':jpeg()};scan(app,client,sid)
    db=app.state.db;cache=Cache(db)
    with db.connect() as c:
        a=dict(c.execute('SELECT * FROM entries WHERE is_dir=0').fetchone())
        path=cache.root/'synthetic.webp';path.write_bytes(b'x'*60)
        cache.register(c,a['id'],a['revision'],'display',path)
        c.execute('UPDATE cache_files SET accessed=?',(time.time()-200,))
        c.execute("UPDATE settings SET value='100' WHERE key='cache_budget'")
    with pytest.raises(CacheFull):
        with cache.writer(reserve=150):pass
    with db.connect() as c:
        assert c.execute('SELECT count(*) FROM cache_files').fetchone()[0]==0
        assert c.execute('SELECT status FROM derivatives').fetchone()[0]=='evicted'
    assert not path.exists()


def test_manual_gps_validation(system):
    app,client,remote,sid=system
    remote.entries={ROOT:None,EVENT:None,EVENT+'/one.jpg':jpeg()};scan(app,client,sid)
    aid=client.get('/api/assets').json()['items'][0]['id']
    for value in ({'latitude':91,'longitude':0},{'latitude':True,'longitude':1},'31,121'):
        assert client.post('/api/assets/'+aid+'/metadata',json={'field':'gps','value':value}).status_code==400
    assert client.post('/api/assets/'+aid+'/metadata',json={'field':'gps','value':{'latitude':0,'longitude':0}}).status_code==200
