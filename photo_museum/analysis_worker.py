"""Rebuildable local analysis, with human cluster labels/pins kept separately."""
from .runtime_revision import revision as work_revision
import argparse
import json
import time
import uuid
from pathlib import Path
from .db import Database
from .processing import Progress, complete_file
from .cache import Cache
from .work_queue import choose_directory
from .worker_runtime import is_database_busy, run_loop
from .preferences import load_preferences,read_preferences,geography_version,geography_stamp,geocode_query

class AnalysisWorker:
 def __init__(self,database,provider):
  self.db,self.provider=database,provider
  self.cache=Cache(database)
  self.geo=None
  self.geo_ticks=0
  if hasattr(provider,'models') and (provider.models/'geonames/cities15000.zip').is_file():
   from .geography import GeoNames
   self.geo=GeoNames(provider.models/'geonames')

 def geocode_one(self):
  if not self.geo:return False
  with self.db.connect() as c:
   p=read_preferences(c);generation=c.execute("SELECT value FROM settings WHERE key='geography_generation'").fetchone()
   generation=int(generation[0]) if generation else 0;version=geography_version(self.geo.version,p,generation)
   if p['gps_mode']=='disabled':return False
   row=c.execute(geocode_query()+' LIMIT 1',(p['gps_use_inferred'],version)).fetchone()
  if not row:return False
  value=json.loads(row['value_json'])
  result=self.geo.reverse(value,max_distance_m=p['gps_max_distance_km']*1000) if isinstance(value,dict) and all(isinstance(value.get(k),(int,float)) for k in ('latitude','longitude')) else {'status':'unknown'}
  result.update(input_record=row['record_id'],input_layer=row['layer'],input_precision=json.loads(row['info_json']).get('precision'))
  if self.db.effective(row['asset_id']).get('gps',{}).get('record_id')!=row['record_id']:return True
  with self.db.connect() as c:
   current=read_preferences(c);g=c.execute("SELECT value FROM settings WHERE key='geography_generation'").fetchone()
   if current['gps_mode']=='disabled' or geography_version(self.geo.version,current,int(g[0]) if g else 0)!=version:return True
   c.execute('INSERT OR REPLACE INTO analysis VALUES(?,?,?,?,?,?)',(row['asset_id'],row['revision'],'places',version,json.dumps(result),time.time()))
  return True

 def tick(self):
  with self.db.connect() as c:
   if c.execute("SELECT value FROM settings WHERE key='media_paused'").fetchone()[0]=='true':return False
   versions={'analysis_version':self.provider.version}
   if self.geo:
    p=read_preferences(c);g=c.execute("SELECT value FROM settings WHERE key='geography_generation'").fetchone();g=int(g[0]) if g else 0
    versions.update(geography_version=geography_version(self.geo.version,p,g),geography_policy_stamp=geography_stamp(p,g))
   for key,value in versions.items():
    previous=c.execute('SELECT value FROM settings WHERE key=?',(key,)).fetchone()
    if not previous or previous['value']!=value:
     c.execute('INSERT OR REPLACE INTO settings VALUES(?,?)',(key,value))
  focus=choose_directory(self.db)
  with self.db.connect() as c:
   r=c.execute("""SELECT e.id,e.revision,m.updated media_updated FROM entries e JOIN media_info m INDEXED BY media_readiness ON m.asset_id=e.id AND m.revision=e.revision JOIN media_jobs q ON q.asset_id=e.id AND q.revision=e.revision WHERE q.status='ready' AND e.missing=0 AND e.scope_excluded=0 AND coalesce(json_extract(m.data_json,'$.metadata_only'),0)=0 AND (? IS NULL OR (e.source_id=? AND e.parent=?)) AND NOT EXISTS(SELECT 1 FROM analysis a INDEXED BY analysis_readiness WHERE a.asset_id=e.id AND a.revision=e.revision AND a.provider=? AND a.version=? AND json_extract(a.data_json,'$.input_media_version') IS json_extract(m.data_json,'$.version')) ORDER BY e.parent DESC,e.path DESC LIMIT 1""",(focus['source_id'] if focus else None,focus['source_id'] if focus else None,focus['parent'] if focus else None,self.provider.id,self.provider.version)).fetchone()
  self.geo_ticks+=1
  if (not r or self.geo_ticks%5==0) and self.geocode_one():return True
  if not r:return False
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
   if is_database_busy(exc):raise
   progress.finish('failed')
   result={'error':type(exc).__name__,'offline':True}
  progress.report('address')
  gps=self.db.effective(r['id']).get('gps')
  p=load_preferences(self.db)
  with self.db.connect() as c:g=c.execute("SELECT value FROM settings WHERE key='geography_generation'").fetchone()
  place_version=geography_version(self.geo.version,p,int(g[0]) if g else 0) if self.geo else None
  place=self.geo.reverse(gps['value'],max_distance_m=p['gps_max_distance_km']*1000) if self.geo and p['gps_mode']=='offline' and gps and (gps['layer']!='inferred' or p['gps_use_inferred']) and isinstance(gps['value'],dict) else None
  progress.report('address','done' if place and place.get('status')!='unknown' else 'skipped')
  with self.db.connect() as c:
   c.execute('BEGIN IMMEDIATE')
   current=c.execute('SELECT revision,missing FROM entries WHERE id=?',(r['id'],)).fetchone()
   if not current or current['missing'] or current['revision']!=r['revision']:return True
   media=c.execute("SELECT m.updated,q.status FROM media_info m JOIN media_jobs q ON q.asset_id=m.asset_id AND q.revision=m.revision WHERE m.asset_id=? AND m.revision=?",(r['id'],r['revision'])).fetchone()
   if not media or media['updated']!=r['media_updated'] or media['status']!='ready':return True
   existing=c.execute('SELECT 1 FROM faces WHERE asset_id=? AND revision=? AND manual=1',(r['id'],r['revision'])).fetchone()
   if not existing:
    c.execute('DELETE FROM face_matches WHERE face_id IN (SELECT id FROM faces WHERE asset_id=? AND revision=?)',(r['id'],r['revision']))
    c.execute('DELETE FROM faces WHERE asset_id=? AND revision=?',(r['id'],r['revision']))
    from .face_matching import bank,unit,assign_new,POLICY
    references=bank(c,self.provider.version);used=set()
    for face in result.pop('faces',[]):
     vector=unit(face['embedding'])
     if vector is None:
      result['invalid_face_features']=result.get('invalid_face_features',0)+1;continue
     best,match=assign_new(vector,references,r['id'],used)
     if best is None:
      best=uuid.uuid4().hex
      c.execute('INSERT INTO people VALUES(?,?,?)',(best,'',time.time()))
     fid=uuid.uuid4().hex;used.add(best)
     c.execute('INSERT INTO faces VALUES(?,?,?,?,?,?,?,0)',(fid,r['id'],r['revision'],best,json.dumps(face['box']),vector.tobytes(),self.provider.version))
     if match:
      c.execute('INSERT OR REPLACE INTO face_matches VALUES(?,?,?,?,?,?,?,?)',(fid,best,self.provider.version,POLICY,match['similarity'],match['support'],match['margin'],time.time()))
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
    now_p=read_preferences(c);now_g=c.execute("SELECT value FROM settings WHERE key='geography_generation'").fetchone()
    if now_p['gps_mode']=='offline' and geography_version(self.geo.version,now_p,int(now_g[0]) if now_g else 0)==place_version:
     c.execute('INSERT OR REPLACE INTO analysis VALUES(?,?,?,?,?,?)',(r['id'],r['revision'],self.geo.id,place_version,json.dumps(place),time.time()))
  progress.finish('failed' if result.get('error') else 'ready')
  if not result.get('error'):complete_file(self.db,r['id'],r['revision'])
  return True

def main():
 p=argparse.ArgumentParser();p.add_argument('--data',default='data/server');p.add_argument('--models',default='data/models');p.add_argument('--once',action='store_true');a=p.parse_args()
 from .providers import LocalVision
 worker=AnalysisWorker(Database(a.data),LocalVision(a.models))
 run_loop(worker.tick, revision=lambda: work_revision(worker.db),idle=2,once=a.once)
if __name__=='__main__':main()
