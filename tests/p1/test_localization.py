import copy,json
from photo_museum.localization import catalog,localize_place,localize_tags
from photo_museum.media_worker import MediaWorker
from photo_museum.media import VERSION
from .test_service import system,scan
from .test_media import jpeg
from .fixture import ROOT,EVENT


def test_china_place_ids_and_legacy_names_are_localized_without_mutation():
    original={'country':'China','country_code':'CN','province':'Xinjiang','city':'Xinyuan','geonames_id':'1529046','precision':'nearest_city','distance_m':1234,'street':None}
    before=copy.deepcopy(original);result=localize_place(original)
    assert result['display_zh']=={'country':'中国','province':'新疆','city':'新源','district':None,'street':None}
    assert original==before and result['city']=='Xinyuan' and result['distance_m']==1234 and result['precision']=='nearest_city'
    assert localize_place({'country':'China','province':'Guangdong','city':'Qingyuan'})['display_zh']['city']=='清远'


def test_unknown_streets_and_other_countries_are_not_guessed():
    p={'country':'China','province':'Xinjiang','city':'UnknownCity','street':'Zhongshan Road'}
    out=localize_place(p)['display_zh'];assert out['country']=='中国' and out['province']=='新疆'
    assert out['city']=='UnknownCity' and out['street']=='Zhongshan Road'
    p['street_zh']='中山路';assert localize_place(p)['display_zh']['street']=='中山路'
    foreign={'country':'France','country_code':'FR','city':'Paris'};assert localize_place(foreign)==foreign
    chinese={'country':'China','province':'人工省名','city':'人工地点','geonames_id':'1529046'}
    out=localize_place(chinese)['display_zh'];assert out['province']=='人工省名' and out['city']=='人工地点'


def test_subject_names_preserve_scores_and_disambiguate_by_synset():
    tags=[{'label':'golf ball','confidence':.9},{'label':'lakeside, lakeshore','confidence':.8},{'label':'rapeseed','confidence':.7},{'label':'unknown future model','confidence':.6}]
    before=copy.deepcopy(tags);out=localize_tags(tags)
    assert [t['label_zh'] for t in out]==['高尔夫球','湖边','油菜',None]
    assert tags==before and [t['confidence'] for t in out]==[.9,.8,.7,.6]
    assert localize_tags([{'label':'crane'}])[0]['label_zh'] is None
    assert [t['label_zh'] for t in localize_tags([{'label':'crane','synset':'n02012849'},{'label':'crane','synset':'n03126707'}])]==['鹤','起重机']
    assert localize_tags([{'label':'generic','class_index':0}])[0]['label_zh'] is None
    assert localize_tags([{'label':'tench','class_index':0,'taxonomy':'imagenet1k'}])[0]['label_zh']=='丁鲷'
    assert len(catalog()['indices'])==1000


def test_inspection_and_gallery_analysis_localize_existing_rows_without_nas_or_rewrite(system):
    app,client,remote,sid=system
    remote.entries={ROOT:None,EVENT:None,EVENT+'/one.jpg':jpeg()};scan(app,client,sid);assert MediaWorker(app.state.db).tick()
    db=app.state.db
    with db.connect() as c:r=dict(c.execute('SELECT * FROM entries WHERE is_dir=0').fetchone())
    db.set_metadata(r['id'],'gps',{'latitude':43.4,'longitude':83.2},'observed',r['revision']);gps=db.effective(r['id'])['gps']
    visual={'tags':[{'label':'golf ball','confidence':.75}],'score':76,'input_media_version':VERSION}
    place={'country':'China','country_code':'CN','province':'Xinjiang','city':'Xinyuan','geonames_id':'1529046','precision':'nearest_city','distance_m':321,'input_record':gps['record_id']}
    with db.connect() as c:
        c.execute("INSERT OR REPLACE INTO settings VALUES('analysis_version','locale-fixture')")
        for provider,data in [('visual',visual),('places',place)]:c.execute('INSERT OR REPLACE INTO analysis VALUES(?,?,?,?,?,0)',(r['id'],r['revision'],provider,'locale-fixture',json.dumps(data)))
    calls=len(remote.calls)
    analysis=client.get('/api/assets/'+r['id']+'/analysis').json()
    inspection=client.get(f"/api/assets/{r['id']}/inspection?revision={r['revision']}").json()
    assert analysis['visual']['data']['tags'][0]['label_zh']==inspection['tags'][0]['label_zh']=='高尔夫球'
    assert analysis['places']['data']['display_zh']==inspection['place']['display_zh']
    assert analysis['places']['data']['display_zh']['city']=='新源' and analysis['places']['data']['city']=='Xinyuan'
    assert len(remote.calls)==calls
    with db.connect() as c:
        stored={p:json.loads(d) for p,d in c.execute('SELECT provider,data_json FROM analysis WHERE asset_id=?',(r['id'],))}
    assert stored=={'visual':visual,'places':place}
    db.set_metadata(r['id'],'gps',{'latitude':1,'longitude':1},'manual')
    assert 'places' not in client.get('/api/assets/'+r['id']+'/analysis').json()
    assert client.get(f"/api/assets/{r['id']}/inspection?revision={r['revision']}").json()['place'] is None
