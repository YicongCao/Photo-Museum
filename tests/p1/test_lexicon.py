"""Metadata-only canonical vocabulary, durable updates and constrained agent flow."""
import json
import pytest
from photo_museum.lexicon import Lexicon,LexiconWorker,photo_terms
from photo_museum.curator_tools import LocalTools
from .test_service import system
from .test_exhibitions import seed
from .test_creative import add_topic
from .test_curator import configure,wait

CAR='subject:n04285008'
BIKE='subject:n03792782'

def drain(db,batch=128):
    w=LexiconWorker(db);w.batch_size=batch
    for _ in range(100):
        if not w.tick():return Lexicon(db)
    raise AssertionError('Vocabulary did not settle')

def tags(db,row,items):
    with db.connect() as c:
        c.execute("UPDATE analysis SET data_json=json_set(data_json,'$.tags',json(?)) WHERE asset_id=? AND provider='visual'",(json.dumps(items),row['id']))

def place(db,row,city='Xinyuan',gid='1529046',province='Xinjiang'):
    db.set_metadata(row['id'],'gps',{'latitude':43.4,'longitude':83.2},'observed',row['revision'],'lexicon-fixture')
    gps=db.effective(row['id'])['gps']
    data={'country':'China','country_code':'CN','province':province,'city':city,'geonames_id':gid,'precision':'nearest_city','input_record':gps['record_id']}
    with db.connect() as c:c.execute('INSERT OR REPLACE INTO analysis VALUES(?,?,?,?,?,?)',(row['id'],row['revision'],'places','fixture-places',json.dumps(data),0))

def setup(system):
    current,rows=seed(system);app,client,remote,sid=system;db=app.state.db
    tags(db,current[0],[{'synset':'n04285008','label':'sports car, sport car'},{'class_index':817,'taxonomy':'imagenet1k','label':'sports car'}])
    tags(db,current[1],[{'label':'sport car'}])
    tags(db,current[2],[{'synset':'n03792782','label':'mountain bike'}])
    add_topic(db,current[0]);add_topic(db,current[2])
    place(db,current[0]);place(db,current[1]);place(db,current[2],city='同名镇',gid='synthetic-A',province='广东')
    place(db,current[3],city='同名镇',gid='synthetic-B',province='浙江')
    return current,db,drain(db)

def local(db):
    from photo_museum.exhibitions import ExhibitionCatalog
    return LocalTools(db,ExhibitionCatalog(db),'lexicon-test')

def test_canonical_aliases_domains_distinct_counts_and_zero_media_io(system):
    current,db,vocab=setup(system);app,client,remote,sid=system;before=list(remote.calls)
    # Multiple aliases/tags for one object on one photo never inflate counts.
    for q in ('跑车','SPORT CAR',' ｓｐｏｒｔｓ　ｃａｒ ','n04285008',CAR):
        result=vocab.lookup(q,['subject']);assert result['items'][0]['id']==CAR,result
        assert result['items'][0]['photo_count']==2
    term=vocab.lookup('sports car',['subject'])['items'][0]
    assert term['candidate'] and term['sources'][0]['model_version']
    assert any('imagenet1k' in a['source'] for a in term['aliases'])
    assert vocab.lookup('Xinyuan',['city'])['items'][0]['display_name']=='新源'
    assert vocab.lookup('waterscape',['topic'])['items'][0]['id']=='topic:waterscape'
    assert vocab.lookup('monochrome',['style'])['items'][0]['id']=='style:monochrome'
    assert not vocab.lookup('惠州',['city'])['items'] and not vocab.lookup('Huizhou',['city'])['items']
    assert remote.calls==before
    assert vocab.status()['pending']==0 and vocab.status()['ready']
    assert client.get('/api/lexicon?query=sport%20car').json()['items'][0]['id']==CAR


def test_disambiguation_context_counts_or_and_no_automatic_expansion(system):
    current,db,vocab=setup(system);tool=local(db)
    twins=tool.dispatch('lookup_keywords',{'query':'同名镇','domains':['city']})['items']
    assert len(twins)==2 and all(t['ambiguous'] for t in twins)
    assert {t['parents']['province'] for t in twins}=={'广东','浙江'}
    scoped=tool.dispatch('lookup_keywords',{'query':'同名镇','domains':['city'],'context':{'province':['广东']}})['items']
    assert len(scoped)==1 and scoped[0]['photo_count']==1 and not scoped[0]['ambiguous']
    search=tool.dispatch('search_photos',{'filters':{'keyword_ids':[CAR,BIKE,'topic:waterscape']}})
    assert {p['id'] for p in search['items']}=={current[0]['id'],current[2]['id']}
    assert tool.dispatch('search_photos',{'filters':{'keyword_ids':[CAR,'city:geonames:1529046']}})['total']==2
    assert tool.dispatch('search_photos',{'filters':{'keyword_ids':[CAR],'query':'mountain bike'}})['total']==0
    with pytest.raises(ValueError,match='ID'):tool.dispatch('search_photos',{'filters':{'keyword_ids':['city:imagined']}})


def test_incremental_hide_restore_delete_alias_and_transaction_rollback(system):
    current,db,vocab=setup(system);app,client,remote,sid=system;before=list(remote.calls)
    with db.connect() as c:
        count=c.execute('SELECT count(*) FROM lexicon_asset_terms').fetchone()[0]
        c.execute('INSERT OR REPLACE INTO curation VALUES(?,?,?,?)',(current[0]['id'],0,1,0))
        assert c.execute('SELECT count(*) FROM lexicon_dirty').fetchone()[0]==1
    drain(db);assert vocab.lookup('跑车',['subject'])['items'][0]['photo_count']==1
    with db.connect() as c:c.execute('UPDATE curation SET excluded=0 WHERE asset_id=?',(current[0]['id'],))
    drain(db);assert vocab.lookup('跑车',['subject'])['items'][0]['photo_count']==2
    tags(db,current[1],[{'label':'unmapped-old-tag'}]);drain(db)
    assert vocab.lookup('unmapped-old-tag',['subject'])['total']==1
    tags(db,current[1],[{'label':'unmapped-new-tag'}]);drain(db)
    assert vocab.lookup('unmapped-old-tag',['subject'])['total']==0
    assert vocab.lookup('unmapped-new-tag',['subject'])['total']==1
    with pytest.raises(RuntimeError):
        with db.connect() as c:
            c.execute('UPDATE entries SET missing=1 WHERE id=?',(current[0]['id'],));raise RuntimeError()
    assert vocab.status()['pending']==0
    with db.connect() as c:c.execute("DELETE FROM cache_files WHERE asset_id=? AND profile='display'",(current[0]['id'],))
    drain(db);assert vocab.lookup('跑车',['subject'])['total']==0
    assert remote.calls==before
    # Idling does not accumulate alias references or revision writes.
    status=vocab.status();drain(db);assert vocab.status()['revision']==status['revision']


def test_rebuild_resume_atomic_publication_and_bounded_retired_cleanup(system):
    current,db,vocab=setup(system);generation=vocab.status()['generation'];w=LexiconWorker(db);w.batch_size=1
    with db.connect() as c:c.execute("INSERT OR REPLACE INTO settings VALUES('lexicon_epoch','1')")
    assert w.tick();assert vocab.status()['building'] and vocab.status()['generation']==generation
    assert vocab.lookup('跑车',['subject'])['items'][0]['photo_count']==2
    with db.connect() as c:c.execute('INSERT OR REPLACE INTO curation VALUES(?,?,?,?)',(current[0]['id'],0,1,0))
    drain(db,batch=1);assert vocab.status()['generation']>generation and not vocab.status()['building']
    assert vocab.lookup('跑车',['subject'])['items'][0]['photo_count']==1
    for epoch in (2,3):
        with db.connect() as c:c.execute("INSERT OR REPLACE INTO settings VALUES('lexicon_epoch',?)",(str(epoch),))
        drain(db)
    for _ in range(30):w.cleanup_retired()
    with db.connect() as c:assert c.execute("SELECT count(*) FROM lexicon_generations WHERE state='retired'").fetchone()[0]==1


def test_dirty_token_cas_rejects_concurrent_stale_projection(system,monkeypatch):
    current,db,vocab=setup(system);row=current[0];tags(db,row,[{'synset':'n04285008','label':'sports car'}])
    import photo_museum.lexicon as module
    original=module.photo_terms;changed=[]
    def concurrent(photo):
        result=original(photo)
        if photo['id']==row['id'] and not changed:
            changed.append(1);tags(db,row,[{'synset':'n03792782','label':'mountain bike'}])
        return result
    monkeypatch.setattr(module,'photo_terms',concurrent)
    assert LexiconWorker(db).tick();assert vocab.status()['pending']==1
    drain(db)
    assert vocab.lookup('跑车',['subject'])['items'][0]['photo_count']==1
    assert vocab.lookup('mountain bike',['subject'])['items'][0]['photo_count']==2


def test_stale_analysis_unknown_status_and_gps_do_not_become_facts(system):
    current,db,vocab=setup(system)
    with db.connect() as c:
        c.execute("UPDATE analysis SET version='stale' WHERE asset_id=? AND provider='visual'",(current[0]['id'],))
        c.execute("UPDATE analysis SET data_json=json_set(data_json,'$.style.status','uncertain','$.topic.input','ignore') WHERE asset_id=? AND provider='photography'",(current[0]['id'],))
        c.execute("UPDATE analysis SET data_json=json_set(data_json,'$.input_record','stale') WHERE asset_id=? AND provider='places'",(current[1]['id'],))
    drain(db)
    assert vocab.lookup('跑车',['subject'])['items'][0]['photo_count']==1
    assert vocab.lookup('新源',['city'])['items'][0]['photo_count']==1
    assert vocab.lookup('黑白摄影',['style'])['items'][0]['photo_count']==1
    assert photo_terms({'subjects':[{'taxonomy':'custom','id':'817','label':'sports car'}]})[next(iter(photo_terms({'subjects':[{'taxonomy':'custom','id':'817','label':'sports car'}]})))]['id']!=CAR


def test_paginated_dictionary_cursor_binding_safe_inputs_auth_and_metadata_only_rebuild(system):
    current,db,vocab=setup(system);app,client,remote,sid=system
    tags(db,current[0],[{'label':'synthetic-keyword-'+str(n)} for n in range(85)])
    drain(db);before=list(remote.calls);one=vocab.lookup('synthetic-keyword',['subject'],limit=60)
    assert len(one['items'])==60 and one['total']==85 and one['next_cursor']
    two=vocab.lookup('synthetic-keyword',['subject'],limit=60,cursor=one['next_cursor'])
    assert len(two['items'])==25 and not two['next_cursor']
    assert not {x['id'] for x in one['items']}&{x['id'] for x in two['items']}
    for query,cursor in [('changed',one['next_cursor']),('x','bad'),('x','e30')]:
        with pytest.raises(ValueError):vocab.lookup(query,['subject'],cursor=cursor)
    for q in ("' OR 1=1 --",'%', '_','\\'):
        assert not vocab.lookup(q,['subject'])['items']
    assert client.post('/api/lexicon/rebuild',json={},headers={'Origin':'http://evil.example'}).status_code==403
    assert client.post('/api/lexicon/rebuild',json={}).json()['scope']=='metadata-only'
    assert vocab.status()['stale'];drain(db)
    with pytest.raises(ValueError):vocab.lookup('synthetic-keyword',['subject'],cursor=one['next_cursor'])
    assert remote.calls==before
    client.post('/api/logout',json={})
    for path in ('/api/lexicon','/api/lexicon/status'):assert client.get(path).status_code==401
    assert client.post('/api/lexicon/rebuild',json={}).status_code==401


def test_agent_lookup_to_ids_to_show_revalidates_hidden_photos(system):
    current,db,vocab=setup(system);app,client,remote,sid=system;configure(app);calls=[];before=list(remote.calls)
    async def provider(config,messages,tools,delta,**kwargs):
        results=[json.loads(m['content']) for m in messages if m['role']=='tool'];n=len(results)
        if n==0:name,args='lookup_keywords',{'query':'sport car','domains':['subject']}
        elif n==1:
            assert results[-1]['items'][0]['id']==CAR
            name,args='search_photos',{'filters':{'keyword_ids':[results[-1]['items'][0]['id']]}}
        elif n==2:
            assert results[-1]['total']==2
            name,args='create_exhibition',{'title':'合成跑车展','search_id':results[-1]['search_id'],'room':'wall'}
        else:
            # Simulates a source change between draft and final preparation.
            with db.connect() as c:c.execute('INSERT OR REPLACE INTO curation VALUES(?,?,?,?)',(current[0]['id'],0,1,0))
            return {'role':'assistant','content':'根据主体词库完成筛选。'},{}
        calls.append(name)
        return {'role':'assistant','content':None,'tool_calls':[{'id':'call-'+str(n),'type':'function','function':{'name':name,'arguments':json.dumps(args)}}]},{}
    app.state.curator.complete=provider
    with client:
        rid=client.post('/api/curator/runs',json={'prompt':'合成：按跑车主体策展'}).json()['id'];run=wait(client,rid)
        assert run['status']=='completed',run
        exhibition=client.get('/api/curator/exhibitions/'+run['exhibition_id']).json()
        assert exhibition['count']==1
        with db.connect() as c:selection=json.loads(c.execute('SELECT selection_json FROM curator_exhibitions WHERE id=?',(run['exhibition_id'],)).fetchone()[0])
        assert selection['filters']['keyword_ids']==[CAR]
        assert client.get('/api/curator/exhibitions/'+run['exhibition_id']+'/exhibitions/photos').json()['items'][0]['id']==current[1]['id']
        assert calls==['lookup_keywords','search_photos','create_exhibition'] and remote.calls==before


def test_config_change_during_projection_cannot_publish_into_old_generation(system,monkeypatch):
    current,db,vocab=setup(system);old=vocab.status()['generation'];tags(db,current[0],[{'label':'new-candidate'}])
    w=LexiconWorker(db);ensure=w.ensure_generation
    def concurrent():
        target=ensure()
        with db.connect() as c:c.execute("INSERT OR REPLACE INTO settings VALUES('lexicon_epoch','10')")
        return target
    monkeypatch.setattr(w,'ensure_generation',concurrent)
    assert w.tick();assert vocab.status()['generation']==old and vocab.status()['pending']==1
    # A newly constructed worker sees the persisted stamp and resumes with a new generation.
    drain(db);assert vocab.status()['generation']>old and vocab.lookup('new-candidate',['subject'])['total']==1


def test_model_versions_and_unaccepted_inferred_gps_are_excluded(system):
    current,db,vocab=setup(system)
    with db.connect() as c:
        c.execute("INSERT OR REPLACE INTO settings VALUES('geography_version','new-place-model')")
        c.execute("INSERT OR REPLACE INTO settings VALUES('analysis_version','new-visual-model')")
        c.execute("INSERT OR REPLACE INTO settings VALUES('photography_version','new-photography-model')")
    drain(db);assert vocab.status()['domains']=={'subject':0,'topic':0,'style':0,'city':0}
    row=current[0]
    with db.connect() as c:
        c.execute("UPDATE analysis SET version='new-place-model' WHERE asset_id=? AND provider='places'",(row['id'],))
        # Rejected inference cannot supply a city even if the reverse-geocoder points at it.
        c.execute("UPDATE metadata SET layer='inferred',info_json=json_set(info_json,'$.accepted',0) WHERE asset_id=? AND field='gps'",(row['id'],))
    drain(db);assert vocab.lookup('新源',['city'])['total']==0
    with db.connect() as c:c.execute("UPDATE metadata SET info_json=json_set(info_json,'$.accepted',1) WHERE asset_id=? AND field='gps'",(row['id'],))
    drain(db);assert vocab.lookup('新源',['city'])['items'][0]['photo_count']==1


def test_streaming_provider_adapter_uses_lexicon_and_standard_ids(system):
    import httpx
    from .curator_fixture import FakeLLM
    current,db,vocab=setup(system);app,client,remote,sid=system;configure(app);fake=FakeLLM();before=list(remote.calls)
    app.state.curator.transport=httpx.MockTransport(fake)
    with client:
        rid=client.post('/api/curator/runs',json={'prompt':'合成：通过词库筛选跑车照片'}).json()['id'];run=wait(client,rid)
        assert run['status']=='completed' and run['exhibition_id'],run
        events=client.get('/api/curator/runs/'+rid+'/events').json()['items']
        starts=[e['data'] for e in events if e['kind']=='tool_start']
        assert [e['name'] for e in starts]==['catalog_schema','library_overview','lookup_keywords','search_photos','create_exhibition']
        assert starts[3]['arguments']['filters']['keyword_ids']==[CAR]
        assert client.get('/api/curator/exhibitions/'+run['exhibition_id']).json()['count']==2
        assert len(fake.requests)==6 and remote.calls==before


def test_noop_reconciliation_writes_do_not_keep_lexicon_busy(system):
    current,db,vocab=setup(system);before=vocab.status()['revision']
    with db.connect() as c:
        for table,columns in [('entries',['revision','scope_excluded','missing']),('media_jobs',['revision','status']),('analysis',['revision','data_json']),('media_info',['data_json']),('metadata',['stale','info_json']),('cache_files',['path','profile'])]:
            c.execute('UPDATE '+table+' SET '+','.join(col+'='+col for col in columns))
        assert c.execute('SELECT count(*) FROM lexicon_dirty').fetchone()[0]==0
    drain(db);assert vocab.status()['revision']==before
