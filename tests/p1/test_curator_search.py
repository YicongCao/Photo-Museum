"""Regressions for real-provider stringified filters and sparse address records."""
import json
import pytest
from pydantic import ValidationError
from .test_service import system
from .test_exhibitions import seed
from .test_curator import configure,wait
from .curator_fixture import FakeLLM
from photo_museum.curator_tools import LocalTools,SearchInput,TOOLS
from photo_museum.curator import tool_failure


def prepared(system):
    seed(system);app,client,remote,sid=system
    local=LocalTools(app.state.db,app.state.exhibitions,'sparse-search')
    photos=local.load()
    for p in photos:p.update(place=None,subjects=[])
    photos[0].update(place={'country':'China','province':None,'city':'Zhuhai','display_zh':{'country':'中国','province':None,'city':'珠海'}},
                     subjects=[{'id':'sports-car','label':'跑车'}],event={**photos[0]['event'],'theme':'惠州 · 合成活动标题'})
    photos[1]['place']={'country':'China','province':'Guangdong','city':None,'display_zh':{'country':'中国','province':'广东','city':None}}
    return local,photos


def test_stringified_filters_keep_conditions_and_reject_invalid_json(system):
    local,photos=prepared(system)
    direct=local.dispatch('search_photos',{'filters':{'city':['珠海'],'subject':['跑车']}})
    encoded=local.dispatch('search_photos',{'filters':json.dumps({'city':['珠海'],'subject':['跑车']})})
    assert direct['total']==encoded['total']==1
    assert direct['items'][0]['id']==encoded['items'][0]['id']==photos[0]['id']
    assert local.dispatch('search_photos',{'filters':'{"city":["惠州"]}'})['total']==0
    for value in ('{broken','[]','null','true','"{}"','{"sql":"select *"}','{"city":42}'):
        with pytest.raises(ValidationError):local.dispatch('search_photos',{'filters':value})


def test_sparse_place_fields_and_translated_facets_are_consistent(system):
    local,photos=prepared(system)
    assert local.dispatch('search_photos',{'filters':{'province':['广东']}})['total']==1
    assert local.dispatch('search_photos',{'filters':{'province':['Guangdong']}})['total']==1
    assert local.dispatch('search_photos',{'filters':{'query':'惠州','subject':['跑车']}})['total']==1
    assert local.dispatch('search_photos',{'filters':{'query':'中国 广东'}})['total']==1
    for value in ('惠州','Huizhou','省份未详','城市未详'):
        field='province' if value=='省份未详' else 'city'
        assert local.dispatch('search_photos',{'filters':{field:[value]}})['total']==0
    for query in ('珠海','zhuhai','ZHUHAI'):
        facet=local.dispatch('list_facets',{'field':'city','query':query})
        assert facet['values']==[{'value':'珠海','count':1}]
    assert local.dispatch('list_facets',{'field':'city','query':'Huizhou'})['values']==[]


def test_provider_tool_schema_has_explicit_nested_object():
    spec=next(t['function']['parameters'] for t in TOOLS if t['function']['name']=='search_photos')
    assert '$ref' not in json.dumps(spec) and '$defs' not in json.dumps(spec)
    nested=spec['properties']['filters']
    assert nested['type']=='object' and nested['additionalProperties'] is False
    assert nested['properties']['city']['type']=='array'


def test_validation_errors_explain_fields_without_echoing_values():
    with pytest.raises(ValidationError) as caught:
        SearchInput.model_validate({'filters':{'city':[{'private':'do-not-echo'}]}})
    result=tool_failure(caught.value)
    assert result['code']=='invalid_arguments' and result['details'][0]['field']=='filters.city.0'
    assert 'do-not-echo' not in json.dumps(result)
    assert tool_failure(TypeError('private-index-detail'))['code']=='tool_execution_failed'
    assert 'private-index-detail' not in json.dumps(tool_failure(TypeError('private-index-detail')))


def test_full_agent_accepts_double_encoded_provider_filters(system):
    import httpx
    seed(system);app,client,remote,sid=system;configure(app);fake=FakeLLM();before=list(remote.calls)
    def provider(request):
        # Transform exactly the wire format returned by the failing compatible provider.
        # Reuse the SSE fixture, including fragmented arguments and final preparation.
        response=fake(request)
        for chunk in response.stream.chunks:
            delta=chunk.get('choices',[{}])[0].get('delta',{})
            for call in delta.get('tool_calls',[]):
                if call.get('function',{}).get('name')=='search_photos':
                    args=json.dumps({'filters':json.dumps({'years':[2024]}),'limit':12})
                    call['function']['arguments']=args
                    # The fixture split this call over two chunks; remove its second half.
                    response.stream.chunks[response.stream.chunks.index(chunk)+1]['choices'][0]['delta']['tool_calls'][0]['function']['arguments']=''
        return response
    app.state.curator.transport=httpx.MockTransport(provider)
    with client:
        rid=client.post('/api/curator/runs',json={'prompt':'整理2024年照片'}).json()['id']
        run=wait(client,rid)
        assert run['status']=='completed' and run['exhibition_id'],run
        assert client.get('/api/curator/exhibitions/'+run['exhibition_id']).json()['count']==3
        assert not [e for e in client.get('/api/curator/runs/'+rid+'/events').json()['items'] if e['kind']=='tool_end' and e['data']['result'].get('error')]
        assert len(fake.requests)==5 and remote.calls==before


def test_repeated_invalid_arguments_stop_with_diagnostics(system):
    app,client,remote,sid=system;configure(app);calls=[]
    async def invalid(config,messages,tools,delta,**kwargs):
        calls.append(1)
        return {'role':'assistant','content':None,'tool_calls':[{'id':'bad-'+str(len(calls)),'type':'function','function':{'name':'search_photos','arguments':json.dumps({'filters':{'city':7}})}}]},{}
    app.state.curator.complete=invalid
    with client:
        rid=client.post('/api/curator/runs',json={'prompt':'synthetic invalid input'}).json()['id'];run=wait(client,rid)
        assert run['status']=='failed' and '连续3次' in run['error'] and len(calls)==3
        errors=[e['data']['result'] for e in client.get('/api/curator/runs/'+rid+'/events').json()['items'] if e['kind']=='tool_end']
        assert all(e['code']=='invalid_arguments' and e['details'][0]['field']=='filters.city' for e in errors)


def test_internal_tool_failure_is_not_reported_as_invalid_filter(system,monkeypatch):
    app,client,remote,sid=system;configure(app);calls=[]
    async def invoke(config,messages,tools,delta,**kwargs):
        calls.append(1)
        return {'role':'assistant','content':None,'tool_calls':[{'id':'internal','type':'function','function':{'name':'search_photos','arguments':'{}'}}]},{}
    def broken(*args):raise TypeError('private database contents must not appear')
    monkeypatch.setattr(LocalTools,'dispatch',broken);app.state.curator.complete=invoke
    with client:
        rid=client.post('/api/curator/runs',json={'prompt':'synthetic internal failure'}).json()['id'];run=wait(client,rid)
        assert run['status']=='failed' and '本地检索工具执行失败' in run['error'] and len(calls)==1
        events=client.get('/api/curator/runs/'+rid+'/events').text
        assert 'tool_execution_failed' in events and 'private database contents' not in events
