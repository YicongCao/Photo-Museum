"""Persistent, cancellable curation runs and authenticated immutable selection scopes."""
import asyncio
from contextlib import asynccontextmanager
from collections import defaultdict
import json,time,uuid
from pathlib import Path
from fastapi import Depends,HTTPException,Query,Request
from fastapi.responses import StreamingResponse
from pydantic import Field,ValidationError
from .curator_provider import ProviderInput,ProviderError,load_config,save_config,completion
from .curator_tools import Input,LocalTools,Filters,TOOLS,ROOMS,schema
from .cache import Cache
from .gallery import activity_time

TERMINAL=('completed','failed','cancelled','interrupted')
class RunInput(Input):
    prompt:str=Field(min_length=1,max_length=4000)
    room:str='auto'
    parent_run_id:str|None=Field(default=None,max_length=40)

class ScopedCatalog:
    def __init__(self,parent,assets):self.parent=parent;self.assets={p['id']:p['revision'] for p in assets}
    def photos(self):return [p for p in self.parent.photos() if self.assets.get(p['id'])==p['revision']]

class Curator:
    def __init__(self,db,security,catalog):
        self.db=db;self.security=security;self.catalog=catalog;self.tasks={};self.transport=None;self.stopping=False
        self.complete=completion
        with db.connect() as c:
            c.execute("UPDATE curator_runs SET status='interrupted',error='服务已重启，本次未自动重发',updated=? WHERE status IN ('queued','running','preparing')",(time.time(),))
    def get_run(self,rid):
        with self.db.connect() as c:r=c.execute('SELECT * FROM curator_runs WHERE id=?',(rid,)).fetchone()
        if not r:raise HTTPException(404,'策展任务不存在')
        return dict(r)
    def event(self,rid,kind,data):
        encoded=json.dumps(data,ensure_ascii=False)
        if len(encoded)>180000:raise ValueError('事件过大')
        with self.db.connect() as c:
            c.execute('INSERT INTO curator_events(run_id,kind,data_json,created) VALUES(?,?,?,?)',(rid,kind,encoded,time.time()))
            c.execute('UPDATE curator_runs SET updated=? WHERE id=?',(time.time(),rid))
    def update(self,rid,status,**fields):
        if set(fields)-{'answer','exhibition_id','error'}:raise ValueError('状态字段无效')
        with self.db.connect() as c:c.execute('UPDATE curator_runs SET status=?,updated=?'+''.join(','+k+'=?' for k in fields)+' WHERE id=?',(status,time.time(),*fields.values(),rid))
    def events(self,rid,after=0,limit=100):
        run=self.get_run(rid)
        with self.db.connect() as c:rows=c.execute('SELECT * FROM curator_events WHERE run_id=? AND id>? ORDER BY id LIMIT ?',(rid,after,limit)).fetchall()
        items=[{'id':r['id'],'kind':r['kind'],'data':json.loads(r['data_json']),'created':r['created']} for r in rows]
        return {'items':items,'cursor':items[-1]['id'] if items else after,'status':run['status']}
    def scope(self,eid):
        with self.db.connect() as c:r=c.execute('SELECT * FROM curator_exhibitions WHERE id=? AND prepared=1',(eid,)).fetchone()
        if not r:raise HTTPException(404,'展览未准备好或不存在')
        return ScopedCatalog(self.catalog,json.loads(r['assets_json']))
    async def start(self,body):
        if body.room not in ('auto',*ROOMS):raise HTTPException(422,'展厅无效')
        if not body.prompt.strip():raise HTTPException(422,'请输入策展想法')
        config=load_config(self.db,self.security,True)
        if not config['enabled'] or not config.get('api_key'):raise HTTPException(409,'请先配置Provider')
        # One run per museum. No duplicate remote calls on browser reload.
        rid=uuid.uuid4().hex;now=time.time()
        with self.db.connect() as c:
            c.execute('BEGIN IMMEDIATE')
            if c.execute("SELECT 1 FROM curator_runs WHERE status IN ('queued','running','preparing')").fetchone():raise HTTPException(409,'已有策展进行中，请等待或取消')
            prompt=body.prompt.strip().replace(config['api_key'],'[已隐藏]')
            if body.parent_run_id:
                old=c.execute("SELECT prompt,answer FROM curator_runs WHERE id=? AND status IN ('completed','failed')",(body.parent_run_id,)).fetchone()
                if not old:raise HTTPException(409,'上一轮任务不可续写')
                # Carry only a bounded user-visible context, never old model reasoning/tool payloads.
                prompt=('上一轮要求：'+old['prompt'][:3000]+'\n上一轮结果：'+old['answer'][:1500]+'\n本轮调整：'+prompt)[-8000:]
            c.execute('INSERT INTO curator_runs(id,prompt,room,status,created,updated) VALUES(?,?,?,?,?,?)',(rid,prompt,body.room,'queued',now,now))
        self.event(rid,'phase',{'stage':'queued','label':'等待模型'})
        task=asyncio.create_task(self.run(rid,config));self.tasks[rid]=task
        task.add_done_callback(lambda _:self.tasks.pop(rid,None));return self.get_run(rid)
    async def cancel(self,rid):
        run=self.get_run(rid)
        if run['status'] in TERMINAL:return run
        task=self.tasks.get(rid)
        if task:task.cancel();await asyncio.gather(task,return_exceptions=True)
        if self.get_run(rid)['status'] not in TERMINAL:
            self.update(rid,'cancelled');self.event(rid,'done',{'status':'cancelled'})
        return self.get_run(rid)
    async def shutdown(self):
        self.stopping=True
        for task in list(self.tasks.values()):task.cancel()
        await asyncio.gather(*list(self.tasks.values()),return_exceptions=True)
    async def prepare(self,rid,draft):
        self.update(rid,'preparing');self.event(rid,'phase',{'stage':'preparing','label':'检查本地缓存'})
        self.catalog.invalidate();fresh=LocalTools(self.db,self.catalog,rid,draft['room'])
        current={p['id']:p for p in await asyncio.to_thread(fresh.load)}
        filters=Filters.model_validate(draft['selection']['filters'])
        cache=Cache(self.db);selected=[];total=len(draft['photos']);skipped=0
        self.event(rid,'preparation',{'checked':0,'total':total,'ready':0,'skipped':0})
        def check(batch):
            good=[]
            for p in batch:
                now=current.get(p['id'])
                if now and now['revision']==p['revision'] and fresh.matches(now,filters) and cache.lookup(p['id'],p['revision'],'thumb') and cache.lookup(p['id'],p['revision'],'display'):good.append({'id':p['id'],'revision':p['revision']})
            return good
        for offset in range(0,total,16):
            batch=draft['photos'][offset:offset+16];good=await asyncio.to_thread(check,batch);selected.extend(good);skipped+=len(batch)-len(good)
            self.event(rid,'preparation',{'checked':offset+len(batch),'total':total,'ready':len(selected),'skipped':skipped})
        if not selected:raise ProviderError('所选照片已失效或缺少缓存，请重新策展')
        eid=uuid.uuid4().hex
        with self.db.connect() as c:
            c.execute('INSERT INTO curator_exhibitions VALUES(?,?,?,?,?,?,1,?)',(eid,rid,draft['title'],draft['room'],json.dumps(selected),json.dumps(draft['selection'],ensure_ascii=False),time.time()))
        self.update(rid,'completed',exhibition_id=eid)
        self.event(rid,'done',{'status':'completed','exhibition_id':eid,'count':len(selected),'skipped':skipped})
    async def run(self,rid,config):
        buffers={'thinking':'','answer':''};last_emit=time.monotonic();secret=config['api_key']
        def redact(value):return value.replace(secret,'[已隐藏]') if secret else value
        def flush(final=False):
            nonlocal last_emit
            for kind,text in list(buffers.items()):
                # Keep a key-sized suffix so a split provider echo cannot leak through chunks.
                cleaned=redact(text);keep=0 if final else len(secret)
                take=max(0,len(cleaned)-keep)
                if take:self.event(rid,kind,{'text':cleaned[:take]});buffers[kind]=cleaned[take:]
            last_emit=time.monotonic()
        async def delta(kind,text):
            buffers[kind]+=text
            if time.monotonic()-last_emit>.18 or sum(map(len,buffers.values()))>1000:flush()
        try:
            async with asyncio.timeout(240):
                run=self.get_run(rid);local=LocalTools(self.db,self.catalog,rid,run['room'])
                prompt=Path(__file__).with_name('curator-prompt.txt').read_text()
                messages=[{'role':'system','content':prompt+'\n当前日期：'+time.strftime('%Y-%m-%d')+'\n用户指定展厅：'+run['room']+'\n字段摘要：'+json.dumps(schema()['fields'],ensure_ascii=False)},
                          {'role':'user','content':run['prompt']}]
                self.update(rid,'running');calls=0;final_answer=''
                for turn in range(8):
                    if len(json.dumps(messages,ensure_ascii=False))>180000:raise ProviderError('本次上下文已达上限，请缩小筛选范围')
                    self.event(rid,'phase',{'stage':'thinking','round':turn+1,'label':'模型思考'})
                    message,usage=await self.complete(config,messages,TOOLS,delta,transport=self.transport)
                    flush(True);messages.append(message)
                    safe_usage={k:usage[k] for k in ('prompt_tokens','completion_tokens','total_tokens') if isinstance(usage.get(k),int)}
                    if safe_usage:self.event(rid,'usage',safe_usage)
                    tool_calls=message.get('tool_calls') or []
                    if not tool_calls:final_answer=redact(message.get('content') or '');break
                    for call in tool_calls:
                        calls+=1
                        if calls>24:raise ProviderError('已达本次工具调用上限')
                        name=call['function']['name'];started=time.monotonic()
                        try:
                            args=json.loads(call['function']['arguments'])
                            self.event(rid,'tool_start',{'call_id':redact(call['id']),'name':redact(name),'arguments':json.loads(redact(json.dumps(args,ensure_ascii=False)))})
                            result=await asyncio.to_thread(local.dispatch,name,args)
                        except (ValueError,ValidationError,KeyError,TypeError) as e:
                            result={'error':'工具参数、查询句柄或筛选值无效，请遵照schema并先检索候选'}
                        encoded=redact(json.dumps(result,ensure_ascii=False))
                        if len(encoded)>150000:raise ProviderError('工具结果过大，请缩小筛选')
                        self.event(rid,'tool_end',{'call_id':redact(call['id']),'name':redact(name),'duration_ms':round((time.monotonic()-started)*1000),'result':json.loads(encoded)})
                        messages.append({'role':'tool','tool_call_id':call['id'],'content':encoded})
                else:raise ProviderError('达到本次推理轮次上限，未发布展览')
                self.update(rid,'running',answer=final_answer)
                if local.draft:
                    local.draft['title']=redact(local.draft['title'])
                    await self.prepare(rid,local.draft)
                else:
                    self.update(rid,'completed');self.event(rid,'done',{'status':'completed','exhibition_id':None,'count':0})
        except asyncio.CancelledError:
            status='interrupted' if self.stopping else 'cancelled'
            flush(True);self.update(rid,status);self.event(rid,'done',{'status':status})
        except (ProviderError,TimeoutError) as e:
            flush(True);message='本次策展超时，未自动重试' if isinstance(e,TimeoutError) else str(e)
            self.update(rid,'failed',error=message);self.event(rid,'done',{'status':'failed','error':message})
        except Exception:
            flush(True);self.update(rid,'failed',error='本次策展中断，未自动重试');self.event(rid,'done',{'status':'failed','error':'本次策展中断，未自动重试'})


def register(app,db,security,owner):
    manager=Curator(db,security,app.state.exhibitions);app.state.curator=manager
    original=app.router.lifespan_context
    @asynccontextmanager
    async def lifespan(application):
        async with original(application):
            try:yield
            finally:await manager.shutdown()
    app.router.lifespan_context=lifespan
    @app.get('/api/curator/provider',dependencies=[Depends(owner)])
    def provider():return load_config(db,security)
    @app.put('/api/curator/provider',dependencies=[Depends(owner)])
    def configure(body:ProviderInput):
        if manager.tasks:raise HTTPException(409,'请先结束或取消当前策展')
        return save_config(db,security,body)
    @app.get('/api/curator/runs',dependencies=[Depends(owner)])
    def history():
        with db.connect() as c:rows=[dict(r) for r in c.execute('SELECT * FROM curator_runs ORDER BY created DESC LIMIT 30')]
        return {'items':rows}
    @app.post('/api/curator/runs',dependencies=[Depends(owner)])
    async def start(body:RunInput):return await manager.start(body)
    @app.get('/api/curator/runs/{rid}',dependencies=[Depends(owner)])
    def run(rid:str):return manager.get_run(rid)
    @app.post('/api/curator/runs/{rid}/cancel',dependencies=[Depends(owner)])
    async def cancel(rid:str):return await manager.cancel(rid)
    @app.get('/api/curator/runs/{rid}/events',dependencies=[Depends(owner)])
    def events(rid:str,after:int=Query(default=0,ge=0)):return manager.events(rid,after)
    @app.get('/api/curator/runs/{rid}/stream',dependencies=[Depends(owner)])
    async def stream(rid:str,request:Request,after:int=Query(default=0,ge=0)):
        manager.get_run(rid)
        try:cursor=max(after,int(request.headers.get('last-event-id','0')))
        except ValueError:raise HTTPException(422,'事件游标无效')
        async def generate():
            nonlocal cursor
            heartbeat=time.monotonic()
            while not await request.is_disconnected():
                result=await asyncio.to_thread(manager.events,rid,cursor)
                for item in result['items']:
                    cursor=item['id'];yield f"id: {cursor}\ndata: {json.dumps(item,ensure_ascii=False)}\n\n"
                if result['status'] in TERMINAL and len(result['items'])<100:
                    yield 'event: settled\ndata: {}\n\n';return
                if time.monotonic()-heartbeat>10:yield ': heartbeat\n\n';heartbeat=time.monotonic()
                await asyncio.sleep(.25)
        return StreamingResponse(generate(),media_type='text/event-stream',headers={'X-Accel-Buffering':'no'})
    @app.get('/api/curator/exhibitions/{exhibition_id}',dependencies=[Depends(owner)])
    def exhibition(exhibition_id:str):
        scope=manager.scope(exhibition_id);photos=scope.photos()
        with db.connect() as c:r=dict(c.execute('SELECT id,run_id,title,room,created FROM curator_exhibitions WHERE id=?',(exhibition_id,)).fetchone())
        return r|{'count':len(photos),'covers':[{'id':p['id'],'thumbnail':p['thumbnail']} for p in photos[:12]],'rooms':ROOMS}
    @app.get('/api/curator/exhibitions/{exhibition_id}/gallery',dependencies=[Depends(owner)])
    def scoped_gallery(exhibition_id:str):
        groups=defaultdict(list)
        for p in manager.scope(exhibition_id).photos():groups[p['activity_id']].append(p)
        activities=[]
        for aid,photos in groups.items():
            ranked=sorted((p for p in photos if p['score'] is not None),key=lambda p:(-p['score'],p['id']))
            activities.append({'id':aid,'event':photos[0]['event'],'latest_capture':activity_time(photos[0]['event'],[{'data_json':json.dumps({'captured_at':p['captured_at']})} for p in photos]),
                               'count':len(photos),'photos':len(photos),'videos':0,'selection_policy':'score-top10','selected':ranked[:10]})
        activities.sort(key=lambda a:(a['event'].get('year') or 0,a['event'].get('month') or 0,a['latest_capture'],a['id']),reverse=True)
        return {'activities':activities}
    @app.get('/api/curator/exhibitions/{exhibition_id}/gallery/{gid}',dependencies=[Depends(owner)])
    def scoped_activity(exhibition_id:str,gid:str,offset:int=Query(default=0,ge=0),limit:int=Query(default=100,ge=1,le=200)):
        photos=[p for p in manager.scope(exhibition_id).photos() if p['activity_id']==gid]
        photos.sort(key=lambda p:(p['period'] is None,p['period'] or '',str(p['captured_at'] or ''),p['name']))
        return {'items':photos[offset:offset+limit],'total':len(photos),'photos':len(photos),'videos':0,
                'previews':[{'id':p['id'],'preview':p['preview']} for p in photos[:15]] if offset==0 else []}
    from .exhibitions import register as register_exhibitions
    register_exhibitions(app,db,owner,prefix='/api/curator/exhibitions/{exhibition_id}',catalog_factory=manager.scope)
