"""Authenticated local exhibition projections. No source reads or online services."""
from collections import Counter,defaultdict
from datetime import date,timedelta
import hashlib
import json
import math
import threading
import time
from pathlib import PurePosixPath
from fastapi import Depends,HTTPException,Query
from .gallery import media_url,event_id
from .localization import localize_place


def key(prefix,*values):
    return prefix+'-'+hashlib.sha256('\0'.join(str(v) for v in values).encode()).hexdigest()[:20]


def period(value):
    if not isinstance(value,str):return None
    value=value.strip().replace(':','-',2)
    try:
        if len(value)>=10:return date.fromisoformat(value[:10]).isoformat()
        if len(value)==7:
            y,m=map(int,value.split('-'));date(y,m,1);return f'{y:04}-{m:02}'
        if len(value)==4 and 1<=int(value)<=9999:return value
    except (ValueError,TypeError):pass
    return None


def valid_gps(value):
    if not isinstance(value,dict):return False
    return all(isinstance(value.get(k),(float,int)) and not isinstance(value[k],bool)
               and math.isfinite(value[k]) and -limit<=value[k]<=limit
               for k,limit in [('latitude',90),('longitude',180)])


class ExhibitionCatalog:
    def __init__(self,db):
        self.db=db;self.lock=threading.Lock();self.loaded=0;self.data=[]

    def invalidate(self):
        with self.lock:self.loaded=0

    def photos(self):
        with self.lock:
            if time.monotonic()-self.loaded<5:return self.data
            with self.db.connect() as c:
                c.execute('BEGIN')
                rows=[dict(r) for r in c.execute("""SELECT e.*,
                    json_object('version',json_extract(m.data_json,'$.version'),
                        'width',json_extract(m.data_json,'$.width'),'height',json_extract(m.data_json,'$.height'),
                        'hdr_policy',json_extract(m.data_json,'$.hdr_policy')) data_json,u.pinned,
                    json_object('score',json_extract(a.data_json,'$.score'),'error',json_extract(a.data_json,'$.error'),
                        'input_media_version',json_extract(a.data_json,'$.input_media_version')) visual_json,
                    a.version visual_version,p.data_json place_json,
                    (SELECT value FROM settings WHERE key='analysis_version') expected_visual,
                    s.root source_root FROM entries e JOIN sources s ON s.id=e.source_id
                    JOIN media_info m ON m.asset_id=e.id AND m.revision=e.revision
                    LEFT JOIN curation u ON u.asset_id=e.id
                    LEFT JOIN analysis a ON a.asset_id=e.id AND a.revision=e.revision AND a.provider='visual'
                    LEFT JOIN analysis p ON p.asset_id=e.id AND p.revision=e.revision AND p.provider='places'
                    WHERE e.is_dir=0 AND e.kind='image_candidate' AND e.missing=0 AND e.scope_excluded=0
                    AND coalesce(u.excluded,0)=0 AND coalesce(json_extract(m.data_json,'$.metadata_only'),0)=0
                    AND json_extract(m.data_json,'$.placeholder') IS NULL
                    AND EXISTS(SELECT 1 FROM cache_files f WHERE f.asset_id=e.id AND f.revision=e.revision AND f.profile='thumb')
                    AND EXISTS(SELECT 1 FROM cache_files f WHERE f.asset_id=e.id AND f.revision=e.revision AND f.profile='display')""")]
                ids={r['id'] for r in rows};meta=defaultdict(dict)
                for m in c.execute("""WITH ranked AS(SELECT m.*,row_number() OVER(PARTITION BY m.asset_id,m.field
                    ORDER BY CASE m.layer WHEN 'manual' THEN 0 WHEN 'observed' THEN 1 ELSE 2 END) priority
                    FROM metadata m JOIN entries e ON e.id=m.asset_id WHERE m.stale=0
                    AND (m.layer='manual' OR m.source_revision=e.revision)
                    AND (m.layer!='inferred' OR json_extract(m.info_json,'$.accepted')=1)
                    AND m.field IN ('captured_at','gps','make','camera','lens','focal_length'))
                    SELECT * FROM ranked WHERE priority=1"""):
                    if m['asset_id'] in ids:meta[m['asset_id']][m['field']]=dict(m)
            result=[]
            for r in rows:
                fields=meta[r['id']]
                def value(field):return json.loads(fields[field]['value_json']) if field in fields else None
                ev=json.loads(r['event_json']);info=json.loads(r['data_json'])
                capture=period(value('captured_at'))
                date_source='metadata' if capture else None
                if capture is None and not (fields.get('captured_at',{}).get('layer')=='manual'):
                    y,m=ev.get('year'),ev.get('month')
                    capture=period(f'{y:04}-{m:02}' if y and m else f'{y:04}' if y else None)
                    date_source='directory' if capture else None
                visual=json.loads(r['visual_json'] or '{}')
                score=visual.get('score') if (not visual.get('error') and visual.get('input_media_version')==info.get('version')
                    and (not r['expected_visual'] or r['visual_version']==r['expected_visual'])) else None
                if not isinstance(score,(int,float)) or not math.isfinite(score):score=None
                make=value('make') if isinstance(value('make'),str) else ''
                camera=value('camera') if isinstance(value('camera'),str) else ''
                lens=value('lens') if isinstance(value('lens'),str) else ''
                camera_id=key('camera',make.strip().casefold(),camera.strip().casefold()) if camera else 'camera-unknown'
                lens_id=key('lens',lens.strip().casefold()) if lens else 'lens-unknown'
                gps=value('gps');gps=gps if valid_gps(gps) else None
                place=json.loads(r['place_json'] or '{}')
                if not gps or place.get('input_record')!=fields.get('gps',{}).get('record_id') or not place.get('country'):place=None
                if place:place=localize_place(place)
                p={'id':r['id'],'revision':r['revision'],'kind':r['kind'],'name':PurePosixPath(r['path']).name,
                   'thumbnail':media_url(r,'thumb'),'preview':media_url(r,'display'),'info':info,
                   'pinned':bool(r['pinned']),'score':score,'captured_at':value('captured_at'),
                   'period':capture,'date_source':date_source,'date_precision':{4:'year',7:'month',10:'day'}.get(len(capture or ''),'unknown'),
                   'date_estimated':fields.get('captured_at',{}).get('layer')=='inferred',
                   'activity_id':event_id(r['source_id'],r['path'][len(r['source_root']):].strip('/').split('/')[0]),'event':ev,
                   'camera_id':camera_id,'camera':camera.strip(),'make':make.strip(),'lens_id':lens_id,'lens':lens.strip(),
                   'focal_length':value('focal_length'),'gps':gps,'gps_layer':fields.get('gps',{}).get('layer'),
                   'gps_precision':json.loads(fields.get('gps',{}).get('info_json','{}')).get('precision'),'place':place}
                result.append(p)
            self.data=result;self.loaded=time.monotonic();return result


def select(photos,*,day=None,month=None,year=None,undated=None,camera=None,lens=None,place=None,pinned=False,missing_gps=False,unresolved_gps=False,activity=None):
    result=[]
    for p in photos:
        stamp=p['period'] or ''
        if day and stamp!=day:continue
        if month and not stamp.startswith(month):continue
        if year and not stamp.startswith(str(year)):continue
        if undated=='all' and p['date_precision']=='day':continue
        if undated=='period' and p['date_precision']=='day':continue
        if undated=='unknown' and stamp:continue
        if camera and p['camera_id']!=camera:continue
        if lens and p['lens_id']!=lens:continue
        if pinned and not p['pinned']:continue
        if missing_gps and p['gps']:continue
        if unresolved_gps and (not p['gps'] or p['place']):continue
        if activity and p['activity_id']!=activity:continue
        if place and place not in place_keys(p):continue
        result.append(p)
    return result


def place_keys(p):
    place=p.get('place')
    if not place:return []
    country=place.get('country_code') or place['country']
    province=place.get('province_code') or place.get('province') or 'unknown'
    city=place.get('geonames_id') or place.get('city') or 'unknown'
    return [key('country',country),key('province',country,province),key('city',country,province,city)]


def representative(photos):
    if not photos:return None
    return max(photos,key=lambda p:(p['score'] is not None,p['score'] or 0,p['id']))


def cell(stamp,photos):
    top=representative(photos)
    return {'period':stamp,'count':len(photos),'estimated':sum(p['date_estimated'] for p in photos),
            'cover':{'id':top['id'],'thumbnail':top['thumbnail']} if top else None}


def center(photos):
    coords=[p['gps'] for p in photos if p['gps']]
    x=y=z=0
    for g in coords:
        lat,lon=math.radians(g['latitude']),math.radians(g['longitude'])
        x+=math.cos(lat)*math.cos(lon);y+=math.cos(lat)*math.sin(lon);z+=math.sin(lat)
    return {'longitude':math.degrees(math.atan2(y,x)), 'latitude':math.degrees(math.atan2(z,math.hypot(x,y)))}


def place_label(place,level):
    zh=place.get('display_zh') or {}
    return zh.get(level) or place.get(level) or {'country':'国家未详','province':'省份未详','city':'城市未详'}[level]


def device_type(p):
    model=p['camera'].lower()
    if not model or model in ('--','unknown'):return 'unknown'
    if any(v in model for v in ('foodie','playstation','photoshop','lightroom')):return 'software'
    if any(v in model for v in ('iphone','vivo','lumia','mix ','gm1910','pixel','sm-','huawei','oppo')):return 'phone'
    return 'camera'


def register(app,db,owner):
    catalog=ExhibitionCatalog(db);app.state.exhibitions=catalog

    @app.get('/api/exhibitions/calendar',dependencies=[Depends(owner)])
    def calendar_view(anchor:str|None=None,scale:str='month'):
        photos=catalog.photos();years=sorted({int(p['period'][:4]) for p in photos if p['period']},reverse=True)
        anchor=anchor or max((p['period'] for p in photos if p['period']),default=date.today().isoformat())
        parsed=period(anchor)
        if not parsed or scale not in ('year','month','week'):raise HTTPException(422,'日期或粒度无效')
        y=int(parsed[:4]);m=int(parsed[5:7]) if len(parsed)>=7 else 1
        if len(parsed)==4:scale='year'
        if y>=9999:raise HTTPException(422,'年份超出范围')
        dated=defaultdict(list)
        for p in photos:
            if p['date_precision']=='day':dated[p['period']].append(p)
        if scale=='year':
            cells=[cell(f'{y:04}-{n:02}',[p for p in photos if (p['period'] or '').startswith(f'{y:04}-{n:02}')]) for n in range(1,13)]
        else:
            first=date(y,m,1)
            if scale=='week':
                first=date.fromisoformat(parsed) if len(parsed)==10 else first
                first-=timedelta(days=first.weekday());length=7
            else:first-=timedelta(days=first.weekday());length=42
            cells=[cell((first+timedelta(days=n)).isoformat(),dated[(first+timedelta(days=n)).isoformat()]) for n in range(length)]
        prefix=f'{y:04}' if scale=='year' else f'{y:04}-{m:02}'
        unknown=[p for p in photos if p['date_precision']!='day' and (p['period'] or '').startswith(prefix)]
        return {'anchor':parsed,'scale':scale,'cells':cells,'years':years,'period_unknown':len(unknown),
                'unknown':sum(p['period'] is None for p in photos),'undated':sum(p['date_precision']!='day' for p in photos),'total':len(photos)}

    @app.get('/api/exhibitions/photos',dependencies=[Depends(owner)])
    def photo_collection(day:str|None=None,month:str|None=None,year:int|None=Query(default=None,ge=1,le=9998),
                         undated:str|None=None,camera:str|None=None,lens:str|None=None,place:str|None=None,
                         pinned:bool=False,missing_gps:bool=False,unresolved_gps:bool=False,activity:str|None=None,
                         sort:str='time',offset:int=Query(default=0,ge=0),limit:int=Query(default=100,ge=1,le=200)):
        if day and (period(day)!=day or len(day)!=10):raise HTTPException(422,'日期无效')
        if month and (period(month)!=month or len(month)!=7):raise HTTPException(422,'月份无效')
        if sort not in ('time','score') or undated not in (None,'all','period','unknown'):raise HTTPException(422,'筛选无效')
        found=select(catalog.photos(),day=day,month=month,year=year,undated=undated,camera=camera,lens=lens,place=place,pinned=pinned,missing_gps=missing_gps,unresolved_gps=unresolved_gps,activity=activity)
        found.sort(key=(lambda p:(p['score'] is None,-(p['score'] or 0),p['id'])) if sort=='score' else
                   (lambda p:(p['period'] is None,p['period'] or '',str(p['captured_at'] or ''),p['name'],p['id'])))
        return {'items':found[offset:offset+limit],'total':len(found),'photos':len(found),'videos':0,'order':sort}

    @app.get('/api/exhibitions/map',dependencies=[Depends(owner)])
    def map_view(parent:str|None=None):
        photos=catalog.photos();located=[p for p in photos if p['gps'] and p['place']]
        ancestors=[];depth=0
        if parent:
            sample=next((p for p in located if parent in place_keys(p)),None)
            if not sample:raise HTTPException(404,'地点已更新或不可用')
            depth=place_keys(sample).index(parent)+1
            for i,level in enumerate(('country','province','city')[:depth]):
                ancestors.append({'id':place_keys(sample)[i],'label':place_label(sample['place'],level)})
            located=select(located,place=parent)
        groups=defaultdict(list)
        if depth<3:
            for p in located:groups[place_keys(p)[depth]].append(p)
            level=('country','province','city')[depth]
            items=[]
            for pid,values in groups.items():
                top=representative(values)
                items.append({'id':pid,'label':place_label(values[0]['place'],level),'count':len(values),**center(values),
                              'estimated':sum(p['gps_layer']=='inferred' for p in values),'precision':'nearest_city',
                              'cover':{'thumbnail':top['thumbnail']} if top else None})
        else:
            level='activities'
            for p in located:groups[p['activity_id']].append(p)
            items=[]
            for aid,values in groups.items():
                top=representative(values)
                items.append({'id':aid,'label':values[0]['event'].get('theme') or '活动未详','event':values[0]['event'],
                              'count':len(values),**center(values),'cover':{'thumbnail':top['thumbnail']} if top else None})
        items.sort(key=lambda r:(-r['count'],r['label'],r['id']))
        return {'level':level,'parent':parent,'breadcrumbs':ancestors,'groups':items,'count':len(located),
                'missing_gps':sum(p['gps'] is None for p in photos),
                'unresolved':sum(p['gps'] is not None and p['place'] is None for p in photos),
                'estimated':sum(p['gps_layer']=='inferred' for p in located),'precision':'nearest_city',
                'attribution':'Natural Earth · Public Domain / GeoNames · CC BY 4.0','coordinate_system':'WGS84'}

    def devices(photos,kind):
        grouped=defaultdict(list)
        for p in photos:grouped[p[kind+'_id']].append(p)
        result=[]
        for did,values in grouped.items():
            p=values[0];name=p[kind]
            if kind=='camera' and name and p['make'] and not name.casefold().startswith(p['make'].casefold()):name=p['make']+' '+name
            result.append({'id':did,'name':name or ('设备未详' if kind=='camera' else '未记录镜头'),'kind':kind,
                           'model':p[kind],'make':p['make'] if kind=='camera' else None,
                           'type':device_type(p) if kind=='camera' else 'lens','count':len(values),
                           'pinned':sum(v['pinned'] for v in values),'years':sorted({v['period'][:4] for v in values if v['period']}),
                           'builtin':kind=='lens' and any(s in name.casefold() for s in ('iphone','back camera','front camera','back triple','back dual'))})
        result.sort(key=lambda r:(r['id'].endswith('unknown'),-r['count'],r['name']))
        return result

    @app.get('/api/exhibitions/gear',dependencies=[Depends(owner)])
    def gear_list(kind:str='camera'):
        if kind not in ('camera','lens'):raise HTTPException(422,'器材类型无效')
        photos=catalog.photos()
        return {'devices':devices(photos,kind),'total':len(photos),'kind':kind}

    @app.get('/api/exhibitions/gear/{did}',dependencies=[Depends(owner)])
    def gear_detail(did:str,pinned:bool=False):
        kind='lens' if did.startswith('lens-') else 'camera'
        photos=catalog.photos();device=next((d for d in devices(photos,kind) if d['id']==did),None)
        if not device:raise HTTPException(404,'器材不存在')
        found=select(photos,**{kind:did},pinned=pinned)
        ranked=sorted(found,key=lambda p:(p['score'] is None,-(p['score'] or 0),p['id']))
        years=Counter(p['period'][:4] for p in found if p['period'])
        focal=Counter()
        for p in found:
            f=p['focal_length']
            if isinstance(f,(int,float)) and not isinstance(f,bool) and f>0 and math.isfinite(f):
                label=next((label for limit,label in [(24,'<24'),(35,'24–34'),(50,'35–49'),(85,'50–84'),(135,'85–134'),(300,'135–299'),(math.inf,'≥300')] if f<limit))
                focal[label]+=1
        lenses=devices(found,'lens') if kind=='camera' else devices(found,'camera')
        return {'device':device,'count':len(found),'selected':ranked[:6],
                'years':[{'year':int(y),'count':n} for y,n in sorted(years.items())],
                'date_unknown':sum(p['period'] is None for p in found),'focal':[{'label':k,'count':v} for k,v in focal.items()],
                'related':lenses[:12],'selection_policy':'technical-score','pinned':pinned}
