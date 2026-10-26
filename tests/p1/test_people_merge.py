import json
import time
from .test_people_settings import seed
from .test_service import system
from .test_curation import FaceProvider
from photo_museum.analysis_worker import AnalysisWorker


def groups(system):
 app,client,remote,p=seed(system)
 faces=client.get('/api/people/'+p['id']+'/faces').json()['items']
 second=client.post('/api/faces/'+faces[1]['face_id']+'/assign',json={}).json()['person_id']
 return app,client,remote,p['id'],second,faces


def test_merge_identity_counts_names_undo_and_no_network(system):
 app,c,remote,a,b,faces=groups(system);db=app.state.db
 c.post('/api/people/'+a,json={'label':'合成同名'})
 c.post('/api/people/'+b,json={'label':'合成同名'})
 assert c.get('/api/people?q=合成同名&exact=true').json()['total']==2
 assert c.get('/api/people?q=合成&exact=true').json()['total']==0
 with db.connect() as conn:before=[tuple(r) for r in conn.execute('SELECT * FROM faces ORDER BY id')]
 calls=len(remote.calls)
 r=c.post('/api/people/merges',json={'target_id':a,'source_ids':[b,b]})
 assert r.status_code==200,r.text
 mid=r.json()['merge_id']
 assert r.json()['moved_faces']==1
 assert c.get('/api/people').json()['total']==1
 p=c.get('/api/people').json()['people'][0]
 assert p['count']==2 and p['face_count']==2 and p['label']=='合成同名'
 for f in faces:assert c.get('/api/assets/'+f['id']+'/analysis').json()['people']['items'][0]['id']==a
 assert c.get('/api/people/merges').json()['items'][0]['can_undo']
 assert c.post('/api/people/merges/'+mid+'/undo',json={}).status_code==200
 assert c.post('/api/people/merges/'+mid+'/undo',json={}).status_code==200
 assert c.get('/api/people').json()['total']==2
 with db.connect() as conn:
  assert [tuple(r) for r in conn.execute('SELECT * FROM faces ORDER BY id')]==before
  record=conn.execute('SELECT faces_json FROM people_merges').fetchone()[0]
  assert 'embedding' not in record and 'box_json' not in record
 assert len(remote.calls)==calls


def test_merge_rolls_back_invalid_sources_and_auth(system):
 app,c,remote,a,b,faces=groups(system)
 assert c.post('/api/people/merges',json={'target_id':a,'source_ids':[a]}).status_code==422
 assert c.post('/api/people/merges',json={'target_id':a,'source_ids':[]}).status_code==422
 assert c.post('/api/people/merges',json={'target_id':a,'source_ids':[b,'missing']}).status_code==409
 assert c.get('/api/people').json()['total']==2
 assert c.get('/api/people/merges').json()['items']==[]
 c.cookies.clear()
 assert c.post('/api/people/merges',json={'target_id':a,'source_ids':[b]}).status_code==401
 assert c.get('/api/people/merges').status_code==401
 assert c.post('/api/people/merges/missing/undo',json={}).status_code==401


def test_manual_merge_survives_upgrade_and_later_edit_blocks_undo(system):
 app,c,remote,a,b,faces=groups(system);db=app.state.db
 mid=c.post('/api/people/merges',json={'target_id':a,'source_ids':[b]}).json()['merge_id']
 worker=AnalysisWorker(db,FaceProvider());worker.provider.version='fixture-upgrade'
 while worker.tick():pass
 assert c.get('/api/people/'+a+'/faces').json()['total']==2
 with db.connect() as conn:assert conn.execute('SELECT person_id FROM faces WHERE id=?',(faces[1]['face_id'],)).fetchone()[0]==a
 c.post('/api/faces/'+faces[1]['face_id']+'/assign',json={'person_id':b})
 c.post('/api/faces/'+faces[1]['face_id']+'/assign',json={'person_id':a})
 assert not c.get('/api/people/merges').json()['items'][0]['can_undo']
 assert c.post('/api/people/merges/'+mid+'/undo',json={}).status_code==409


def test_hidden_identity_records_follow_merge_without_exposing_them(system):
 app,c,remote,a,b,faces=groups(system);db=app.state.db
 with db.connect() as conn:
  row=dict(conn.execute('SELECT * FROM faces WHERE person_id=?',(b,)).fetchone())
  conn.execute('INSERT INTO faces VALUES(?,?,?,?,?,?,?,?)',('hidden-old-face',row['asset_id'],'older',b,row['box_json'],row['embedding'],'older',0))
 with db.connect() as conn:
  conn.execute('INSERT INTO faces VALUES(?,?,?,?,?,?,?,?)',('stale-current-face',row['asset_id'],row['revision'],b,row['box_json'],row['embedding'],'older',0))
 mid=c.post('/api/people/merges',json={'target_id':a,'source_ids':[b]}).json()['merge_id']
 assert c.get('/api/people/'+a+'/faces').json()['total']==2
 with db.connect() as conn:assert tuple(conn.execute("SELECT person_id,manual FROM faces WHERE id='hidden-old-face'").fetchone())==(a,0)
 assert c.post('/api/people/merges/'+mid+'/undo',json={}).status_code==200
 with db.connect() as conn:assert tuple(conn.execute("SELECT person_id,manual FROM faces WHERE id='hidden-old-face'").fetchone())==(b,0)
