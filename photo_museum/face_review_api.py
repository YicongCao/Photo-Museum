"""Owner-only local face questions; no images or vectors leave the server."""
import json
import time
from typing import Literal
from fastapi import Depends, HTTPException, Query
from pydantic import BaseModel, Field
from .gallery import media_url
from .face_matching import bank,unit,rank,VISIBLE,JOIN,REVIEW_MIN,POLICY


class Answer(BaseModel):
    request_id:str=Field(min_length=8,max_length=100)
    face_id:str=Field(min_length=1,max_length=128)
    person_id:str=Field(min_length=1,max_length=128)
    source_person_id:str=Field(min_length=1,max_length=128)
    model:str=Field(min_length=1,max_length=128)
    revision:str=Field(min_length=1,max_length=512)
    target_updated:float=Field(allow_inf_nan=False)
    decision:Literal['yes','no']


def current_model(c):
    row=c.execute("SELECT value FROM settings WHERE key='analysis_version'").fetchone()
    return row[0] if row else None


def register(app,database,owner,invalidate):
    @app.get('/api/face-review',dependencies=[Depends(owner)])
    def questions(after:str=Query('',max_length=128)):
        try:
            with database.connect() as c:
                c.execute('BEGIN')
                model=current_model(c)
                refs=bank(c,model) if model else {'named':{}}
                count=len({p for p,_ in refs['named']})
                if not count:return {'status':'needs_samples','items':[],'next_cursor':None,'examined':0,'people':0,'policy':POLICY}
                rows=[dict(r) for r in c.execute('SELECT f.id face_id,e.id,e.revision,f.person_id,f.model,f.embedding'+JOIN+' WHERE '+VISIBLE+" AND f.model=? AND f.manual=0 AND trim(p.label)='' AND f.id>? ORDER BY f.id LIMIT 251",(model,after))]
            more=len(rows)>250;rows=rows[:250];items=[]
            for r in rows:
                vector=unit(r['embedding'])
                if vector is None:continue
                matches=rank(vector,refs,r['id'],r['face_id'])
                if not matches or matches[0]['similarity']<REVIEW_MIN:continue
                match=matches[0]
                items.append({'face_id':r['face_id'],'source_person_id':r['person_id'],'revision':r['revision'],'model':r['model'],
                    'thumbnail':media_url(r,'thumb'),'portrait':'/api/faces/'+r['face_id']+'/portrait',
                    **{k:match[k] for k in ('person_id','label','target_updated','similarity','sample_count','support','margin')},
                    'examples':['/api/faces/'+fid+'/portrait' for fid in match['examples']]})
            items.sort(key=lambda r:(-r['similarity'],r['face_id']))
            return {'status':'ready','items':items,'next_cursor':rows[-1]['face_id'] if more else None,'examined':len(rows),'people':count,'policy':POLICY}
        except ImportError:
            return {'status':'unavailable','items':[],'next_cursor':None,'examined':0,'people':0,'policy':POLICY}

    @app.post('/api/face-review',dependencies=[Depends(owner)])
    def answer(body:Answer):
        with database.connect() as c:
            c.execute('BEGIN IMMEDIATE')
            previous=c.execute('SELECT * FROM face_reviews WHERE id=?',(body.request_id,)).fetchone()
            if previous:
                if (previous['face_id'],previous['person_id'],previous['decision'])!=(body.face_id,body.person_id,body.decision):raise HTTPException(409,'确认记录已变化，请重新读取')
                return {'ok':True,'id':previous['id']}
            r=c.execute('SELECT f.*,p.label'+JOIN+' WHERE '+VISIBLE+' AND f.id=? AND f.model=? AND f.revision=? AND f.manual=0 AND f.person_id=? AND trim(p.label)=\'\'',(body.face_id,body.model,body.revision,body.source_person_id)).fetchone()
            target=c.execute('SELECT updated FROM people WHERE id=?',(body.person_id,)).fetchone()
            if not r or body.model!=current_model(c) or not target or target['updated']!=body.target_updated:raise HTTPException(409,'面孔或人物已变化，请重新读取')
            v=unit(r['embedding']);refs=bank(c,body.model)
            matches=rank(v,refs,r['asset_id'],r['id']) if v is not None else []
            match=next((m for m in matches if m['person_id']==body.person_id and m['similarity']>=REVIEW_MIN),None)
            if not match:raise HTTPException(409,'面孔或人物已变化，请重新读取')
            if body.decision=='yes':
                invalidate(c,{body.face_id})
                c.execute('UPDATE faces SET person_id=?,manual=1 WHERE id=?',(body.person_id,body.face_id))
            c.execute('INSERT INTO face_reviews(id,face_id,person_id,decision,previous_person_id,previous_manual,model,revision,similarity,created,policy) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
                (body.request_id,body.face_id,body.person_id,body.decision,r['person_id'],r['manual'],body.model,body.revision,match['similarity'],time.time(),POLICY))
        return {'ok':True,'id':body.request_id}

    @app.get('/api/face-review/history',dependencies=[Depends(owner)])
    def history():
        with database.connect() as c:
            rows=[dict(r) for r in c.execute('SELECT r.id,r.decision,r.created,r.valid,r.undone,p.label FROM face_reviews r JOIN people p ON p.id=r.person_id ORDER BY r.created DESC,r.id DESC LIMIT 10')]
        return {'items':[{'id':r['id'],'decision':r['decision'],'label':r['label'],'created':r['created'],'can_undo':bool(r['valid'] and r['undone'] is None),'undone':r['undone'] is not None} for r in rows]}

    @app.post('/api/face-review/{rid}/undo',dependencies=[Depends(owner)])
    def undo(rid:str):
        with database.connect() as c:
            c.execute('BEGIN IMMEDIATE')
            r=c.execute('SELECT * FROM face_reviews WHERE id=?',(rid,)).fetchone()
            if not r:raise HTTPException(404)
            if r['undone'] is not None:return {'ok':True}
            if not r['valid']:raise HTTPException(409,'已有后续人工修订，无法直接撤销')
            if r['decision']=='yes':
                face=c.execute('SELECT * FROM faces WHERE id=?',(r['face_id'],)).fetchone()
                if not face or face['person_id']!=r['person_id'] or face['revision']!=r['revision'] or face['manual']!=1:raise HTTPException(409,'已有后续人工修订，无法直接撤销')
                invalidate(c,{r['face_id']})
                c.execute('UPDATE faces SET person_id=?,manual=? WHERE id=?',(r['previous_person_id'],r['previous_manual'],r['face_id']))
            c.execute('UPDATE face_reviews SET undone=? WHERE id=?',(time.time(),rid))
        return {'ok':True}
