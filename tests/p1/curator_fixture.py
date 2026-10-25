"""OpenAI-compatible synthetic SSE provider; no outbound connection or real credentials."""
import asyncio,json
import httpx

class Events(httpx.AsyncByteStream):
    def __init__(self,chunks,delay=0):self.chunks=chunks;self.delay=delay
    async def __aiter__(self):
        for chunk in self.chunks:
            if self.delay:await asyncio.sleep(self.delay)
            yield ('data: '+json.dumps(chunk,ensure_ascii=False)+'\n\n').encode()
        yield b'data: [DONE]\n\n'

class FakeLLM:
    def __init__(self,delay=0):self.requests=[];self.delay=delay;self.bad_status=None
    def __call__(self,request):
        payload=json.loads(request.content);self.requests.append(payload)
        if self.bad_status:return httpx.Response(self.bad_status,json={'error':'fake-provider-key must never be echoed'})
        messages=payload['messages'];names=[m.get('name') for m in []]
        results=[m for m in messages if m['role']=='tool'];n=len(results)
        user=next(m['content'] for m in messages if m['role']=='user')
        if 'slow' in user:return httpx.Response(200,headers={'content-type':'text/event-stream'},stream=Events([{'choices':[{'delta':{'reasoning_content':'等待中'}}]}],2))
        if n==0:call=('catalog_schema',{})
        elif n==1:call=('library_overview',{})
        elif n==2:call=('search_photos',{'filters':{'years':[2024]} if '2024' in user else {'years':[1901]} if '空结果' in user else {},'order':'diverse','limit':12})
        elif n==3:
            search=json.loads(results[-1]['content'])
            if not search['total']:call=None
            else:call=('create_exhibition',{'title':'合成策展 · 往日片段','search_id':search['search_id'],'room':'wall','max_photos':24})
        else:call=None
        chunks=[{'choices':[{'delta':{'reasoning_content':'根据本地索引核对条件，'}}]},{'choices':[{'delta':{'reasoning_content':'不扩展用户指定范围。'}}]}]
        if call:
            name,args=call;text=json.dumps(args,ensure_ascii=False);half=max(1,len(text)//2)
            chunks.extend([{'choices':[{'delta':{'tool_calls':[{'index':0,'id':'call-'+str(n),'type':'function','function':{'name':name,'arguments':text[:half]}}]}}]},
                           {'choices':[{'delta':{'tool_calls':[{'index':0,'function':{'arguments':text[half:]}}]},'finish_reason':'tool_calls'}]}])
        else:
            text='没有符合条件的照片，保留原条件。' if n==3 else '已根据本地索引完成选片，使用有效日期和技术评分；摄影标签为候选。'
            chunks.extend([{'choices':[{'delta':{'content':text[:10]}}]},{'choices':[{'delta':{'content':text[10:]},'finish_reason':'stop'}],'usage':{'prompt_tokens':100,'completion_tokens':30,'total_tokens':130}}])
        return httpx.Response(200,headers={'content-type':'text/event-stream'},stream=Events(chunks,self.delay))
