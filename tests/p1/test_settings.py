import json
from .test_service import system,source,scan
from .test_exhibitions import seed
from photo_museum.analysis_worker import AnalysisWorker
from photo_museum.preferences import geography_version,load_preferences
from .test_delivery import FakeProvider


def save(client,**changes):
    p=client.get('/api/preferences').json()
    return client.put('/api/preferences',json=p|changes)


def test_preferences_guard_and_no_source_or_media_side_effects(system):
    app,client,remote,sid=system
    before=list(remote.calls);s=source(app,sid)
    p=client.get('/api/preferences').json()
    assert p['original_loading']=='auto' and p['hdr_display']=='sdr' and p['revision']==0
    r=save(client,original_loading='on_demand',hdr_display='native_if_supported')
    assert r.status_code==200 and r.json()['revision']==1
    assert client.put('/api/preferences',json=p).status_code==409
    for change in ({'gps_max_distance_km':0},{'hdr_display':'fake'},{'api_key':'secret'},{'gps_mode':'online'}):
        assert save(client,**change).status_code==422
    assert source(app,sid)==s and remote.calls==before
    with app.state.db.connect() as c:assert c.execute('SELECT count(*) FROM media_jobs').fetchone()[0]==0
    client.post('/api/logout',json={})
    for path in ('/api/settings','/api/preferences'):assert client.get(path).status_code==401
    assert client.put('/api/preferences',json=p).status_code==401
    assert client.post('/api/settings/geography/refresh',json={}).status_code==401


def test_sources_blank_secret_and_immutable_identity(system):
    app,client,remote,sid=system;before=list(remote.calls);old=source(app,sid)
    overview=client.get('/api/settings')
    assert overview.status_code==200 and 'fixture-only' not in overview.text
    assert 'secret' not in overview.json()['sources'][0]
    body={'name':'Renamed','username':old['username'],'password':'','ca_pem':None}
    assert client.put('/api/settings/sources/'+sid,json=body).status_code==200
    new=source(app,sid)
    assert new['name']=='Renamed' and new['url']==old['url'] and new['root']==old['root']
    assert app.state.security.decrypt(new['secret'])=='fixture-only'
    for key in ('url','root'):
        assert client.put('/api/settings/sources/'+sid,json=body|{key:'/other'}).status_code==422
    assert client.put('/api/settings/sources/missing',json=body).status_code==404
    assert remote.calls==before


def test_gps_policy_recomputes_local_without_get_or_deleting_facts(system,monkeypatch,tmp_path):
    current,_=seed(system);app,client,remote,sid=system;db=app.state.db
    row=current[0];db.set_metadata(row['id'],'gps',{'latitude':43.4,'longitude':83.2},'observed',row['revision'],'fixture')
    class Geo:
        version='geo-fixture';id='places'
        def reverse(self,gps,max_distance_m=100000):
            return {'status':'unknown','distance_m':50000} if max_distance_m<50000 else {'country':'China','country_code':'CN','city':'Xinyuan','distance_m':50000,'precision':'nearest_city'}
    worker=AnalysisWorker(db,FakeProvider());worker.geo=Geo();before=list(remote.calls)
    assert worker.geocode_one()
    assert client.get('/api/exhibitions/map').json()['count']==1
    assert save(client,gps_mode='disabled').status_code==200
    assert not worker.geocode_one()
    assert client.get('/api/exhibitions/map').json()['count']==1
    assert save(client,gps_max_distance_km=10).status_code==200
    assert client.get('/api/exhibitions/map').json()['count']==0
    assert save(client,gps_mode='offline').status_code==200
    assert worker.geocode_one() and not worker.geocode_one()
    with db.connect() as c:
        a=c.execute("SELECT * FROM analysis WHERE asset_id=? AND provider='places'",(row['id'],)).fetchone()
        assert json.loads(a['data_json'])['status']=='unknown'
        assert c.execute("SELECT count(*) FROM metadata WHERE asset_id=? AND field='gps'",(row['id'],)).fetchone()[0]==1
    assert geography_version('base',load_preferences(db))!='base'
    assert save(client,gps_max_distance_km=100).status_code==200
    assert geography_version('base',load_preferences(db))=='base'
    assert worker.geocode_one()
    assert client.get('/api/exhibitions/map').json()['count']==1
    assert remote.calls==before
    assert client.post('/api/settings/geography/refresh',json={}).status_code==409
    models=tmp_path/'models'/'geonames';models.mkdir(parents=True)
    for name in ('cities15000.zip','admin1.txt','countries.txt'):(models/name).touch()
    monkeypatch.setenv('MUSEUM_MODELS',str(models.parent));monkeypatch.setenv('MUSEUM_ANALYSIS_ENABLED','1')
    assert client.post('/api/settings/geography/refresh',json={}).json()['queued']
    assert client.get('/api/settings').json()['geography']['awaiting_worker']
    assert worker.geocode_one()
    assert remote.calls==before


def test_inferred_gps_policy_filters_all_read_models(system):
    current,_=seed(system);app,client,remote,sid=system;db=app.state.db
    donor,target=current[:2]
    db.set_metadata(donor['id'],'gps',{'latitude':43.4,'longitude':83.2},'observed',donor['revision'],'fixture')
    record=db.effective(donor['id'])['gps']['record_id']
    db.set_metadata(target['id'],'gps',{'latitude':43.4,'longitude':83.2},'inferred',target['revision'],'fixture',donors=[(donor['id'],donor['revision'],record)])
    suggestion=next(x for x in client.get('/api/assets/'+target['id']+'/suggestions').json()['items'] if x['field']=='gps')
    client.post(f"/api/assets/{target['id']}/suggestions/{suggestion['record_id']}/accept",json={}).raise_for_status()
    gps=db.effective(target['id'])['gps']
    with db.connect() as c:c.execute('INSERT OR REPLACE INTO analysis VALUES(?,?,?,?,?,?)',(target['id'],target['revision'],'places','fixture',json.dumps({'country':'China','country_code':'CN','city':'Xinyuan','input_record':gps['record_id']}),0))
    assert client.get('/api/exhibitions/map').json()['count']==1
    assert save(client,gps_use_inferred=False).status_code==200
    assert client.get('/api/exhibitions/map').json()['count']==0
    assert not client.get('/api/assets/'+target['id']+'/analysis').json().get('places')
    with db.connect() as c:assert c.execute("SELECT count(*) FROM analysis WHERE provider='places'").fetchone()[0]==1
