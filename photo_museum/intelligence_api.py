import json
import time
import uuid
import io
import math
from fastapi import Depends,HTTPException,Query,Response
from pydantic import BaseModel,Field,field_validator
from .gallery import media_url
from .localization import localize_place, localize_tags
from .preferences import load_preferences,allowed_place

class PersonInput(BaseModel):
 label:str=Field(max_length=80)
 @field_validator('label')
 @classmethod
 def clean_label(cls,value):
  if any(ord(x)<32 or ord(x)==127 for x in value):raise ValueError('invalid_label')
  return value.strip()
class FaceInput(BaseModel):
 person_id:str|None=None
class MergeInput(BaseModel):
 target_id:str=Field(min_length=1,max_length=128)
 source_ids:list[str]=Field(min_length=1,max_length=200)

def invalidate_merges(c,ids,people=()):
 from .face_matching import invalidate_reviews
 invalidate_reviews(c,ids,people)
 # Any later correction of a moved face makes undo unsafe, even if moved back.
 for mid,raw,target,sources in c.execute('SELECT id,faces_json,target_id,sources_json FROM people_merges WHERE valid=1 AND undone IS NULL').fetchall():
  if any(f['id'] in ids for f in json.loads(raw)) or set(people).intersection([target]+json.loads(sources)):
   c.execute('UPDATE people_merges SET valid=0 WHERE id=?',(mid,))

# A manual identity correction survives model upgrades; automatic stale results do not.
ACTIVE_FACE="e.missing=0 AND e.scope_excluded=0 AND NOT EXISTS(SELECT 1 FROM curation h WHERE h.asset_id=e.id AND h.excluded=1) AND (f.manual=1 OR f.model=coalesce((SELECT value FROM settings WHERE key='analysis_version'),f.model))"
FACE_JOIN='FROM faces f JOIN entries e ON e.id=f.asset_id AND e.revision=f.revision'

def portrait_url(fid):return '/api/faces/'+fid+'/portrait'


def register(app,database,owner):
 from .face_review_api import register as register_review
 register_review(app,database,owner,invalidate_merges)
 @app.get('/api/intelligence',dependencies=[Depends(owner)])
 def overview():
  with database.connect() as c:
   rows=[dict(r) for r in c.execute("SELECT a.provider,a.version,count(*) count,sum(json_extract(a.data_json,'$.error') IS NOT NULL) failures FROM analysis a JOIN entries e ON e.id=a.asset_id AND e.revision=a.revision WHERE e.missing=0 AND e.scope_excluded=0 GROUP BY a.provider,a.version")]
   count=c.execute('SELECT count(*) '+FACE_JOIN+' WHERE '+ACTIVE_FACE).fetchone()[0]
   groups=c.execute('SELECT count(DISTINCT f.person_id),count(DISTINCT CASE WHEN trim(p.label)<>\'\' THEN p.id END),count(DISTINCT f.asset_id) '+FACE_JOIN+' JOIN people p ON p.id=f.person_id WHERE '+ACTIVE_FACE).fetchone()
  return {'providers':rows,'faces':count,'people':groups[0],'named_people':groups[1],'photos_with_faces':groups[2],'privacy':'local','scoring':'技术质量与构图评分，不是人类喜爱概率'}

 @app.get('/api/people',dependencies=[Depends(owner)])
 def people(q:str=Query('',max_length=80),named:str=Query('all',pattern='^(all|named|unnamed)$'),offset:int=Query(0,ge=0),limit:int=Query(36,ge=1,le=200),exact:bool=False):
  where=ACTIVE_FACE;args=[]
  if q.strip():
   if exact:where+=' AND p.label=? COLLATE NOCASE';args.append(q.strip())
   else:where+=" AND p.label LIKE ? ESCAPE '\\'";args.append('%'+q.strip().replace('\\','\\\\').replace('%','\\%').replace('_','\\_')+'%')
  if named!='all':where+=" AND trim(p.label)"+('!=' if named=='named' else '=')+"''"
  base=' FROM people p JOIN faces f ON f.person_id=p.id JOIN entries e ON e.id=f.asset_id AND e.revision=f.revision WHERE '+where
  with database.connect() as c:
   total=c.execute('SELECT count(DISTINCT p.id)'+base,args).fetchone()[0]
   rows=[dict(r) for r in c.execute('SELECT p.id,p.label,count(DISTINCT f.asset_id) count,count(*) face_count,min(f.id) sample'+base+' GROUP BY p.id ORDER BY count DESC,p.id LIMIT ? OFFSET ?',args+[limit,offset])]
   for r in rows:
    sample=r.pop('sample');f=c.execute('SELECT e.id,e.revision,f.box_json FROM faces f JOIN entries e ON e.id=f.asset_id WHERE f.id=?',(sample,)).fetchone()
    r.update(thumbnail=media_url(f,'thumb'),box=json.loads(f['box_json']),portrait=portrait_url(sample))
  return {'people':rows,'total':total,'offset':offset,'limit':limit}

 @app.get('/api/people/merges',dependencies=[Depends(owner)])
 def merge_history():
  with database.connect() as c:
   rows=c.execute('SELECT m.id,m.target_id,p.label,m.sources_json,m.created,m.valid,m.undone FROM people_merges m JOIN people p ON p.id=m.target_id ORDER BY m.created DESC,m.id DESC LIMIT 10').fetchall()
  return {'items':[{'id':r['id'],'target_id':r['target_id'],'label':r['label'],'groups':len(json.loads(r['sources_json']))+1,'created':r['created'],'can_undo':bool(r['valid'] and r['undone'] is None),'undone':r['undone'] is not None} for r in rows]}

 @app.post('/api/people/merges',dependencies=[Depends(owner)])
 def merge(body:MergeInput):
  sources=list(dict.fromkeys(body.source_ids));target=body.target_id
  if target in sources:raise HTTPException(422,'请选择不同的人物分组')
  with database.connect() as c:
   c.execute('BEGIN IMMEDIATE')
   for pid in [target]+sources:
    if not c.execute('SELECT 1 '+FACE_JOIN+' WHERE '+ACTIVE_FACE+' AND f.person_id=? LIMIT 1',(pid,)).fetchone():raise HTTPException(409,'人物分组已变化，请刷新后重选')
   identities=[target]+sources;placeholders=','.join('?' for _ in identities)
   # Include hidden/old records belonging to these identities so they retain
   # the correction on restoration; no boxes/features/revisions are altered.
   rows=[dict(r) for r in c.execute('SELECT f.id,f.asset_id,f.revision,f.person_id,f.manual,CASE WHEN EXISTS(SELECT 1 FROM entries e WHERE e.id=f.asset_id AND e.revision=f.revision AND '+ACTIVE_FACE+') THEN 1 ELSE f.manual END merged_manual FROM faces f WHERE f.person_id IN ('+placeholders+')',identities)]
   invalidate_merges(c,{r['id'] for r in rows})
   mid=uuid.uuid4().hex
   c.execute('INSERT INTO people_merges(id,target_id,sources_json,faces_json,created) VALUES(?,?,?,?,?)',(mid,target,json.dumps(sources),json.dumps(rows),time.time()))
   c.executemany('UPDATE faces SET person_id=?,manual=? WHERE id=?',[(target,r['merged_manual'],r['id']) for r in rows])
   # Sources are retained as empty groups for undo; names are never overwritten.
   person=dict(c.execute('SELECT id,label FROM people WHERE id=?',(target,)).fetchone())
  return {'ok':True,'merge_id':mid,'person':person,'moved_faces':sum(r['person_id']!=target for r in rows)}

 @app.post('/api/people/merges/{mid}/undo',dependencies=[Depends(owner)])
 def undo_merge(mid:str):
  with database.connect() as c:
   c.execute('BEGIN IMMEDIATE')
   record=c.execute('SELECT * FROM people_merges WHERE id=?',(mid,)).fetchone()
   if not record:raise HTTPException(404)
   if record['undone'] is not None:return {'ok':True}
   if not record['valid']:raise HTTPException(409,'合并后的分组已被修改，无法直接撤销')
   rows=json.loads(record['faces_json'])
   for old in rows:
    now=c.execute('SELECT person_id,revision,manual FROM faces WHERE id=?',(old['id'],)).fetchone()
    if not now or now['person_id']!=record['target_id'] or now['revision']!=old['revision'] or now['manual']!=old['merged_manual']:raise HTTPException(409,'合并后的分组已被修改，无法直接撤销')
   invalidate_merges(c,{r['id'] for r in rows})
   c.executemany('UPDATE faces SET person_id=?,manual=? WHERE id=?',[(r['person_id'],r['manual'],r['id']) for r in rows])
   c.execute('UPDATE people_merges SET undone=? WHERE id=?',(time.time(),mid))
  return {'ok':True}

 @app.post('/api/people/{pid}',dependencies=[Depends(owner)])
 def label(pid:str,body:PersonInput):
  with database.connect() as c:
   c.execute('BEGIN IMMEDIATE')
   if not c.execute('SELECT 1 FROM people WHERE id=?',(pid,)).fetchone():raise HTTPException(404)
   invalidate_merges(c,set(),{pid})
   c.execute('UPDATE people SET label=?,updated=? WHERE id=?',(body.label,time.time(),pid))
   c.execute('UPDATE faces SET manual=1 WHERE id IN (SELECT f.id '+FACE_JOIN+' WHERE '+ACTIVE_FACE+' AND f.person_id=?)',(pid,))
  return {'ok':True}

 @app.get('/api/people/{pid}/faces',dependencies=[Depends(owner)])
 def faces(pid:str,offset:int=Query(0,ge=0),limit:int=Query(48,ge=1,le=200)):
  with database.connect() as c:
   if not c.execute('SELECT 1 FROM people WHERE id=?',(pid,)).fetchone():raise HTTPException(404)
   base=FACE_JOIN+' WHERE '+ACTIVE_FACE+' AND f.person_id=?'
   total=c.execute('SELECT count(*) '+base,(pid,)).fetchone()[0]
   rows=[dict(r) for r in c.execute('SELECT f.id face_id,e.id,e.revision,f.box_json,f.manual '+base+' ORDER BY e.path DESC,f.id LIMIT ? OFFSET ?',(pid,limit,offset))]
  return {'items':[{k:v for k,v in r.items() if k!='box_json'}|{'thumbnail':media_url(r,'thumb'),'box':json.loads(r['box_json']),'portrait':portrait_url(r['face_id'])} for r in rows],'total':total,'offset':offset,'limit':limit}

 @app.get('/api/faces/{fid}/portrait',dependencies=[Depends(owner)])
 def portrait(fid:str):
  from .cache import Cache
  from PIL import Image,ImageOps,UnidentifiedImageError
  with database.connect() as c:r=c.execute('SELECT f.asset_id,f.revision,f.box_json '+FACE_JOIN+' WHERE '+ACTIVE_FACE+' AND f.id=?',(fid,)).fetchone()
  if not r:raise HTTPException(404)
  path=Cache(database).lookup(r['asset_id'],r['revision'],'thumb')
  if not path:raise HTTPException(404)
  try:
   box=json.loads(r['box_json'])
   if len(box)!=4 or not all(isinstance(v,(int,float)) and math.isfinite(v) for v in box) or box[2]<=0 or box[3]<=0:raise ValueError()
   with Image.open(path) as raw:
    image=ImageOps.exif_transpose(raw).convert('RGB');x,y,w,h=box
    cx,cy=(x+w/2)*image.width,(y+h/2)*image.height;side=min(max(w*image.width,h*image.height)*1.45,image.width,image.height)
    left=max(0,min(cx-side/2,image.width-side));top=max(0,min(cy-side/2,image.height-side))
    crop=image.crop((left,top,left+side,top+side)).resize((160,160),Image.Resampling.LANCZOS)
    out=io.BytesIO();crop.save(out,'WEBP',quality=82)
  except (ValueError,TypeError,OSError,UnidentifiedImageError):raise HTTPException(404) from None
  return Response(out.getvalue(),media_type='image/webp',headers={'Cache-Control':'private, no-store'})

 @app.post('/api/faces/{fid}/assign',dependencies=[Depends(owner)])
 def assign(fid:str,body:FaceInput):
  with database.connect() as c:
   c.execute('BEGIN IMMEDIATE')
   if not c.execute('SELECT 1 '+FACE_JOIN+' WHERE '+ACTIVE_FACE+' AND f.id=?',(fid,)).fetchone():raise HTTPException(404)
   pid=body.person_id or uuid.uuid4().hex
   if body.person_id and not c.execute('SELECT 1 FROM people WHERE id=?',(pid,)).fetchone():raise HTTPException(404)
   c.execute('INSERT OR IGNORE INTO people VALUES(?,?,?)',(pid,'',time.time()))
   invalidate_merges(c,{fid})
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
  with database.connect() as c:
   result['people']={'items':[dict(r) for r in c.execute('SELECT p.id,p.label,count(*) face_count '+FACE_JOIN+' JOIN people p ON p.id=f.person_id WHERE '+ACTIVE_FACE+' AND f.asset_id=? GROUP BY p.id ORDER BY p.label,p.id',(aid,))]}
  return result
