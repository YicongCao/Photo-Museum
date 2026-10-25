import json
import time
import uuid
from fastapi import Depends,HTTPException
from pydantic import BaseModel,Field
from .gallery import media_url
from .localization import localize_place, localize_tags
from .preferences import load_preferences,allowed_place

class PersonInput(BaseModel):
 label:str=Field(max_length=80)
class FaceInput(BaseModel):
 person_id:str|None=None


def register(app,database,owner):
 @app.get('/api/intelligence',dependencies=[Depends(owner)])
 def overview():
  with database.connect() as c:
   rows=[dict(r) for r in c.execute("SELECT a.provider,a.version,count(*) count,sum(json_extract(a.data_json,'$.error') IS NOT NULL) failures FROM analysis a JOIN entries e ON e.id=a.asset_id AND e.revision=a.revision WHERE e.missing=0 AND e.scope_excluded=0 GROUP BY a.provider,a.version")]
   count=c.execute('SELECT count(*) FROM faces f JOIN entries e ON e.id=f.asset_id AND e.revision=f.revision WHERE e.missing=0 AND e.scope_excluded=0').fetchone()[0]
  return {'providers':rows,'faces':count,'privacy':'local','scoring':'技术质量与构图评分，不是人类喜爱概率'}

 @app.get('/api/people',dependencies=[Depends(owner)])
 def people():
  with database.connect() as c:
   rows=[dict(r) for r in c.execute("""SELECT p.id,p.label,count(DISTINCT f.asset_id) count,min(f.id) sample FROM people p JOIN faces f ON f.person_id=p.id JOIN entries e ON e.id=f.asset_id AND e.revision=f.revision WHERE e.missing=0 AND e.scope_excluded=0 GROUP BY p.id ORDER BY count DESC LIMIT 200""")]
   for r in rows:
    f=c.execute('SELECT e.id,e.revision,f.box_json FROM faces f JOIN entries e ON e.id=f.asset_id WHERE f.id=?',(r.pop('sample'),)).fetchone()
    r.update(thumbnail=media_url(f,'thumb'),box=json.loads(f['box_json']))
  return {'people':rows}

 @app.post('/api/people/{pid}',dependencies=[Depends(owner)])
 def label(pid:str,body:PersonInput):
  with database.connect() as c:
   if not c.execute('SELECT 1 FROM people WHERE id=?',(pid,)).fetchone():raise HTTPException(404)
   c.execute('UPDATE people SET label=?,updated=? WHERE id=?',(body.label,time.time(),pid))
   c.execute('UPDATE faces SET manual=1 WHERE person_id=?',(pid,))
  return {'ok':True}

 @app.get('/api/people/{pid}/faces',dependencies=[Depends(owner)])
 def faces(pid:str):
  with database.connect() as c:
   rows=[dict(r) for r in c.execute('SELECT f.id face_id,e.id,e.revision,e.path,f.box_json FROM faces f JOIN entries e ON e.id=f.asset_id AND e.revision=f.revision WHERE f.person_id=? AND e.missing=0 AND e.scope_excluded=0 LIMIT 200',(pid,))]
  return {'items':[r|{'thumbnail':media_url(r,'thumb'),'box':json.loads(r['box_json'])} for r in rows]}

 @app.post('/api/faces/{fid}/assign',dependencies=[Depends(owner)])
 def assign(fid:str,body:FaceInput):
  with database.connect() as c:
   if not c.execute('SELECT 1 FROM faces WHERE id=?',(fid,)).fetchone():raise HTTPException(404)
   pid=body.person_id or uuid.uuid4().hex
   if body.person_id and not c.execute('SELECT 1 FROM people WHERE id=?',(pid,)).fetchone():raise HTTPException(404)
   c.execute('INSERT OR IGNORE INTO people VALUES(?,?,?)',(pid,'',time.time()))
   c.execute('UPDATE faces SET person_id=?,manual=1 WHERE id=?',(pid,fid))
  return {'person_id':pid}

 @app.get('/api/assets/{aid}/analysis',dependencies=[Depends(owner)])
 def analysis(aid:str):
  with database.connect() as c:
   rows=c.execute('SELECT a.* FROM analysis a JOIN entries e ON e.id=a.asset_id AND e.revision=a.revision WHERE a.asset_id=? AND e.missing=0 AND e.scope_excluded=0',(aid,)).fetchall()
  result={r['provider']:{'version':r['version'],'data':{k:v for k,v in json.loads(r['data_json']).items() if k!='embedding'}} for r in rows}
  gps=database.effective(aid).get('gps')
  if 'places' in result and (not gps or result['places']['data'].get('input_record')!=gps['record_id']):
   del result['places']
  if 'places' in result and not allowed_place(result['places']['data'],gps.get('layer') if gps else None,load_preferences(database)):del result['places']
  if 'visual' in result and 'tags' in result['visual']['data']:
   result['visual']['data']['tags']=localize_tags(result['visual']['data']['tags'])
  if 'places' in result:result['places']['data']=localize_place(result['places']['data'])
  from .photography import current
  with database.connect() as c:photography=current(c,aid,rows[0]['revision']) if rows else None
  if photography:result['photography']=photography
  else:result.pop('photography',None)
  return result
