import io,json,time
from PIL import Image
from photo_museum.media_worker import MediaWorker
from photo_museum.analysis_worker import AnalysisWorker
from .test_service import system,scan
from .test_media import jpeg
from .test_curation import FaceProvider
from .fixture import ROOT,EVENT

def seed(system):
 app,client,remote,sid=system
 remote.entries={ROOT:None,EVENT:None,EVENT+'/one.jpg':jpeg(),EVENT+'/two.jpg':jpeg()}
 scan(app,client,sid)
 while MediaWorker(app.state.db).tick():pass
 worker=AnalysisWorker(app.state.db,FaceProvider())
 while worker.tick():pass
 person=client.get('/api/people').json()['people'][0]
 return app,client,remote,person

def test_paginated_names_portraits_and_photo_archive(system):
 app,client,remote,p=seed(system);db=app.state.db
 rows=client.get('/api/people/'+p['id']+'/faces?limit=1').json();assert rows['total']==2 and len(rows['items'])==1
 f=rows['items'][0];assert 'path' not in f and 'embedding' not in f
 before=len(remote.calls)
 response=client.get(f['portrait']);assert response.status_code==200 and 'no-store' in response.headers['cache-control']
 assert Image.open(io.BytesIO(response.content)).size==(160,160) and len(remote.calls)==before
 assert client.post('/api/people/'+p['id'],json={'label':'  小林  '}).status_code==200
 result=client.get('/api/people?q=小林&named=named&limit=1').json();assert result['total']==1 and result['people'][0]['label']=='小林'
 assert client.get('/api/people?q=%').json()['total']==0
 assert client.get('/api/people?named=unnamed').json()['total']==0
 assert client.get('/api/assets/'+f['id']+'/analysis').json()['people']['items'][0]['label']=='小林'
 assert client.get('/api/intelligence').json()['named_people']==1
 assert client.post('/api/people/'+p['id'],json={'label':'\n姓名'}).status_code==422
 assert client.post('/api/people/'+p['id'],json={'label':'改名'}).status_code==200
 assert client.post('/api/people/'+p['id'],json={'label':''}).status_code==200
 assert client.get('/api/people?named=unnamed').json()['total']==1
 assert client.get('/api/people?limit=0').status_code==422
 assert client.get('/api/people?named=invalid').status_code==422

def test_hidden_stale_scope_and_missing_cache_do_not_leak_faces(system):
 app,client,remote,p=seed(system);db=app.state.db
 faces=client.get('/api/people/'+p['id']+'/faces').json()['items'];first,second=faces
 with db.connect() as c:c.execute('INSERT OR REPLACE INTO curation VALUES(?,0,1,?)',(first['id'],time.time()))
 assert client.get(first['portrait']).status_code==404
 assert client.get('/api/people/'+p['id']+'/faces').json()['total']==1
 with db.connect() as c:c.execute("UPDATE faces SET model='stale-version' WHERE asset_id=?",(second['id'],))
 assert client.get('/api/people').json()['total']==0
 with db.connect() as c:c.execute('UPDATE faces SET manual=1 WHERE asset_id=?',(second['id'],))
 assert client.get('/api/people').json()['total']==1
 before=len(remote.calls)
 with db.connect() as c:c.execute("DELETE FROM cache_files WHERE asset_id=? AND profile='thumb'",(second['id'],))
 assert client.get(second['portrait']).status_code==404 and len(remote.calls)==before
 with db.connect() as c:c.execute('UPDATE entries SET scope_excluded=1 WHERE id=?',(second['id'],))
 assert client.get(second['portrait']).status_code==404
 assert client.get('/api/faces/missing/portrait').status_code==404

def test_portrait_auth_and_manual_reassignment(system):
 app,client,remote,p=seed(system)
 face=client.get('/api/people/'+p['id']+'/faces').json()['items'][0]
 assert client.post('/api/faces/'+face['face_id']+'/assign',json={'person_id':'missing'}).status_code==404
 moved=client.post('/api/faces/'+face['face_id']+'/assign',json={'person_id':None}).json()['person_id']
 assert moved!=p['id'];assert client.get('/api/people/'+moved+'/faces').json()['items'][0]['manual']==1
 assert client.post('/api/people/'+moved,json={'label':'新人物'}).status_code==200
 with app.state.db.connect() as c:
  old=c.execute('SELECT embedding FROM faces WHERE id=?',(face['face_id'],)).fetchone()[0]
  c.execute("UPDATE settings SET value='new-model' WHERE key='analysis_version'")
 assert client.get('/api/people/'+moved+'/faces').json()['total']==1
 with app.state.db.connect() as c:assert c.execute('SELECT embedding FROM faces WHERE id=?',(face['face_id'],)).fetchone()[0]==old
 client.post('/api/logout');assert client.get(face['portrait']).status_code==401
