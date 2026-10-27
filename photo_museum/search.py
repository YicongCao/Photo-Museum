"""Ordinary local search shares the curator's validated query engine. No model calls."""
import json, threading, time, uuid
from typing import Literal
from fastapi import Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from .curator_tools import LocalTools, SearchInput
from .lexicon import photo_terms, SnapshotDatabase
from .exhibitions import ExhibitionCatalog

class ReviewInput(BaseModel):
    model_config=ConfigDict(extra='forbid')
    revision:str=Field(max_length=256)
    keyword_id:str=Field(max_length=160)
    verdict:Literal[-1,1]
    expected_token:str|None=Field(default=None,max_length=40)

def register(app,db,owner):
    lock=threading.Lock();snapshot=[None,None]
    def engine():
        with lock:
            with db.connect() as c:
                c.execute('BEGIN')
                version=c.execute('SELECT catalog FROM runtime_revision WHERE id=1').fetchone()[0]
                if snapshot[0]!=version:
                    source=SnapshotDatabase(c)
                    photos=LocalTools(source,ExhibitionCatalog(source),'search').load()
                    snapshot[:]=[version,photos]
            tool=LocalTools(db,app.state.exhibitions,'ordinary-search');tool.photos=snapshot[1]
            return tool,version
    def run(body):
        tool,version=engine()
        try:
            result=tool.dispatch('search_photos',body.model_dump())
        except ValueError as e:raise HTTPException(422,str(e)) from None
        return tool.searches[result['search_id']]['photos'],version
    def pack(p):
        # Private owner UI only. Never send this projection to the LLM provider.
        tags=[]
        for domain,field in [('subject','subjects'),('topic','topics'),('style','styles')]:
            for t in p[field]:
                ids=list(photo_terms({field:[t]}))
                if ids:tags.append({'id':ids[0],'label':t['label'],'domain':domain,'rank':t.get('rank'),'confirmed':bool(t.get('confirmed'))})
        tags.sort(key=lambda t:not t['confirmed'])
        return {k:p[k] for k in ('id','revision','kind','name','thumbnail','preview','info','captured_at','event','period','camera','score','score_kind')}|{
            'evidence':{'tags':tags,'place':LocalTools.brief(p)['location'],'date_estimated':p['date_estimated'],'people':p['people_terms']}}
    def page(found,version,offset,limit):
        return {'items':[pack(p) for p in found[offset:offset+limit]],'total':len(found),'photos':len(found),'videos':0,'revision':version,
                'previews':[{'id':p['id'],'preview':p['preview']} for p in found[:15]] if offset==0 else []}
    @app.post('/api/search',dependencies=[Depends(owner)])
    def search(body:SearchInput):
        found,version=run(body);identifier=uuid.uuid4().hex
        with db.connect() as c:
            c.execute('INSERT INTO search_collections VALUES(?,?,?,?)',(identifier,body.filters.model_dump_json(),body.order,time.time()))
            c.execute('DELETE FROM search_collections WHERE created<?',(time.time()-30*86400,))
        return page(found,version,body.offset,body.limit)|{'id':identifier,'filters':body.filters.model_dump(),'order':body.order}
    @app.get('/api/search/collections/{identifier}',dependencies=[Depends(owner)])
    def collection(identifier:str,offset:int=Query(0,ge=0),limit:int=Query(100,ge=1,le=200)):
        with db.connect() as c:r=c.execute('SELECT * FROM search_collections WHERE id=?',(identifier,)).fetchone()
        if not r:raise HTTPException(404,'检索已过期，请重新检索')
        found,version=run(SearchInput(filters=json.loads(r['filters_json']),order=r['ordering']))
        return page(found,version,offset,limit)
    @app.get('/api/search/facets',dependencies=[Depends(owner)])
    def facets(field:Literal['country','province','city','camera','activity','year'],query:str=Query('',max_length=120)):
        tool,_=engine();return tool.dispatch('list_facets',{'field':field,'query':query,'limit':60})
    @app.get('/api/search/reviews',dependencies=[Depends(owner)])
    def reviews():
        tool,_=engine();visible={p['id']:p for p in tool.load()}
        with db.connect() as c:rows=c.execute('SELECT k.* FROM keyword_reviews k JOIN entries e ON e.id=k.asset_id AND e.revision=k.revision ORDER BY updated DESC LIMIT 100').fetchall()
        return {'items':[{'asset_id':r['asset_id'],'keyword_id':r['keyword_id'],'label':json.loads(r['tag_json'])['label'],'name':visible[r['asset_id']]['name'],'thumbnail':visible[r['asset_id']]['thumbnail'],'token':r['token'],'verdict':r['verdict']} for r in rows if r['asset_id'] in visible][:20]}
    @app.put('/api/search/reviews/{aid}',dependencies=[Depends(owner)])
    def review(aid:str,body:ReviewInput):
        tool,_=engine();p=next((p for p in tool.load() if p['id']==aid and p['revision']==body.revision),None)
        if not p:raise HTTPException(409,'照片已更新，请重新检索')
        field={'subject':'subjects','topic':'topics','style':'styles'}.get(body.keyword_id.split(':',1)[0]);tag=None
        for t in p.get(field,[]) if field else []:
            if body.keyword_id in photo_terms({field:[t]}):tag=t;break
        if not tag:raise HTTPException(422,'该照片没有此有效候选')
        provider='visual' if field=='subjects' else 'photography'
        tag=dict(tag,confirmed_source_version=p['lexicon_versions'].get(provider))
        with db.connect() as c:
            c.execute('BEGIN IMMEDIATE')
            current=c.execute('SELECT revision,missing,scope_excluded FROM entries WHERE id=?',(aid,)).fetchone()
            hidden=c.execute('SELECT excluded FROM curation WHERE asset_id=?',(aid,)).fetchone()
            if not current or current['revision']!=body.revision or current['missing'] or current['scope_excluded'] or hidden and hidden[0]:raise HTTPException(409,'照片已更新，请重新检索')
            old=c.execute('SELECT token FROM keyword_reviews WHERE asset_id=? AND revision=? AND keyword_id=?',(aid,body.revision,body.keyword_id)).fetchone()
            if old or body.expected_token is not None:raise HTTPException(409,'标记已改变，请刷新后操作')
            token=uuid.uuid4().hex
            c.execute('INSERT OR REPLACE INTO keyword_reviews VALUES(?,?,?,?,?,?,?)',(aid,body.revision,body.keyword_id,body.verdict,json.dumps(tag,ensure_ascii=False),token,time.time()))
        return {'token':token}
    @app.post('/api/search/reviews/{token}/undo',dependencies=[Depends(owner)])
    def undo(token:str):
        with db.connect() as c:
            if not c.execute('DELETE FROM keyword_reviews WHERE token=?',(token,)).rowcount:raise HTTPException(409,'标记已改变，无法撤销')
        return {'ok':True}
