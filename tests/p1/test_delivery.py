import json
from photo_museum.backup import backup,restore
from photo_museum.analysis_worker import AnalysisWorker
from .test_media import jpeg
from .test_service import system,scan
from .fixture import ROOT,EVENT
from photo_museum.media_worker import MediaWorker

class FakeProvider:
 id='visual';version='fixture-v1'
 def analyze(self,path):return {'score':70,'tags':[{'label':'fixture','confidence':1}],'embedding':[1,0],'faces':[],'offline':True}

def test_backup_restore_preserves_owner_but_no_sessions(system,tmp_path):
 app,client,remote,sid=system
 remote.entries={ROOT:None,EVENT:None,EVENT+'/one.jpg':jpeg()}
 scan(app,client,sid)
 MediaWorker(app.state.db).tick()
 backup(app.state.db,tmp_path/'backup')
 d=restore(tmp_path/'backup',tmp_path/'restore')
 with d.connect() as c:
  assert c.execute('select count(*) from sessions').fetchone()[0]==0
  assert c.execute('select count(*) from sources').fetchone()[0]==1
  assert c.execute('select status from media_jobs').fetchone()[0]=='pending'
  assert c.execute('pragma integrity_check').fetchone()[0]=='ok'
 from photo_museum.auth import Security
 assert Security(d).initialized()


def test_local_analysis_version_and_manual_curation(system):
 app,client,remote,sid=system
 remote.entries={ROOT:None,EVENT:None,EVENT+'/one.jpg':jpeg()}
 scan(app,client,sid);MediaWorker(app.state.db).tick()
 worker=AnalysisWorker(app.state.db,FakeProvider())
 assert worker.tick() and not worker.tick()
 a=client.get('/api/gallery').json()['activities'][0]['selected'][0]
 client.post('/api/assets/'+a['id']+'/curation',json={'pinned':True})
 worker.provider.version='fixture-v2'
 assert worker.tick()
 assert client.get('/api/gallery').json()['activities'][0]['selected'][0]['pinned']
 assert client.get('/api/assets/'+a['id']+'/analysis').json()['visual']['version']=='fixture-v2'
