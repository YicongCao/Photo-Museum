"""Server-only encrypted provider configuration and bounded TokenHub streaming."""
import json
import ipaddress
import os
from urllib.parse import urlsplit
import httpx
from pydantic import BaseModel,Field,ConfigDict
from .curator_limits import MAX_TOOLS_PER_RESPONSE, MAX_ARGUMENT_CHARACTERS

DEFAULT_URL='https://tokenhub.tencentmaas.com/v1'
DEFAULT_MODEL='hy4-preview'

class ProviderInput(BaseModel):
    model_config=ConfigDict(extra='forbid')
    base_url:str=Field(default=DEFAULT_URL,max_length=2048)
    model:str=Field(default=DEFAULT_MODEL,min_length=1,max_length=100)
    api_key:str=Field(default='',max_length=2048)
    temperature:float=Field(default=1.1,ge=0,le=2,allow_inf_nan=False)
    enabled:bool=True


def validate_url(value):
    value=value.rstrip('/');u=urlsplit(value)
    if u.username or u.password or u.query or u.fragment or not u.hostname:raise ValueError('Provider地址无效')
    testing=os.environ.get('MUSEUM_TEST_PROVIDER')=='1'
    loopback=u.hostname=='localhost'
    try:loopback=loopback or ipaddress.ip_address(u.hostname).is_loopback
    except ValueError:pass
    if u.scheme!='https' and not(testing and u.scheme=='http' and loopback):raise ValueError('Provider需要HTTPS')
    return value


def load_config(db,security,private=False):
    with db.connect() as c:row=c.execute("SELECT value FROM settings WHERE key='curator_provider'").fetchone()
    config=json.loads(security.decrypt(row[0])) if row else {'base_url':DEFAULT_URL,'model':DEFAULT_MODEL,'temperature':1.1,'enabled':False,'api_key':''}
    if private:return config
    return {k:v for k,v in config.items() if k!='api_key'}|{'configured':bool(config.get('api_key')),'thinking':True,'reasoning_effort':'high'}


def save_config(db,security,body):
    config=body.model_dump();config['base_url']=validate_url(config['base_url'])
    config['api_key']=config['api_key'].strip()
    if not config['api_key']:
        previous=load_config(db,security,True)
        if previous.get('api_key') and config['base_url']!=previous['base_url']:raise ValueError('更换Provider地址时请重新输入API key')
        config['api_key']=previous.get('api_key','')
    if config['enabled'] and not config['api_key']:raise ValueError('请输入API key')
    encrypted=security.encrypt(json.dumps(config,ensure_ascii=False))
    with db.connect() as c:c.execute("INSERT OR REPLACE INTO settings VALUES('curator_provider',?)",(encrypted,))
    return load_config(db,security)


class ProviderError(Exception):pass

async def completion(config,messages,tools,on_delta,transport=None,max_tokens=6000):
    payload={'model':config['model'],'messages':messages,'tools':tools,'tool_choice':'auto','stream':True,
             'temperature':config['temperature'],'thinking':{'type':'enabled'},'reasoning_effort':'high','max_tokens':max_tokens}
    answer='';reasoning='';calls={};finish=None;usage={}
    async def lines(response):
        size=0;buffer=b''
        async for block in response.aiter_bytes():
            size+=len(block)
            if size>1500000:raise ProviderError('Provider响应过大')
            buffer+=block
            while b'\n' in buffer:
                line,buffer=buffer.split(b'\n',1);yield line.decode('utf-8').rstrip('\r')
        if buffer:yield buffer.decode('utf-8').rstrip('\r')
    async def consume(chunk):
        nonlocal answer,reasoning,finish,usage
        usage=chunk.get('usage') or usage
        choices=chunk.get('choices') or []
        if not choices:return
        choice=choices[0];delta=choice.get('delta') or choice.get('message') or {}
        if choice.get('finish_reason'):finish=choice['finish_reason']
        for field,kind in [('reasoning_content','thinking'),('content','answer')]:
            value=delta.get(field)
            if not isinstance(value,str):continue
            if field=='content':answer+=value
            else:reasoning+=value
            if len(answer)>64000 or len(reasoning)>120000:raise ProviderError('模型输出超过本次上限')
            await on_delta(kind,value)
        for item in delta.get('tool_calls') or []:
            index=item.get('index',len(calls));call=calls.setdefault(index,{'id':'','type':'function','function':{'name':'','arguments':''}})
            if item.get('id'):call['id']=item['id']
            function=item.get('function') or {}
            for k in ('name','arguments'):
                value=function.get(k,'')
                if not isinstance(value,str):raise ProviderError('工具调用格式无效')
                call['function'][k]+=value
            if len(calls)>MAX_TOOLS_PER_RESPONSE:raise ProviderError(f'单轮工具调用超过{MAX_TOOLS_PER_RESPONSE}次上限')
            if len(call['function']['arguments'])>MAX_ARGUMENT_CHARACTERS:raise ProviderError('单个工具参数超过长度上限')
    async with httpx.AsyncClient(timeout=httpx.Timeout(60,connect=15),follow_redirects=False,trust_env=False,transport=transport) as client:
        try:
            async with client.stream('POST',config['base_url']+'/chat/completions',headers={'Authorization':'Bearer '+config['api_key'],'Content-Type':'application/json'},json=payload) as response:
                if response.status_code!=200:
                    labels={401:'API key未通过验证',403:'Provider拒绝请求',429:'Provider配额或速率限制'}
                    raise ProviderError(labels.get(response.status_code,f'Provider返回HTTP {response.status_code}'))
                if 'text/event-stream' not in response.headers.get('content-type',''):
                    raw=b''
                    async for block in response.aiter_bytes():
                        raw+=block
                        if len(raw)>1000000:raise ProviderError('Provider响应过大')
                    await consume(json.loads(raw))
                else:
                    async for line in lines(response):
                        if not line.startswith('data:'):continue
                        data=line[5:].strip()
                        if data=='[DONE]':break
                        if data:await consume(json.loads(data))
        except (httpx.HTTPError,json.JSONDecodeError,UnicodeError) as error:
            raise ProviderError('Provider连接或流式响应中断') from error
    if finish not in ('stop','tool_calls','function_call'):raise ProviderError('模型未完整结束，未发布展览')
    ordered=[calls[k] for k in sorted(calls)]
    if len({c['id'] for c in ordered})!=len(ordered) or any(not c['id'] for c in ordered):raise ProviderError('工具调用标识无效')
    return {'role':'assistant','content':answer or None,**({'reasoning_content':reasoning} if reasoning else {}),**({'tool_calls':ordered} if ordered else {})},usage
