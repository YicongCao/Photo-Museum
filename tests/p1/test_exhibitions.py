import json
from photo_museum.media_worker import MediaWorker
from photo_museum.analysis_worker import AnalysisWorker
from .test_service import system,scan
from .test_media import jpeg
from .test_delivery import FakeProvider
from .fixture import ROOT,EVENT


def seed(system):
    app,client,remote,sid=system
    annual=ROOT+'/2023-年度'
    remote.entries={ROOT:None,EVENT:None,annual:None,**{EVENT+f'/{n}.jpg':jpeg() for n in range(4)},annual+'/annual.jpg':jpeg()}
    scan(app,client,sid);worker=MediaWorker(app.state.db)
    while worker.tick():pass
    while AnalysisWorker(app.state.db,FakeProvider()).tick():pass
    with app.state.db.connect() as c:rows=[dict(r) for r in c.execute('SELECT * FROM entries WHERE is_dir=0 ORDER BY path')]
    current=[r for r in rows if r['parent']==EVENT]
    db=app.state.db
    for row,value in zip(current,['2024:10:05 10:00:00','2024:10:07 11:00:00',None]):
        db.set_metadata(row['id'],'captured_at',value,'manual')
    return current,rows


def test_calendar_day_month_year_precision_and_local_only(system):
    current,rows=seed(system);app,client,remote,sid=system;before=list(remote.calls)
    result=client.get('/api/exhibitions/calendar',params={'anchor':'2024-10','scale':'month'}).json()
    assert len(result['cells'])==42 and result['period_unknown']==1
    assert next(c for c in result['cells'] if c['period']=='2024-10-05')['count']==1
    assert next(c for c in result['cells'] if c['period']=='2024-10-01')['count']==0
    year=client.get('/api/exhibitions/calendar?anchor=2023&scale=year').json()
    assert all(c['count']==0 for c in year['cells']) and year['period_unknown']==1
    assert result['unknown']==1
    week=client.get('/api/exhibitions/calendar?anchor=2024-10-05&scale=week').json()
    assert len(week['cells'])==7 and week['cells'][0]['period']=='2024-09-30'
    photos=client.get('/api/exhibitions/photos?day=2024-10-05').json()
    assert len(photos['items'])==1 and photos['items'][0]['id']==current[0]['id']
    assert client.get('/api/exhibitions/photos?month=2024-10&undated=period').json()['total']==1
    assert client.get('/api/exhibitions/photos?undated=all').json()['total']==3
    assert remote.calls==before
    assert client.get('/api/exhibitions/calendar?anchor=2024-02-30').status_code==422
    assert client.get('/api/exhibitions/photos?day=2024-02-30').status_code==422
    assert client.get('/api/exhibitions/photos?limit=10000').status_code==422
    client.post('/api/logout',json={})
    assert client.get('/api/exhibitions/calendar').status_code==401
    assert client.get('/api/exhibitions/photos').status_code==401


def test_exhibition_exclusions_and_manual_null(system):
    current,rows=seed(system);app,client,remote,sid=system;db=app.state.db
    with db.connect() as c:
        c.execute('UPDATE entries SET scope_excluded=1 WHERE id=?',(current[0]['id'],))
        c.execute('UPDATE entries SET missing=1 WHERE id=?',(current[1]['id'],))
        c.execute('INSERT OR REPLACE INTO curation VALUES(?,?,?,?)',(current[3]['id'],0,1,0))
    photos=client.get('/api/exhibitions/photos').json()
    assert photos['total']==2
    unknown=client.get('/api/exhibitions/photos?undated=unknown').json()
    assert unknown['total']==1 and unknown['items'][0]['id']==current[2]['id']


def test_map_hierarchy_stale_place_and_missing_gps(system):
    current,rows=seed(system);app,client,remote,sid=system;db=app.state.db
    for i,row in enumerate(current[:2]):
        db.set_metadata(row['id'],'gps',{'latitude':43.4,'longitude':83.2},'observed',row['revision'],'map-fixture')
        gps=db.effective(row['id'])['gps']
        place={'country':'China','country_code':'CN','province':'Xinjiang','city':'Xinyuan','geonames_id':'1529046','precision':'nearest_city','input_record':gps['record_id'] if i==0 else 'stale'}
        with db.connect() as c:c.execute('INSERT OR REPLACE INTO analysis VALUES(?,?,?,?,?,?)',(row['id'],row['revision'],'places','fixture',json.dumps(place),0))
    before=list(remote.calls)
    result=client.get('/api/exhibitions/map').json()
    assert result['count']==1 and result['unresolved']==1 and result['missing_gps']==3
    assert result['groups'][0]['label']=='中国'
    assert result['groups'][0]['longitude']==83.2
    ids=[]
    for level in ('province','city','activities'):
        pid=result['groups'][0]['id'];ids.append(pid)
        result=client.get('/api/exhibitions/map',params={'parent':pid}).json()
        assert result['level']==level
    found=client.get('/api/exhibitions/photos',params={'place':ids[-1],'activity':result['groups'][0]['id']}).json()
    assert found['total']==1
    assert remote.calls==before


def test_equipment_model_stats_pins_and_no_rescrape(system):
    current,rows=seed(system);app,client,remote,sid=system;db=app.state.db
    for i,row in enumerate(current):
        for field,value in [('camera','ILCE-7CR' if i<3 else 'X-T50'),('make','SONY' if i<3 else 'FUJIFILM'),('lens','FE 50mm F1.4 GM' if i<3 else '17-70mm'),('focal_length',50 if i<3 else 35)]:
            db.set_metadata(row['id'],field,value,'observed',row['revision'],'gear-fixture')
    client.post('/api/assets/'+current[0]['id']+'/curation',json={'pinned':True})
    before=list(remote.calls)
    gear=client.get('/api/exhibitions/gear').json()['devices']
    sony=next(d for d in gear if d['model']=='ILCE-7CR')
    assert sony['count']==3 and sony['pinned']==1 and sony['name']=='SONY ILCE-7CR'
    detail=client.get('/api/exhibitions/gear/'+sony['id']).json()
    assert detail['count']==3 and detail['years']==[{'year':2024,'count':2}]
    assert detail['date_unknown']==1 and detail['focal']==[{'label':'50–84','count':3}]
    pinned=client.get('/api/exhibitions/gear/'+sony['id']+'?pinned=true').json()
    assert pinned['count']==1
    assert client.get('/api/exhibitions/photos',params={'camera':sony['id']}).json()['total']==3
    assert len(client.get('/api/exhibitions/gear?kind=lens').json()['devices'])==3
    assert remote.calls==before


def test_review_and_manual_changes_invalidate_cached_exhibitions(system):
    current,rows=seed(system);app,client,remote,sid=system;db=app.state.db
    donor,target=current[0],current[3]
    db.set_metadata(donor['id'],'captured_at','2024-10-06T12:00:00','observed',donor['revision'],'fixture')
    with db.connect() as c:
        record=c.execute("SELECT record_id FROM metadata WHERE asset_id=? AND field='captured_at' AND layer='observed'",(donor['id'],)).fetchone()[0]
    db.set_metadata(target['id'],'captured_at','2024-10-06T12:01:00','inferred',target['revision'],'fixture',
                    donors=[(donor['id'],donor['revision'],record)])
    before=list(remote.calls)
    assert client.get('/api/exhibitions/photos?day=2024-10-06').json()['total']==0
    suggestion=next(x for x in client.get('/api/assets/'+target['id']+'/suggestions').json()['items'] if x['field']=='captured_at')
    client.post(f"/api/assets/{target['id']}/suggestions/{suggestion['record_id']}/accept",json={}).raise_for_status()
    found=client.get('/api/exhibitions/photos?day=2024-10-06').json()
    assert found['total']==1 and found['items'][0]['date_estimated'] is True
    client.post('/api/assets/'+target['id']+'/metadata',json={'field':'captured_at','value':'2024-10-09T12:00:00'}).raise_for_status()
    assert client.get('/api/exhibitions/photos?day=2024-10-06').json()['total']==0
    assert client.get('/api/exhibitions/photos?day=2024-10-09').json()['total']==1
    client.post('/api/assets/'+target['id']+'/curation',json={'excluded':True}).raise_for_status()
    assert client.get('/api/exhibitions/photos?day=2024-10-09').json()['total']==0
    assert remote.calls==before


def test_root_photo_activity_identity_and_small_projection(system):
    app,client,remote,sid=system
    remote.entries={ROOT:None,ROOT+'/root.jpg':jpeg()}
    scan(app,client,sid)
    while MediaWorker(app.state.db).tick():pass
    photo=client.get('/api/exhibitions/photos').json()['items'][0]
    activity=client.get('/api/gallery').json()['activities'][0]
    assert photo['activity_id']==activity['id']
    assert photo['period'] is None and photo['camera_id']=='camera-unknown'
    assert set(photo['info'])=={'width','height','version','hdr_policy'}
    assert photo['info']['width']==240 and photo['info']['height']==160
