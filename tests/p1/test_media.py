import io
import json
from PIL import Image,ImageCms
from photo_museum.media_worker import MediaWorker
from photo_museum.cache import Cache
from photo_museum.inference import infer_directory
from .test_service import system,scan
from .fixture import ROOT,EVENT

def jpeg():
    out=io.BytesIO()
    image=Image.new('RGB',(240,160),'#ba8341')
    image.save(out,'JPEG',icc_profile=ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes())
    return out.getvalue()

def test_media_pipeline_pause_cache_and_auth(system):
    app,client,remote,sid=system
    remote.entries={ROOT:None,EVENT:None,EVENT+'/IMG_001.jpg':jpeg()}
    scan(app,client,sid)
    worker=MediaWorker(app.state.db)
    client.post('/api/media/control',json={'action':'pause'})
    assert not worker.tick()
    client.post('/api/media/control',json={'action':'resume'})
    assert worker.tick()
    state=client.get('/api/media/state').json()
    assert state['counts']=={'ready':1},state
    gallery=client.get('/api/gallery').json()['activities']
    assert len(gallery)==1 and gallery[0]['selected']==[]
    a=client.get('/api/gallery/'+gallery[0]['id']).json()['items'][0]
    assert client.get(a['thumbnail']).status_code==200
    m=client.get('/api/assets/'+a['id']+'/manifest').json()
    assert m['preview'] and m['effective_metadata']['width']['layer']=='observed'
    assert client.get(a['thumbnail'].replace(a['revision'],'wrong')).status_code==409
    client.post('/api/assets/'+a['id']+'/curation',json={'pinned':True})
    assert client.get('/api/gallery/'+gallery[0]['id']).json()['items'][0]['pinned']
    client.post('/api/logout',json={})
    assert client.get(a['thumbnail']).status_code==401
    assert client.get('/api/gallery').status_code==401

def test_bad_media_isolated_and_retry(system):
    app,client,remote,sid=system
    remote.entries={ROOT:None,EVENT:None,EVENT+'/bad.jpg':b'bad',EVENT+'/good.jpg':jpeg()}
    scan(app,client,sid)
    worker=MediaWorker(app.state.db)
    assert worker.tick() and worker.tick()
    state=client.get('/api/media/state').json()
    assert state['counts'].get('failed')==1 and state['counts'].get('ready')==1,state
    client.post('/api/media/control',json={'action':'retry'})
    assert client.get('/api/media/state').json()['counts']['pending']==1

def test_sequence_inference_provenance_and_conflict(system):
    app,client,remote,sid=system
    remote.entries={ROOT:None,EVENT:None,**{EVENT+f'/IMG_{i:04}.jpg':jpeg() for i in (1,2,3)}}
    scan(app,client,sid)
    db=app.state.db
    with db.connect() as c:
        rows=[dict(r) for r in c.execute('SELECT * FROM entries WHERE is_dir=0 ORDER BY path')]
    for i,r in enumerate(rows):
        db.record_extraction(r['id'],r['revision'],'extracted','test')
        db.set_metadata(r['id'],'camera','fixture','observed',r['revision'])
        if i!=1:
            for field,value in [('captured_at',f'2024:10:10 12:00:0{i}'),('gps',{'latitude':31,'longitude':121+i*.0001})]:
                db.set_metadata(r['id'],field,value,'observed',r['revision'])
    infer_directory(db,sid,EVENT)
    value=db.effective(rows[1]['id'])
    assert value['gps']['is_estimated'] and value['gps']['precision']=='area'
    assert value['captured_at']['value']=='2024-10-10'
    assert 'iso' not in value
    db.set_metadata(rows[1]['id'],'gps',None,'manual')
    infer_directory(db,sid,EVENT)
    assert db.effective(rows[1]['id'])['gps']['value'] is None
    db.set_metadata(rows[0]['id'],'gps',{'latitude':20,'longitude':110},'observed',rows[0]['revision'])
    infer_directory(db,sid,EVENT)
    with db.connect() as c:
        assert c.execute("SELECT stale FROM metadata WHERE asset_id=? AND field='gps' AND layer='inferred'",(rows[1]['id'],)).fetchone()[0]==1
