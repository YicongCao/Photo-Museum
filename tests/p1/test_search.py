import json
from .test_service import system
from .test_exhibitions import seed
from .test_lexicon import tags,drain,CAR,BIKE
from photo_museum.curator_tools import LocalTools,Filters
from photo_museum.representatives import choose


def test_shared_search_candidate_modes_correction_undo_scope_and_no_nas(system):
    current,_=seed(system);app,client,remote,sid=system;db=app.state.db
    tags(db,current[0],[{'synset':'n04285008','label':'sports car'},{'synset':'n03792782','label':'mountain bike'}])
    tags(db,current[1],[{'synset':'n03792782','label':'mountain bike'},{'synset':'n04285008','label':'sports car'}])
    drain(db);before=list(remote.calls)
    def search(mode='all'):
        r=client.post('/api/search',json={'filters':{'keyword_ids':[CAR],'subject_mode':mode},'order':'time'})
        assert r.status_code==200,r.text
        return r.json()
    assert search()['total']==2
    assert search('primary')['total']==1
    assert search('confirmed')['total']==0
    first=search('primary')['items'][0]
    assert first['evidence']['tags'][0]['rank']==1
    review=client.put('/api/search/reviews/'+current[1]['id'],json={'revision':current[1]['revision'],'keyword_id':CAR,'verdict':1})
    assert review.status_code==200,review.text
    assert search('primary')['total']==2 and search('confirmed')['total']==1
    # Ordinary search and agent share the manual result immediately.
    tool=LocalTools(db,app.state.exhibitions,'test')
    assert tool.dispatch('search_photos',{'filters':{'keyword_ids':[CAR],'subject_mode':'confirmed'}})['total']==1
    token=review.json()['token'];assert client.post('/api/search/reviews/'+token+'/undo',json={}).status_code==200
    assert client.post('/api/search/reviews/'+token+'/undo',json={}).status_code==409
    assert search('confirmed')['total']==0
    review=client.put('/api/search/reviews/'+current[0]['id'],json={'revision':current[0]['revision'],'keyword_id':CAR,'verdict':-1})
    assert review.status_code==200
    assert search()['total']==1 and search('primary')['total']==0
    collection=search()
    client.post('/api/assets/'+current[1]['id']+'/curation',json={'excluded':True})
    assert client.get('/api/search/collections/'+collection['id']).json()['total']==0
    assert remote.calls==before
    client.post('/api/logout',json={})
    for url in ['/api/search/facets?field=city','/api/search/reviews','/api/search/collections/'+collection['id']]:assert client.get(url).status_code==401
    assert client.post('/api/search',json={}).status_code==401


def test_search_invalid_filters_and_old_revisions(system):
    current,_=seed(system);app,client,remote,sid=system;db=app.state.db
    tags(db,current[0],[{'synset':'n04285008','label':'sports car'}]);drain(db)
    assert client.post('/api/search',json={'filters':{'subject_mode':'certain'}}).status_code==422
    assert client.post('/api/search',json={'filters':{'date_from':'2025','date_to':'2024'}}).status_code==422
    assert client.put('/api/search/reviews/'+current[0]['id'],json={'revision':'old','keyword_id':CAR,'verdict':1}).status_code==409
    assert client.put('/api/search/reviews/'+current[0]['id'],json={'revision':current[0]['revision'],'keyword_id':BIKE,'verdict':1}).status_code==422


def test_representatives_deterministic_quality_hero_diversity():
    rows=[{'id':str(i),'score':10-i*.1,'signature':'0000000000000000' if i<10 else 'ffffffffffffffff',
           'concept':'car' if i<10 else 'mountain','representative_time':f'2024-10-{1 if i<10 else 20:02}T12:00:00'} for i in range(14)]
    selected,summary=choose(rows)
    assert selected[0]['id']=='0' and len(selected)==10
    assert summary['alternatives']>0
    assert choose(rows)==(selected,summary)
    assert choose(rows[:4])[0]==rows[:4]
    assert len({p['id'] for p in selected})==10


def test_cover_selection_opt_in_and_pref_revision(system):
    seed(system);app,client,remote,sid=system
    p=client.get('/api/preferences').json();assert p['cover_selection']=='top10'
    before=client.get('/api/gallery').json()
    r=client.put('/api/preferences',json=p|{'cover_selection':'representative'});assert r.status_code==200,r.text
    after=client.get('/api/gallery').json()
    assert before['revision']!=after['revision']
    assert all(g['selection_policy'].startswith('representative-') for g in after['activities'])
    assert client.put('/api/preferences',json=p).status_code==409
    assert client.put('/api/preferences',json=r.json()|{'cover_selection':'top10'}).status_code==200
    restored=client.get('/api/gallery').json()
    assert [[p['id'] for p in g['selected']] for g in restored['activities']]==[[p['id'] for p in g['selected']] for g in before['activities']]


def test_representatives_use_actual_iso_time_and_no_fake_unknown_bonus():
    rows=[{'id':str(i),'score':10-i*.01,'representative_time':f'2024-10-{1 if i<10 else 28:02}T12:00:00'} for i in range(11)]
    selected,_=choose(rows)
    assert selected[0]['id']=='0' and selected[1]['id']=='10'
    for row in rows:row['representative_time']=None
    assert choose(rows)[0]==rows[:10]


def test_face_query_ignores_old_automatic_model_but_keeps_manual(system):
    current,_=seed(system);app,client,remote,sid=system;db=app.state.db
    row=current[0]
    with db.connect() as c:
        c.execute("INSERT INTO people VALUES('fixture-person','合成人物',0)")
        c.execute("INSERT INTO faces VALUES('fixture-face',?,?,'fixture-person','[0,0,1,1]',x'00','old-model',0)",(row['id'],row['revision']))
    assert client.post('/api/search',json={'filters':{'person':'合成人物'}}).json()['total']==0
    with db.connect() as c:c.execute("UPDATE faces SET manual=1 WHERE id='fixture-face'")
    assert client.post('/api/search',json={'filters':{'person':'合成人物'}}).json()['total']==1
    with db.connect() as c:c.execute("UPDATE people SET label='更名样本' WHERE id='fixture-person'")
    assert client.post('/api/search',json={'filters':{'person':'合成人物'}}).json()['total']==0
    assert client.post('/api/search',json={'filters':{'person':'更名样本'}}).json()['total']==1
