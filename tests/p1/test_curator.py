import asyncio,json,time
import httpx,pytest
from .test_service import system
from .test_exhibitions import seed
from .curator_fixture import FakeLLM,Events
from photo_museum.curator_tools import LocalTools,Filters
from photo_museum.curator_provider import ProviderInput,save_config,load_config,completion,ProviderError
from photo_museum.curator import Curator


def configure(app):
    save_config(app.state.db,app.state.security,ProviderInput(api_key='fake-provider-key'))


def wait(client,rid):
    end=time.monotonic()+12
    while time.monotonic()<end:
        r=client.get('/api/curator/runs/'+rid).json()
        if r['status'] in ('completed','failed','cancelled','interrupted'):return r
        time.sleep(.03)
    raise AssertionError('Run did not settle')


def test_config_secret_auth_and_invalid_endpoint(system):
    app,client,remote,sid=system
    assert client.put('/api/curator/provider',json={'api_key':'fake-provider-key'}).status_code==200
    text=client.get('/api/curator/provider').text
    assert 'fake-provider-key' not in text and 'api_key' not in text
    assert 'fake-provider-key' not in app.state.db.path.read_bytes().decode(errors='ignore')
    assert load_config(app.state.db,app.state.security,True)['api_key']=='fake-provider-key'
    assert client.put('/api/curator/provider',json={'base_url':'https://other.example/v1'}).status_code==400
    assert client.put('/api/curator/provider',json={'base_url':'http://evil.test','api_key':'x'}).status_code==400
    assert client.put('/api/curator/provider',json={'base_url':'https://name:password@example.test/v1'}).status_code==400
    assert client.put('/api/curator/provider',json={'api_key':'sensitive','temperature':99}).status_code==422
    client.post('/api/logout',json={})
    for url in ('/api/curator/provider','/api/curator/runs','/api/curator/runs/a/stream','/api/curator/exhibitions/a/exhibitions/map'):
        assert client.get(url).status_code==401
    assert client.post('/api/curator/runs',json={'prompt':'test'}).status_code==401


def test_agent_stream_tools_prepare_scopes_and_zero_nas(system):
    rows,_=seed(system);app,client,remote,sid=system;configure(app);fake=FakeLLM();app.state.curator.transport=httpx.MockTransport(fake);before=list(remote.calls)
    with client:
        r=client.post('/api/curator/runs',json={'prompt':'整理2024年照片','room':'map'});assert r.status_code==200
        rid=r.json()['id'];run=wait(client,rid);assert run['status']=='completed',run
        assert run['exhibition_id']
        eid=run['exhibition_id'];scope=client.get('/api/curator/exhibitions/'+eid).json();assert scope['room']=='map' and scope['count']==3
        events=client.get(f'/api/curator/runs/{rid}/events').json()['items'];kinds=[e['kind'] for e in events]
        assert all(k in kinds for k in ('thinking','tool_start','tool_end','answer','preparation','done'))
        prep=[e['data'] for e in events if e['kind']=='preparation'];assert prep[0]['checked']==0 and prep[-1]['checked']==prep[-1]['total']==3
        assert len(fake.requests)==5 and fake.requests[0]['thinking']=={'type':'enabled'}
        assert fake.requests[0]['reasoning_effort']=='high' and fake.requests[0]['temperature']==1.1
        assert 'reasoning_content' in fake.requests[1]['messages'][-2]
        ids={p['id'] for p in client.get('/api/curator/exhibitions/'+eid+'/exhibitions/photos').json()['items']}
        assert len(ids)==3 and rows[2]['id'] not in ids # manual null date is not 2024.
        assert client.get('/api/curator/exhibitions/'+eid+'/exhibitions/calendar?anchor=2023').json()['total']==3
        groups=client.get('/api/curator/exhibitions/'+eid+'/gallery').json()['activities'];assert sum(g['photos'] for g in groups)==3
        for g in groups:assert {p['id'] for p in g['selected']}<=ids
        client.post('/api/assets/'+next(iter(ids))+'/curation',json={'excluded':True})
        assert client.get('/api/curator/exhibitions/'+eid).json()['count']==2
        assert remote.calls==before
        stream=client.get(f'/api/curator/runs/{rid}/stream').text;assert 'event: settled' in stream and 'tool_start' in stream
        outbound=json.dumps([m for req in fake.requests for m in req['messages'] if m['role']=='tool'])
        assert all(x not in outbound for x in ('thumbnail','latitude','longitude','embedding','people_terms','root.jpg'))


def test_local_tools_boundaries_unknown_and_personal_data(system):
    rows,_=seed(system);app,client,remote,sid=system;local=LocalTools(app.state.db,app.state.exhibitions,'seed-run')
    found=local.dispatch('search_photos',{'filters':{'years':[2024]},'limit':1});assert found['total']==3
    local.dispatch('photo_details',{'photo_ids':[found['items'][0]['id']]})
    with pytest.raises(ValueError):local.dispatch('execute_sql',{'sql':'delete from entries'})
    with pytest.raises(ValueError):local.dispatch('search_photos',{'filters':{'date_from':'2024-02-30'}})
    with pytest.raises(ValueError):local.dispatch('photo_details',{'photo_ids':['made-up']})
    with pytest.raises(ValueError):local.dispatch('create_exhibition',{'title':'x','search_id':found['search_id'],'photo_ids':['made-up']})
    assert local.dispatch('search_photos',{'filters':{'months':[1]}})['total']==0
    assert local.dispatch('search_photos',{'filters':{'date_from':'2024-10-01','date_to':'2024-10-31'}})['total']==2
    assert local.dispatch('search_photos',{'filters':{'query':"'; DROP TABLE entries; --"}})['total']==0
    assert local.dispatch('search_photos',{'filters':{'topic':['不存在的标签']}})['total']==0
    draft=local.dispatch('create_exhibition',{'title':'x','search_id':found['search_id'],'room':'calendar'});assert draft['count']==3


def test_cancel_and_provider_errors_never_auto_retry(system):
    app,client,remote,sid=system;configure(app);fake=FakeLLM();app.state.curator.transport=httpx.MockTransport(fake)
    with client:
        rid=client.post('/api/curator/runs',json={'prompt':'slow'}).json()['id']
        assert client.post('/api/curator/runs',json={'prompt':'duplicate'}).status_code==409
        assert client.put('/api/curator/provider',json={'api_key':'changed'}).status_code==409
        assert client.post(f'/api/curator/runs/{rid}/cancel',json={}).json()['status']=='cancelled'
        assert not client.get(f'/api/curator/runs/{rid}').json()['exhibition_id']
        fake.bad_status=429
        rid=client.post('/api/curator/runs',json={'prompt':'retry once manually'}).json()['id'];run=wait(client,rid)
        assert run['status']=='failed' and '429' not in run['error'] and '配额' in run['error']
        assert 'fake-provider-key' not in client.get(f'/api/curator/runs/{rid}/events').text


def test_restart_marks_interrupted_and_empty_search_is_not_relaxed(system):
    app,client,remote,sid=system;configure(app);fake=FakeLLM();app.state.curator.transport=httpx.MockTransport(fake)
    with client:
        rid=client.post('/api/curator/runs',json={'prompt':'空结果'}).json()['id'];run=wait(client,rid)
        assert run['status']=='completed' and run['exhibition_id'] is None and '没有' in run['answer']
    with app.state.db.connect() as c:c.execute("UPDATE curator_runs SET status='running' WHERE id=?",(rid,))
    other=Curator(app.state.db,app.state.security,app.state.exhibitions)
    assert other.get_run(rid)['status']=='interrupted' and not other.tasks


def test_incomplete_sse_is_not_published_and_key_echo_is_redacted(system):
    app,client,remote,sid=system;configure(app)
    def broken(req):return httpx.Response(200,headers={'content-type':'text/event-stream'},stream=Events([{'choices':[{'delta':{'reasoning_content':'fake-provider-'}}]},{'choices':[{'delta':{'reasoning_content':'key'}}]}]))
    app.state.curator.transport=httpx.MockTransport(broken)
    with client:
        rid=client.post('/api/curator/runs',json={'prompt':'test'}).json()['id'];run=wait(client,rid)
        assert run['status']=='failed' and run['exhibition_id'] is None
        events=client.get(f'/api/curator/runs/{rid}/events').text
        assert 'fake-provider-key' not in events and '已隐藏' in events


def test_current_local_tags_and_person_match_do_not_export_identity(system):
    rows,_=seed(system);app,client,remote,sid=system;db=app.state.db;photo=rows[0]
    for field,value in [('iso',200),('aperture',1.4),('exposure',.004),('focal_length',50)]:db.set_metadata(photo['id'],field,value,'observed',photo['revision'],'p6-fixture')
    with db.connect() as c:
        media=c.execute('SELECT * FROM media_info WHERE asset_id=?',(photo['id'],)).fetchone();info=json.loads(media['data_json'])
        c.execute("INSERT OR REPLACE INTO settings VALUES('photography_version','p6-test')")
        payload={'style':{'labels':[{'id':'monochrome','label':'黑白摄影','similarity':.3}]},'topic':{'labels':[{'id':'waterscape','label':'海岸水景','similarity':.31}]},'input_media_version':info['version'],'input_preview_updated':media['updated']}
        c.execute('INSERT OR REPLACE INTO analysis VALUES(?,?,?,?,?,?)',(photo['id'],photo['revision'],'photography','p6-test',json.dumps(payload),0))
        c.execute('INSERT INTO people VALUES(?,?,?)',('person-private','私密人物名',0))
        c.execute('INSERT INTO faces VALUES(?,?,?,?,?,?,?,?)',('face-private',photo['id'],photo['revision'],'person-private','[0,0,2,2]',b'private-biometric','fixture',1))
    local=LocalTools(db,app.state.exhibitions,'tags-run')
    found=local.dispatch('search_photos',{'filters':{'style':['黑白摄影'],'topic':['waterscape'],'person':'私密人物名'}})
    assert found['total']==1
    exported=json.dumps(found,ensure_ascii=False)
    assert '私密人物名' not in exported and 'biometric' not in exported and 'box' not in exported
    assert found['items'][0]['has_people'] is True
    assert local.dispatch('search_photos',{'filters':{'iso_min':100,'iso_max':400,'aperture_max':2,'exposure_max':.01,'focal_min':50}})['total']==1
    assert local.dispatch('search_photos',{'filters':{'iso_min':800}})['total']==0
    assert local.dispatch('list_facets',{'field':'style'})['values'][0]['value']=='黑白摄影'
    with db.connect() as c:c.execute("UPDATE analysis SET version='stale' WHERE provider='photography'")
    assert LocalTools(db,app.state.exhibitions,'other').dispatch('search_photos',{'filters':{'style':['monochrome']}})['total']==0


def test_preparation_rechecks_filters_after_manual_date_change(system):
    rows,_=seed(system);app,client,remote,sid=system;db=app.state.db;local=LocalTools(db,app.state.exhibitions,'prepare-run')
    found=local.dispatch('search_photos',{'filters':{'years':[2024]}})
    local.dispatch('create_exhibition',{'title':'Only 2024','search_id':found['search_id']})
    target=found['items'][0]['id'];client.post('/api/assets/'+target+'/metadata',json={'field':'captured_at','value':'2025-10-05'})
    rid='prepare-run';now=time.time()
    with db.connect() as c:c.execute('INSERT INTO curator_runs(id,prompt,room,status,created,updated) VALUES(?,?,?,?,?,?)',(rid,'2024','wall','running',now,now))
    before=list(remote.calls);asyncio.run(app.state.curator.prepare(rid,local.draft));run=app.state.curator.get_run(rid)
    assert len(app.state.curator.scope(run['exhibition_id']).photos())==2
    progress=[x['data'] for x in app.state.curator.events(rid)['items'] if x['kind']=='preparation'][-1]
    assert progress['ready']==2 and progress['skipped']==1 and remote.calls==before
