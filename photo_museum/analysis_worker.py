"""Rebuildable local analysis, with human cluster labels/pins kept separately."""
import argparse
import json
import time
import uuid
from pathlib import Path
from .db import Database
from .processing import Progress, complete_file
from .cache import Cache
from .work_queue import directory_focus

class AnalysisWorker:
 def __init__(self,database,provider):
  self.db,self.provider=database,provider
  self.cache=Cache(database)
  self.geo=None
  if hasattr(provider,'models') and (provider.models/'geonames/cities15000.zip').is_file():
   from .geography import GeoNames
   self.geo=GeoNames(provider.models/'geonames')

 def geocode_one(self):
  if not self.geo:return False
  with self.db.connect() as c:
   row=c.execute("""WITH ranked AS (SELECT m.*,e.revision,row_number() OVER(PARTITION BY m.asset_id ORDER BY CASE layer WHEN 'manual' THEN 0 WHEN 'observed' THEN 1 ELSE 2 END) priority FROM metadata m JOIN entries e ON e.id=m.asset_id WHERE m.field='gps' AND m.stale=0 AND e.missing=0 AND e.scope_excluded=0 AND (m.layer!='inferred' OR json_extract(m.info_json,'$.accepted')=1))
    SELECT r.* FROM ranked r LEFT JOIN analysis a ON a.asset_id=r.asset_id AND a.provider='places' WHERE r.priority=1 AND (a.asset_id IS NULL OR a.revision!=r.revision OR a.version!=? OR json_extract(a.data_json,'$.input_record')!=r.record_id) LIMIT 1""",(self.geo.version,)).fetchone()
  if not row:return False
  value=json.loads(row['value_json'])
  result=self.geo.reverse(value) if isinstance(value,dict) else {'status':'unknown'}
  result.update(input_record=row['record_id'],input_layer=row['layer'],input_precision=json.loads(row['info_json']).get('precision'))
  if self.db.effective(row['asset_id']).get('gps',{}).get('record_id')!=row['record_id']:return True
  with self.db.connect() as c:c.execute('INSERT OR REPLACE INTO analysis VALUES(?,?,?,?,?,?)',(row['asset_id'],row['revision'],'places',self.geo.version,json.dumps(result),time.time()))
  return True

 def tick(self):
  with self.db.connect() as c:
   if c.execute("SELECT value FROM settings WHERE key='media_paused'").fetchone()[0]=='true':return False
   c.execute("INSERT OR REPLACE INTO settings VALUES('analysis_version',?)",(self.provider.version,))
   focus=directory_focus(c)
   r=c.execute("""SELECT e.id,e.revision FROM entries e JOIN media_info m ON m.asset_id=e.id AND m.revision=e.revision WHERE e.missing=0 AND e.scope_excluded=0 AND coalesce(json_extract(m.data_json,'$.metadata_only'),0)=0 AND (? IS NULL OR (e.source_id=? AND e.parent=?)) AND NOT EXISTS(SELECT 1 FROM analysis a WHERE a.asset_id=e.id AND a.revision=e.revision AND a.provider=? AND a.version=? AND json_extract(a.data_json,'$.input_media_version') IS json_extract(m.data_json,'$.version')) ORDER BY e.parent DESC,e.path DESC LIMIT 1""",(focus['source_id'] if focus else None,focus['source_id'] if focus else None,focus['parent'] if focus else None,self.provider.id,self.provider.version)).fetchone()
  if not r:return self.geocode_one()
  path=self.cache.lookup(r['id'],r['revision'],'thumb')
  if not path:
   with self.db.connect() as c:c.execute("UPDATE media_jobs SET status='pending',available=0 WHERE asset_id=? AND revision=? AND status='ready'",(r['id'],r['revision']))
   return False
  progress=Progress(self.db,r['id'],r['revision'],'analysis')
  try:
   import inspect
   progress.report('subject')
   result=self.provider.analyze(path,progress=progress.report) if 'progress' in inspect.signature(self.provider.analyze).parameters else self.provider.analyze(path)
   if 'progress' not in inspect.signature(self.provider.analyze).parameters:
    for step in ('subject','faces','score'):progress.report(step,'done')
  except Exception as exc:
   progress.finish('failed')
   result={'error':type(exc).__name__,'offline':True}
  progress.report('address')
  gps=self.db.effective(r['id']).get('gps')
  place=self.geo.reverse(gps['value']) if self.geo and gps and isinstance(gps['value'],dict) else None
  progress.report('address','done' if place and place.get('status')!='unknown' else 'skipped')
  with self.db.connect() as c:
   c.execute('BEGIN IMMEDIATE')
   current=c.execute('SELECT revision,missing FROM entries WHERE id=?',(r['id'],)).fetchone()
   if not current or current['missing'] or current['revision']!=r['revision']:return True
   existing=c.execute('SELECT 1 FROM faces WHERE asset_id=? AND revision=? AND manual=1',(r['id'],r['revision'])).fetchone()
   if not existing:
    c.execute('DELETE FROM faces WHERE asset_id=? AND revision=?',(r['id'],r['revision']))
    # Conservative online clustering, never assign a real person's name automatically.
    import numpy as np
    clusters=[dict(x) for x in c.execute('SELECT f.person_id,f.embedding FROM faces f JOIN entries e ON e.id=f.asset_id AND e.revision=f.revision WHERE e.missing=0 AND e.scope_excluded=0 AND f.model=? AND f.person_id IS NOT NULL GROUP BY f.person_id',(self.provider.version,))]
    for face in result.pop('faces',[]):
     vector=np.array(face['embedding'],dtype=np.float32)
     best=None;similarity=.55
     for other in clusters:
      v=np.frombuffer(other['embedding'],dtype=np.float32)
      match=float(vector@v)
      if match>similarity:best,similarity=other['person_id'],match
     if best is None:
      best=uuid.uuid4().hex
      c.execute('INSERT INTO people VALUES(?,?,?)',(best,'',time.time()))
      clusters.append({'person_id':best,'embedding':vector.tobytes()})
     fid=uuid.uuid4().hex
     c.execute('INSERT INTO faces VALUES(?,?,?,?,?,?,?,0)',(fid,r['id'],r['revision'],best,json.dumps(face['box']),vector.tobytes(),self.provider.version))
   else:result.pop('faces',None)
   media=c.execute('SELECT data_json FROM media_info WHERE asset_id=? AND revision=?',(r['id'],r['revision'])).fetchone()
   info=json.loads(media['data_json']) if media else {}
   result['input_media_version']=info.get('version')
   if info.get('assumed_color') and info.get('score_penalty') and isinstance(result.get('score'),(int,float)):
    result.update(raw_score=result['score'],score_penalty=info['score_penalty'],score_penalty_reason='assumed_srgb')
    result['score']=max(0,result['raw_score']-result['score_penalty'])
   c.execute('INSERT OR REPLACE INTO analysis VALUES(?,?,?,?,?,?)',(r['id'],r['revision'],self.provider.id,self.provider.version,json.dumps(result),time.time()))
   if place:
    place.update(input_record=gps['record_id'],input_layer=gps['layer'],input_precision=gps['precision'])
    c.execute('INSERT OR REPLACE INTO analysis VALUES(?,?,?,?,?,?)',(r['id'],r['revision'],self.geo.id,self.geo.version,json.dumps(place),time.time()))
  progress.finish('failed' if result.get('error') else 'ready')
  if not result.get('error'):complete_file(self.db,r['id'],r['revision'])
  return True

def main():
 p=argparse.ArgumentParser();p.add_argument('--data',default='data/server');p.add_argument('--models',default='data/models');p.add_argument('--once',action='store_true');a=p.parse_args()
 from .providers import LocalVision
 worker=AnalysisWorker(Database(a.data),LocalVision(a.models))
 while True:
  try:
   worked=worker.tick()
  except Exception as exc:
   print('Analysis retry: '+type(exc).__name__,flush=True)
   worked=False
  if a.once:break
  if not worked:time.sleep(2)
if __name__=='__main__':main()
