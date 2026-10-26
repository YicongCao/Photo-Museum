import json,time,uuid
import numpy as np
from .test_service import system,scan
from .test_people_settings import seed
from .test_curation import FaceProvider
from .test_media import jpeg
from .fixture import EVENT
from photo_museum.analysis_worker import AnalysisWorker
from photo_museum.media_worker import MediaWorker
from photo_museum.face_matching import bank,rank,assign_new,unit


def setup_review(system):
 app,c,remote,p=seed(system);db=app.state.db
 faces=c.get('/api/people/'+p['id']+'/faces').json()['items']
 with db.connect() as x:
  x.execute('INSERT INTO people VALUES(?,?,?)',('fragment','',time.time()))
  x.execute('UPDATE faces SET person_id=?,manual=0,embedding=? WHERE id=?',('fragment',np.array([.6,.8,0],dtype=np.float32).tobytes(),faces[1]['face_id']))
 c.post('/api/people/'+p['id'],json={'label':'合成甲'})
 q=c.get('/api/face-review').json()['items'][0]
 return app,c,remote,p,q


def body(q,decision):
 return {k:q[k] for k in ('face_id','person_id','source_person_id','model','revision','target_updated')}|{'decision':decision,'request_id':uuid.uuid4().hex}


def test_yes_enriches_confirmed_bank_and_undo_preserves_vectors(system):
 app,c,remote,p,q=setup_review(system);db=app.state.db;calls=len(remote.calls)
 assert .59<q['similarity']<.61 and q['sample_count']==1 and 'embedding' not in json.dumps(q)
 with db.connect() as x:before=x.execute('SELECT embedding FROM faces WHERE id=?',(q['face_id'],)).fetchone()[0]
 payload=body(q,'yes');result=c.post('/api/face-review',json=payload)
 assert result.status_code==200,result.text
 assert c.post('/api/face-review',json=payload).status_code==200
 assert not c.get('/api/face-review').json()['items']
 with db.connect() as x:
  r=x.execute('SELECT person_id,manual,embedding FROM faces WHERE id=?',(q['face_id'],)).fetchone()
  assert (r['person_id'],r['manual'],r['embedding'])==(p['id'],1,before)
  refs=bank(x,q['model']);assert len(refs['named'][(p['id'],3)])==2
  assert x.execute('SELECT policy FROM face_reviews').fetchone()[0]=='confirmed-multi-v1'
 assert c.post('/api/face-review/'+payload['request_id']+'/undo',json={}).status_code==200
 assert c.get('/api/face-review').json()['items'][0]['face_id']==q['face_id']
 assert len(remote.calls)==calls


def test_no_is_remembered_and_blocks_similar_automatic_prediction(system):
 app,c,remote,p,q=setup_review(system);payload=body(q,'no')
 assert c.post('/api/face-review',json=payload).status_code==200
 assert not c.get('/api/face-review').json()['items']
 with app.state.db.connect() as x:
  refs=bank(x,q['model']);matches=rank(unit([.8,.6,0]),refs)
  assert matches[0]['negative_similarity']>.9 and not matches[0]['automatic']
 assert c.post('/api/face-review/'+payload['request_id']+'/undo',json={}).status_code==200
 assert c.get('/api/face-review').json()['items']


def test_multi_samples_new_photo_assignment_is_not_self_training(system):
 app,c,remote,p=seed(system);db=app.state.db
 c.post('/api/people/'+p['id'],json={'label':'合成甲'})
 remote.entries[EVENT+'/new.jpg']=jpeg();scan(app,c,system[3])
 while MediaWorker(db).tick():pass
 worker=AnalysisWorker(db,FaceProvider())
 while worker.tick():pass
 with db.connect() as x:
  rows=x.execute('SELECT * FROM faces WHERE person_id=?',(p['id'],)).fetchall()
  assert len(rows)==3 and sum(r['manual'] for r in rows)==2
  refs=bank(x,worker.provider.version)
  assert len(refs['named'][(p['id'],3)])==2
  assert x.execute('SELECT count(*) FROM face_matches').fetchone()[0]==1


def test_ambiguity_model_scope_and_no_same_photo_duplicate(system):
 app,c,remote,p,q=setup_review(system);db=app.state.db
 with db.connect() as x:
  refs=bank(x,q['model']);sample=next(iter(refs['named'].values()))[0]
  assert not rank(unit([1,0,0]),refs,asset_id=sample['asset_id'])
  refs['named'][('other',3)]=[dict(sample,person_id='other',id='other-sample')]
  candidates=rank(unit([1,0,0]),refs)
  assert len(candidates)==2 and not any(m['automatic'] for m in candidates)
  pid,match=assign_new(unit([1,0,0]),refs,'new',set());assert pid not in (p['id'],'other') and match is None
  assert not bank(x,'different-model')['named']
  x.execute('INSERT OR REPLACE INTO curation VALUES(?,0,1,?)',(sample['asset_id'],time.time()))
 assert c.get('/api/face-review').json()['status']=='needs_samples'
 assert unit(b'bad') is None and unit([float('nan'),1]) is None


def test_stale_answers_idempotency_auth_and_later_edits(system):
 app,c,remote,p,q=setup_review(system)
 payload=body(q,'yes');stale=dict(payload,target_updated=q['target_updated']-1)
 assert c.post('/api/face-review',json=stale).status_code==409
 assert c.post('/api/face-review',json=payload).status_code==200
 assert c.post('/api/face-review',json=dict(payload,decision='no')).status_code==409
 c.post('/api/people/'+p['id'],json={'label':'合成新姓名'})
 assert c.post('/api/face-review/'+payload['request_id']+'/undo',json={}).status_code==409
 c.cookies.clear()
 assert c.get('/api/face-review').status_code==401
 assert c.post('/api/face-review',json=payload).status_code==401
 assert c.get('/api/face-review/history').status_code==401


def test_different_confirmed_angles_can_match_when_first_sample_cannot(system):
 app,c,remote,p,q=setup_review(system)
 with app.state.db.connect() as x:refs=bank(x,q['model'])
 original=next(iter(refs['named'].values()))[0]
 refs['named'][(p['id'],3)]=[dict(original,id='angle-'+str(i),asset_id='photo-'+str(i),vector=unit(v)) for i,v in enumerate(([1,0,0],[.8,.6,0],[.6,.8,0]))]
 query=unit([.3,.954,0]);assert float(query@original['vector'])<.4
 pid,match=assign_new(query,refs,'new-photo',set())
 assert pid==p['id'] and match['support']==2 and match['automatic']
 assert assign_new(query,refs,'new-photo',{pid})[0]!=pid


def test_review_paginates_past_unmatched_faces_without_claiming_empty_library(system):
 app,c,remote,p,q=setup_review(system);db=app.state.db
 with db.connect() as x:
  original=dict(x.execute('SELECT * FROM faces WHERE id=?',(q['face_id'],)).fetchone())
  for i in range(251):
   x.execute('INSERT INTO faces VALUES(?,?,?,?,?,?,?,0)',('!dummy-'+str(i).zfill(3),original['asset_id'],original['revision'],original['person_id'],original['box_json'],np.array([-1,0,0],dtype=np.float32).tobytes(),original['model']))
 first=c.get('/api/face-review').json()
 assert not first['items'] and first['examined']==250 and first['next_cursor']
 second=c.get('/api/face-review',params={'after':first['next_cursor']}).json()
 assert len(second['items'])==1 and second['items'][0]['face_id']==q['face_id'] and not second['next_cursor']
