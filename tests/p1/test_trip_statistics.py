import asyncio
from datetime import date
import json
import httpx
import pytest
from .test_service import system
from .test_exhibitions import seed
from .curator_fixture import Events
from .test_curator import configure,wait
from photo_museum.travel_statistics import summarize_trips
from photo_museum.curator_tools import LocalTools,TOOLS
from photo_museum.curator_provider import completion,ProviderError
from photo_museum.curator_limits import MAX_TOOLS_PER_RESPONSE


def photo(stamp,**kw):
    return {'period':stamp,'date_source':'metadata',**kw}


def test_all_dates_not_samples_and_correct_denominators():
    photos=[photo('2024-01-01') for _ in range(210)]+[photo('2024-01-03'),photo('2024-03-01'),photo('2024-03-02'),photo('2024-07-01')]
    result=summarize_trips(photos,limit=1,today=date(2025,1,1))
    assert result['matched_photos']==214 and result['trip_count']==3
    assert result['start_to_start']=={'count':2,'mean_days':91,'median_days':91,'min_days':60,'max_days':122}
    assert result['last_to_next_first']['mean_days']==89.5
    assert len(result['trips'])==1 and result['next_offset']==1
    assert result['trips'][0]['photo_count']==211 and result['trips'][0]['observed_days']==2
    second=summarize_trips(photos,offset=1,limit=1,today=date(2025,1,1))
    assert second['trips'][0]['previous_start_to_start_days']==60
    assert second['start_to_start']==result['start_to_start']


def test_precision_future_threshold_and_small_samples():
    photos=[photo(None),photo('2024'),photo('2024-02'),photo('invalidxxx'),photo('2025-12-01'),photo('2024-01-01'),photo('2024-01-08'),photo('2024-01-16',date_estimated=True)]
    result=summarize_trips(photos,today=date(2025,1,1))
    assert result['excluded_dates']=={'unknown_or_partial_date':3,'invalid_date':1,'future_date':1}
    assert result['estimated_photos_used']==1
    assert result['grouping']['sensitivity_trip_counts']=={'3':3,'7':2,'14':1}
    assert result['trips'][1]['previous_last_to_this_first_days']==8
    for records in ([],[photo('2024-01-01')]):
        assert summarize_trips(records)['start_to_start']['mean_days'] is None


def test_country_aliases_stats_same_scope_and_no_private_details(system):
    seed(system);app,client,remote,sid=system;local=LocalTools(app.state.db,app.state.exhibitions,'stats')
    photos=local.load()
    for i,p in enumerate(photos):
        p.update(period=f'2024-0{i+1}-01',date_source='metadata',date_estimated=False,gps_layer='observed',place={'country':'Japan' if i<2 else 'China','country_code':'JP' if i<2 else 'CN'},people_terms=['private person'],people_count=1)
    before=list(remote.calls)
    assert local.dispatch('list_facets',{'field':'country','query':'日本'})['values']==[{'value':'Japan','count':2}]
    for alias in ('日本','Japan','JP','JPN'):
        result=local.dispatch('summarize_trips',{'filters':json.dumps({'country':[alias],'person':'private person'})})
        assert result['trip_count']==2 and result['matched_photos']==2
        assert result['start_to_start']['mean_days']==31
        text=json.dumps(result);assert all(x not in text for x in ('private person','latitude','thumbnail','embedding',photos[0]['name']))
    photos[1]['gps_layer']='inferred'
    assert local.dispatch('summarize_trips',{'filters':{'country':['日本'],'include_estimated':False}})['matched_photos']==1
    assert remote.calls==before and local.draft is None
    spec=next(t['function']['parameters'] for t in TOOLS if t['function']['name']=='search_photos')
    assert spec['properties']['order']['enum']==['score','time','random','diverse']
    with pytest.raises(ValueError):local.dispatch('summarize_trips',{'gap_days':0})


def batch(n):
    return [{'index':i,'id':f'call-{i}','type':'function','function':{'name':'catalog_schema','arguments':'{}'}} for i in range(n)]


def test_provider_accepts_nine_calls_and_distinguishes_limit_errors():
    async def delta(*_):pass
    config={'model':'fake','base_url':'https://fixture.invalid/v1','api_key':'synthetic-only','temperature':1.1}
    def run(calls):
        transport=httpx.MockTransport(lambda r:httpx.Response(200,headers={'content-type':'text/event-stream'},stream=Events([{'choices':[{'delta':{'tool_calls':calls},'finish_reason':'tool_calls'}]}])))
        return asyncio.run(completion(config,[],TOOLS,delta,transport=transport))
    assert len(run(batch(9))[0]['tool_calls'])==9
    assert len(run(batch(MAX_TOOLS_PER_RESPONSE))[0]['tool_calls'])==MAX_TOOLS_PER_RESPONSE
    with pytest.raises(ProviderError,match='单轮工具调用'):run(batch(MAX_TOOLS_PER_RESPONSE+1))
    calls=batch(1);calls[0]['function']['arguments']='x'*16001
    with pytest.raises(ProviderError,match='参数超过长度'):run(calls)


def test_agent_can_exceed_old_round_and_total_limits_without_creating_exhibition(system):
    app,client,remote,sid=system;configure(app);rounds=[]
    def provider(request):
        rounds.append(1);n=len(rounds)
        delta={'tool_calls':batch(3)} if n<=9 else {'content':'统计测试结束，不创建展览。'}
        return httpx.Response(200,headers={'content-type':'text/event-stream'},stream=Events([{'choices':[{'delta':delta,'finish_reason':'tool_calls' if n<=9 else 'stop'}]}]))
    app.state.curator.transport=httpx.MockTransport(provider)
    with client:
        rid=client.post('/api/curator/runs',json={'prompt':'合成预算测试'}).json()['id'];run=wait(client,rid)
        assert run['status']=='completed' and len(rounds)==10 and run['exhibition_id'] is None
        events=app.state.curator.events(rid)['items']
        assert sum(e['kind']=='tool_start' for e in events)==27


@pytest.mark.parametrize('batch_size,rounds,executed,error',[(16,5,64,'累计工具调用'),(1,16,16,'16轮推理')])
def test_new_budgets_remain_bounded(system,batch_size,rounds,executed,error):
    app,client,remote,sid=system;configure(app);requests=[]
    def provider(request):
        requests.append(1)
        calls=batch(batch_size)
        for call in calls:call['function']['name']='library_overview'
        return httpx.Response(200,headers={'content-type':'text/event-stream'},stream=Events([{'choices':[{'delta':{'tool_calls':calls},'finish_reason':'tool_calls'}]}]))
    app.state.curator.transport=httpx.MockTransport(provider)
    with client:
        rid=client.post('/api/curator/runs',json={'prompt':'合成上限测试'}).json()['id'];run=wait(client,rid)
        assert run['status']=='failed' and error in run['error'] and len(requests)==rounds
        with app.state.db.connect() as c:
            assert c.execute("SELECT count(*) FROM curator_events WHERE run_id=? AND kind='tool_start'",(rid,)).fetchone()[0]==executed
