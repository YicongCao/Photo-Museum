"""Authenticated unified settings. Existing identities and secrets stay server-side."""
import json,os
from pathlib import Path
from fastapi import Depends,HTTPException
from pydantic import BaseModel,ConfigDict,Field
from .preferences import PreferenceInput,read_preferences,geocode_query,geography_stamp
from .curator_provider import load_config
from .read_snapshot import cached_read

class SourceEdit(BaseModel):
 model_config=ConfigDict(extra='forbid')
 name:str=Field(min_length=1,max_length=80)
 username:str=Field(min_length=1,max_length=256)
 password:str=Field(default='',max_length=1024)
 ca_pem:str|None=Field(default=None,max_length=16000)

def register(app,db,security,owner,dav_factory):
 def geo_status(c,p):
  settings=dict(c.execute("SELECT key,value FROM settings WHERE key IN ('geography_generation','geography_version','geography_policy_stamp')"))
  generation=int(settings.get('geography_generation','0'))
  version=settings.get('geography_version')
  expected=geography_stamp(p,generation)
  awaiting=settings.get('geography_policy_stamp')!=expected
  total=c.execute("""WITH ranked AS(SELECT m.*,row_number() OVER(PARTITION BY m.asset_id ORDER BY CASE layer WHEN 'manual' THEN 0 WHEN 'observed' THEN 1 ELSE 2 END) priority FROM metadata m JOIN entries e ON e.id=m.asset_id WHERE m.field='gps' AND m.stale=0 AND e.missing=0 AND e.scope_excluded=0 AND (m.layer='manual' OR m.source_revision=e.revision) AND (m.layer!='inferred' OR json_extract(m.info_json,'$.accepted')=1)) SELECT count(*) FROM ranked WHERE priority=1 AND value_json!='null' AND (? OR layer!='inferred')""",(p['gps_use_inferred'],)).fetchone()[0]
  pending=c.execute('SELECT count(*) FROM ('+geocode_query()+')',(p['gps_use_inferred'],version)).fetchone()[0] if version and not awaiting else None
  models=Path(os.environ.get('MUSEUM_MODELS',db.directory.parent/'models'))/'geonames'
  available=all((models/name).is_file() for name in ('cities15000.zip','admin1.txt','countries.txt')) and os.environ.get('MUSEUM_ANALYSIS_ENABLED')=='1'
  return {'available':available,'awaiting_worker':awaiting,'total':total,'pending':pending,'completed':total-pending if pending is not None else None,'paused':p['gps_mode']=='disabled','generation':generation}
 @app.get('/api/preferences',dependencies=[Depends(owner)])
 def preferences():
  with db.connect() as c:return read_preferences(c)
 @app.put('/api/preferences',dependencies=[Depends(owner)])
 def update(body:PreferenceInput):
  with db.connect() as c:
   c.execute('BEGIN IMMEDIATE');old=read_preferences(c)
   if body.revision!=old['revision']:raise HTTPException(409,'设置已在其他页面更新，请重新读取')
   values=body.model_dump(exclude={'revision'});revision=old['revision']+1
   c.execute("INSERT OR REPLACE INTO settings VALUES('preferences',?)",(json.dumps({'values':values,'revision':revision}),))
  app.state.exhibitions.invalidate()
  return values|{'revision':revision}
 @app.get('/api/settings',dependencies=[Depends(owner)])
 @cached_read(db)
 def overview():
  with db.connect() as c:
   p=read_preferences(c)
   sources=[dict(r)|{'has_password':bool(r['has_password'])} for r in c.execute('SELECT id,name,url,root,username,ca_pem,allow_http,(secret IS NOT NULL) has_password FROM sources ORDER BY created')]
   cache={'used_bytes':c.execute('SELECT coalesce(sum(size),0) FROM cache_files').fetchone()[0],
          'budget_bytes':int(c.execute("SELECT value FROM settings WHERE key='cache_budget'").fetchone()[0]),
          'paused':c.execute("SELECT value FROM settings WHERE key='media_paused'").fetchone()[0]=='true'}
   geography=geo_status(c,p)
  return {'preferences':p,'provider':load_config(db,security),'sources':sources,'cache':cache,'geography':geography}
 @app.put('/api/settings/sources/{sid}',dependencies=[Depends(owner)])
 def source(sid:str,body:SourceEdit):
  with db.connect() as c:row=c.execute('SELECT * FROM sources WHERE id=?',(sid,)).fetchone()
  if not row:raise HTTPException(404,'照片源不存在')
  values=dict(row)|body.model_dump(exclude={'password'})
  password=body.password or security.decrypt(row['secret'])
  client=dav_factory(values,password);client.close()
  with db.connect() as c:
   c.execute('UPDATE sources SET name=?,username=?,secret=?,ca_pem=? WHERE id=?',(body.name,body.username,security.encrypt(password),body.ca_pem,sid))
  return {'ok':True}
 @app.post('/api/settings/geography/refresh',dependencies=[Depends(owner)])
 def refresh():
  with db.connect() as c:
   c.execute('BEGIN IMMEDIATE');p=read_preferences(c);status=geo_status(c,p)
   if not status['available']:raise HTTPException(409,'离线地址数据或分析进程未就绪')
   if status['paused']:raise HTTPException(409,'请先启用离线地址解析')
   c.execute("INSERT OR REPLACE INTO settings VALUES('geography_generation',?)",(str(status['generation']+1),))
  return {'queued':True,'scope':'local-gps-only'}
