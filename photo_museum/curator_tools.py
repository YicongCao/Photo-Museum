"""Local constrained curation tools. Outbound projections never contain images/GPS/paths/faces."""
import calendar
from collections import Counter,defaultdict
from datetime import date
from typing import Literal
from .travel_statistics import summarize_trips
import hashlib,json,math,random,re,uuid
from pathlib import PurePosixPath
from pydantic import BaseModel,ConfigDict,Field,field_validator
from .exhibitions import period,place_label
from .localization import localize_tags
from .lexicon import Lexicon,photo_terms,DOMAINS

ROOMS={'cover':'Cover Flow','wall':'照片墙','calendar':'日历','map':'地图','gear':'器材馆','space':'时空隧道',
       'rings':'人生年轮','constellation':'记忆星图','scroll':'记忆长卷','revisit':'故地重游'}
class Input(BaseModel):
    model_config=ConfigDict(extra='forbid')
class Filters(Input):
    query:str=Field(default='',max_length=160)
    date_from:str|None=Field(default=None,max_length=10)
    date_to:str|None=Field(default=None,max_length=10)
    years:list[int]=Field(default_factory=list,max_length=30)
    months:list[int]=Field(default_factory=list,max_length=12)
    activity:list[str]=Field(default_factory=list,max_length=20)
    camera:list[str]=Field(default_factory=list,max_length=20)
    lens:list[str]=Field(default_factory=list,max_length=20)
    country:list[str]=Field(default_factory=list,max_length=20)
    province:list[str]=Field(default_factory=list,max_length=20)
    city:list[str]=Field(default_factory=list,max_length=20)
    style:list[str]=Field(default_factory=list,max_length=20)
    topic:list[str]=Field(default_factory=list,max_length=20)
    subject:list[str]=Field(default_factory=list,max_length=20)
    keyword_ids:list[str]=Field(default_factory=list,max_length=20,description='lookup_keywords返回的标准ID；同domain多个ID为OR，不同domain为AND，不自动扩展相关概念')
    @field_validator('keyword_ids')
    @classmethod
    def valid_keywords(cls,values):
        if any(len(v)>160 or ':' not in v or v.split(':',1)[0] not in DOMAINS for v in values):raise ValueError('关键词 ID 无效，请先查询词库')
        return values
    min_score:float|None=Field(default=None,ge=0,le=100,allow_inf_nan=False,description='原技术分0–100，保留历史筛选语义')
    min_aesthetic_score:float|None=Field(default=None,allow_inf_nan=False,description='神经美学预测值，名义十分制，非概率；用此字段筛选美感')
    pinned:bool|None=None
    has_people:bool|None=None
    person:str=Field(default='',max_length=80)
    orientation:str|None=None
    iso_min:float|None=Field(default=None,ge=0,le=2000000,allow_inf_nan=False)
    iso_max:float|None=Field(default=None,ge=0,le=2000000,allow_inf_nan=False)
    aperture_min:float|None=Field(default=None,gt=0,le=128,allow_inf_nan=False)
    aperture_max:float|None=Field(default=None,gt=0,le=128,allow_inf_nan=False)
    exposure_min:float|None=Field(default=None,gt=0,le=86400,allow_inf_nan=False,description='曝光秒数')
    exposure_max:float|None=Field(default=None,gt=0,le=86400,allow_inf_nan=False,description='曝光秒数')
    focal_min:float|None=Field(default=None,ge=0,le=10000,allow_inf_nan=False,description='实际焦距mm，非35mm等效')
    focal_max:float|None=Field(default=None,ge=0,le=10000,allow_inf_nan=False,description='实际焦距mm，非35mm等效')
    hdr:bool|None=None
    include_estimated:bool=True
    @field_validator('date_from','date_to')
    @classmethod
    def valid_date(cls,v):
        if v is not None and period(v)!=v:raise ValueError('日期无效')
        return v
    @field_validator('years')
    @classmethod
    def valid_years(cls,v):
        if any(not 1<=n<=9998 for n in v):raise ValueError('年份无效')
        return v
    @field_validator('months')
    @classmethod
    def valid_months(cls,v):
        if any(not 1<=n<=12 for n in v):raise ValueError('月份无效')
        return v
    @field_validator('orientation')
    @classmethod
    def valid_orientation(cls,v):
        if v not in (None,'landscape','portrait','square'):raise ValueError('方向无效')
        return v
    @field_validator('activity','camera','lens','country','province','city','style','topic','subject')
    @classmethod
    def valid_texts(cls,v):
        if any(not x or len(x)>120 for x in v):raise ValueError('筛选值无效')
        return v
class Empty(Input):pass
class FacetInput(Input):
    field:str
    query:str=Field(default='',max_length=120)
    limit:int=Field(default=30,ge=1,le=60)
class SearchInput(Input):
    filters:Filters=Field(default_factory=Filters)
    order:Literal['score','time','random','diverse']=Field(default='diverse',description='time=拍摄时间升序；score=评分降序；random=随机；diverse=多样化。不能使用date或date_asc。')
    limit:int=Field(default=32,ge=1,le=100)
    offset:int=Field(default=0,ge=0,le=10000)
    @field_validator('filters',mode='before')
    @classmethod
    def object_filters(cls,v):
        # Some compatible providers serialize an object-valued argument a second time.
        # Decode only this declared object; normal validation still rejects bad/extra fields.
        if isinstance(v,str):
            if len(v)>16000:raise ValueError('filters JSON对象过大')
            try:v=json.loads(v)
            except json.JSONDecodeError:raise ValueError('filters必须是JSON对象，字符串内容不是有效JSON') from None
            if not isinstance(v,dict):raise ValueError('filters必须是JSON对象，不能是数组、null或标量')
        return v
    @field_validator('order')
    @classmethod
    def order_valid(cls,v):
        if v not in ('score','time','random','diverse'):raise ValueError('排序无效')
        return v
class TripInput(Input):
    filters:Filters=Field(default_factory=Filters)
    gap_days:int=Field(default=7,ge=1,le=60,description='相邻拍摄日超过此天数另起疑似行程；默认7，并返回3/7/14天敏感性比较')
    offset:int=Field(default=0,ge=0,le=10000)
    limit:int=Field(default=100,ge=1,le=100)
    @field_validator('filters',mode='before')
    @classmethod
    def object_filters(cls,v):return SearchInput.object_filters(v)

class LookupInput(Input):
    query:str=Field(default='',max_length=160)
    domains:list[str]=Field(default_factory=lambda:list(DOMAINS),max_length=4)
    context:Filters=Field(default_factory=Filters)
    limit:int=Field(default=20,ge=1,le=60)
    cursor:str|None=Field(default=None,max_length=256)
    @field_validator('context',mode='before')
    @classmethod
    def context_object(cls,v):return SearchInput.object_filters(v)
    @field_validator('domains')
    @classmethod
    def domain_valid(cls,v):
        if any(d not in DOMAINS for d in v):raise ValueError('词库分类无效')
        return list(dict.fromkeys(v))

class DetailsInput(Input):
    photo_ids:list[str]=Field(min_length=1,max_length=12)
class DraftInput(Input):
    title:str=Field(min_length=1,max_length=80)
    search_id:str=Field(max_length=60)
    photo_ids:list[str]=Field(default_factory=list,max_length=1000)
    max_photos:int=Field(default=120,ge=1,le=1000)
    room:str='wall'
    @field_validator('room')
    @classmethod
    def room_valid(cls,v):
        if v not in ROOMS:raise ValueError('展厅无效')
        return v

TOOL_SPECS=[
 ('catalog_schema','获取可用字段、精度、工具边界和展厅；先读取再筛选。',Empty),
 ('library_overview','获取本地可展成片规模、年代、模型覆盖和缺失信息。',Empty),
 ('list_facets','列出真实分类值和数量。field可用year/activity/camera/lens/country/province/city/style/topic/subject；中文标签或ID可作后续筛选。',FacetInput),
 ('lookup_keywords','查主体subject/摄影主题topic/风格style/城市city的全局去重词库。返回标准ID、中英文别名、来源、父区域、上下文照片数和消歧候选；按返回ID检索，不猜拼写，不自动合并同名词。cursor用于下一页。',LookupInput),
 ('summarize_trips','对全部匹配照片一次统计疑似行程、相邻首日间隔和上次末张到下次首张间隔及平均/中位数；问旅行次数、多久去一次、时间间隔时优先用此工具，不逐年搜索或拿前100张抽样统计。日期缺失单列，支持filters，不创建展览。',TripInput),
 ('search_photos','在本地索引筛选成片，返回匹配总数、候选摘要与search_id。不同字段为AND，同字段多个值为OR；query按文字词段匹配。无结果不擅自放宽条件。',SearchInput),
 ('photo_details','读取本轮已检索候选的精简元数据，不读取图片或NAS。',DetailsInput),
 ('create_exhibition','根据本轮search_id/候选创建本地展览草案；photo_ids为空时使用该查询前max_photos张。只生成草案，不改原图或人工标记。',DraftInput),
]
def tool_parameters(model):
    """Inline local definitions for providers that do not resolve nested $ref schemas."""
    source=model.model_json_schema();definitions=source.get('$defs',{})
    def inline(value):
        if isinstance(value,list):return [inline(v) for v in value]
        if not isinstance(value,dict):return value
        if '$ref' in value:
            name=value['$ref'].removeprefix('#/$defs/')
            return inline({**definitions[name],**{k:v for k,v in value.items() if k!='$ref'}})
        return {k:inline(v) for k,v in value.items() if k!='$defs'}
    return inline(source)

TOOLS=[{'type':'function','function':{'name':n,'description':d,'parameters':tool_parameters(m)}} for n,d,m in TOOL_SPECS]
MODELS={n:m for n,_,m in TOOL_SPECS}


def schema():
    return {'fields':{'date':'effective拍摄日期；年/月/日精度分开，目录年度不补一月，接受推断有标记',
        'activity':'目录活动主题；不是摄影topic','camera':'相机型号/厂商','lens':'镜头型号',
        'place':'有效GPS解析的国家/省/最近城市或镇；city不是地级市行政归属，不能自动把附近镇名归为用户要求的市；精确GPS不出本机','style':'本地CLIP摄影风格候选与相似度',
        'topic':'本地CLIP摄影主题候选与相似度','subject':'本地主体类别候选','score':'排序分：启用神经模型时为美学预测值，名义十分制，未启用时为技术分；见score_kind，不是喜爱概率','technical_score':'0–100技术分；min_score始终筛此列','aesthetic_score':'独立神经美学原始预测，名义十分制；min_aesthetic_score筛此列',
        'pinned':'馆主标记','people':'仅本地按有人/人物标签筛选，姓名/脸框/特征不回传',
        'orientation':'landscape/portrait/square，按有效宽高','exposure':'真实ISO、光圈、快门秒数、实际/35mm等效焦距，逐文件事实不能近邻复制',
        'color':'源色域、位深、HDR标记和sRGB假定；浏览预览统一SDR/sRGB'},'rooms':ROOMS,
        'filters_schema':Filters.model_json_schema(),'privacy':'无图片、文件名、NAS路径、精确GPS、人脸特征或人物库姓名；只检索本地现有索引',
        'keyword_lookup':'先用lookup_keywords查词，使用返回的id放入filters.keyword_ids；同域OR、跨域AND。来源标签仍是机器候选，相关概念不自动扩展。',
        'logic':'字段间AND，字段内多个值OR；未知不当命中。style/topic/subject是候选不是确定事实。'}


def span(stamp):
    y=int(stamp[:4]);m=int(stamp[5:7]) if len(stamp)>=7 else 1
    first=date(y,m,int(stamp[8:10]) if len(stamp)==10 else 1)
    last=first if len(stamp)==10 else date(y,m,calendar.monthrange(y,m)[1]) if len(stamp)==7 else date(y,12,31)
    return first,last

class LocalTools:
    def __init__(self,db,catalog,run_id,requested_room='auto'):
        self.db=db;self.catalog=catalog;self.run_id=run_id;self.requested_room=requested_room
        self.photos=None;self.searches={};self.seen=set();self.draft=None
    def load(self,asset_ids=None):
        if self.photos is not None:return self.photos
        scope=tuple(asset_ids) if asset_ids is not None else None
        suffix=lambda alias:(' AND '+alias+'.asset_id IN ('+','.join('?' for _ in scope)+')') if scope else ''
        params=scope or ()
        base=self.catalog.photos(asset_ids=scope) if scope is not None else self.catalog.photos()
        photos={p['id']:dict(p,subjects=[],styles=[],topics=[],people_count=0,people_terms=[],technical={},lexicon_versions={}) for p in base}
        if scope is not None and not photos:self.photos=[];return []
        with self.db.connect() as c:
            expected_place=c.execute("SELECT value FROM settings WHERE key='geography_version'").fetchone()
            if expected_place:
                for p in photos.values():
                    if p.get('place_version')!=expected_place[0]:p['place']=None
            for r in c.execute("""WITH ranked AS(SELECT m.*,row_number() OVER(PARTITION BY m.asset_id,m.field ORDER BY CASE m.layer WHEN 'manual' THEN 0 ELSE 1 END) priority
                FROM metadata m JOIN entries e ON e.id=m.asset_id WHERE m.stale=0 AND (m.layer='manual' OR m.source_revision=e.revision)
                AND m.layer IN ('manual','observed') AND m.field IN ('aperture','exposure','iso','focal_35mm')"""+suffix('m')+""")
                SELECT asset_id,field,value_json FROM ranked WHERE priority=1""",params):
                if r['asset_id'] in photos:photos[r['asset_id']]['technical'][r['field']]=json.loads(r['value_json'])
            for r in c.execute("""SELECT m.asset_id,m.revision,json_object('hdr_source',json_extract(m.data_json,'$.hdr_source'),
                'source_color',json_extract(m.data_json,'$.source_color'),'source_bit_depth',json_extract(m.data_json,'$.source_bit_depth'),
                'assumed_color',json_extract(m.data_json,'$.assumed_color')) color FROM media_info m WHERE 1=1"""+suffix('m'),params):
                if r['asset_id'] in photos and r['revision']==photos[r['asset_id']]['revision']:photos[r['asset_id']]['technical'].update(json.loads(r['color']))
            for r in c.execute("""SELECT a.asset_id,a.version,json_extract(a.data_json,'$.tags') tags FROM analysis a JOIN entries e ON e.id=a.asset_id AND e.revision=a.revision
                JOIN media_info m ON m.asset_id=e.id AND m.revision=e.revision WHERE a.provider='visual'
                AND a.version=(SELECT value FROM settings WHERE key='analysis_version')
                AND json_extract(a.data_json,'$.input_media_version') IS json_extract(m.data_json,'$.version')
                AND json_extract(a.data_json,'$.error') IS NULL"""+suffix('a'),params):
                if r['asset_id'] in photos:
                    photos[r['asset_id']]['subjects']=[{'id':str(t.get('synset') or (t['class_index'] if t.get('class_index') is not None else t.get('label',''))),'label':t.get('label_zh') or t.get('label',''),'raw_label':t.get('label',''),'taxonomy':t.get('taxonomy')} for t in localize_tags(json.loads(r['tags'] or '[]'))]
                    photos[r['asset_id']]['lexicon_versions']['visual']=r['version']
            for r in c.execute("""SELECT a.asset_id,a.version,a.data_json FROM analysis a JOIN entries e ON e.id=a.asset_id AND e.revision=a.revision
                JOIN media_info m ON m.asset_id=e.id AND m.revision=e.revision JOIN media_jobs q ON q.asset_id=e.id AND q.revision=e.revision
                WHERE a.provider='photography' AND a.version=(SELECT value FROM settings WHERE key='photography_version') AND q.status='ready'
                AND json_extract(a.data_json,'$.input_media_version') IS json_extract(m.data_json,'$.version')
                AND json_extract(a.data_json,'$.input_preview_updated') IS m.updated AND json_extract(a.data_json,'$.error') IS NULL"""+suffix('a'),params):
                if r['asset_id'] not in photos:continue
                photos[r['asset_id']]['lexicon_versions']['photography']=r['version']
                d=json.loads(r['data_json'])
                for source,target in [('style','styles'),('topic','topics')]:
                    photos[r['asset_id']][target]=[{'id':t['id'],'label':t['label'],'similarity':t.get('similarity')} for t in (d.get(source,{}).get('labels',[]) if d.get(source,{}).get('status')!='uncertain' else []) if isinstance(t,dict) and t.get('id') and t.get('label')]
            for r in c.execute("""SELECT f.asset_id,p.label,count(*) count FROM faces f JOIN entries e ON e.id=f.asset_id AND e.revision=f.revision
                JOIN people p ON p.id=f.person_id WHERE e.missing=0 AND e.scope_excluded=0"""+suffix('f')+""" GROUP BY f.asset_id,p.id""",params):
                if r['asset_id'] in photos:
                    p=photos[r['asset_id']];p['people_count']+=r['count']
                    if r['label']:p['people_terms'].append(r['label'])
        for p in photos.values():p['keyword_ids']=list(photo_terms(p))
        self.photos=list(photos.values());return self.photos
    def values(self,p,field):
        if field=='year':return [p['period'][:4]] if p['period'] else []
        if field=='activity':return [p['event'].get('theme') or '',p['activity_id']]
        if field in ('camera','lens'):return [p[field],p[field+'_id'],p.get('make','')+' '+p[field]]
        if field in ('country','province','city'):
            place=p.get('place')
            if not place:return []
            # Missing raw fields are common (especially province). Unknown labels are
            # display placeholders, not searchable facts; never casefold/join None.
            values=list(dict.fromkeys(v for v in ((place.get('display_zh') or {}).get(field),place.get(field)) if isinstance(v,str) and v))
            if field=='country':
                if isinstance(place.get('country_code'),str):values.append(place['country_code'])
                for aliases in (('Japan','日本','JP','JPN'),('China','中国','CN','CHN')):
                    if any(v.casefold() in {a.casefold() for a in aliases} for v in values):
                        values=list(dict.fromkeys([*values,*aliases]))
            return values
        if field in ('style','topic','subject'):
            return [str(t[k]) for t in p[{'style':'styles','topic':'topics','subject':'subjects'}[field]] for k in ('id','label')]
        raise ValueError('分类字段无效')
    def matches(self,p,f):
        groups=defaultdict(set)
        for identifier in f.keyword_ids:groups[identifier.split(':',1)[0]].add(identifier)
        if any(not ids.intersection(p.get('keyword_ids') or photo_terms(p)) for ids in groups.values()):return False
        stamp=p['period']
        if f.years and (not stamp or int(stamp[:4]) not in f.years):return False
        if f.months and (not stamp or len(stamp)<7 or int(stamp[5:7]) not in f.months):return False
        for boundary,start in [(f.date_from,True),(f.date_to,False)]:
            if not boundary:continue
            if not stamp or len(stamp)<len(boundary):return False
            a,b=span(stamp);lo,hi=span(boundary)
            if start and b<lo or not start and a>hi:return False
        if f.min_score is not None and (p.get('technical_score',p['score']) is None or p.get('technical_score',p['score'])<f.min_score):return False
        if f.min_aesthetic_score is not None and (p.get('aesthetic_score') is None or p['aesthetic_score']<f.min_aesthetic_score):return False
        if f.pinned is not None and p['pinned']!=f.pinned:return False
        if f.has_people is not None and bool(p['people_count'])!=f.has_people:return False
        if f.person and not any(f.person.casefold() in s.casefold() for s in p['people_terms']):return False
        if not f.include_estimated and (p['date_estimated'] or p['gps_layer']=='inferred'):return False
        w,h=p['info'].get('width') or 0,p['info'].get('height') or 0
        orientation='square' if w and h and .95<=w/h<=1.05 else 'landscape' if w>h else 'portrait' if h>w else None
        if f.orientation and orientation!=f.orientation:return False
        for field,prefix in [('iso','iso'),('aperture','aperture'),('exposure','exposure'),('focal_length','focal')]:
            value=p['focal_length'] if field=='focal_length' else p['technical'].get(field)
            for bound,lower in [(getattr(f,prefix+'_min'),True),(getattr(f,prefix+'_max'),False)]:
                if bound is None:continue
                if not isinstance(value,(int,float)) or isinstance(value,bool) or not math.isfinite(value):return False
                if lower and value<bound or not lower and value>bound:return False
        if f.hdr is not None and p['technical'].get('hdr_source') is not f.hdr and p['technical'].get('hdr_source')!=int(f.hdr):return False
        for field in ('activity','camera','lens','country','province','city','style','topic','subject'):
            wanted=getattr(f,field)
            if wanted and not any(x.casefold() in [v.casefold() for v in self.values(p,field)] for x in wanted):return False
        if f.query:
            text=' '.join(v for field in ('activity','camera','lens','country','province','city','style','topic','subject') for v in self.values(p,field)).casefold()
            if not all(term.casefold() in text for term in re.split(r'\s+',f.query.strip()) if term):return False
        return True
    @staticmethod
    def brief(p):
        return {'id':p['id'],'period':p['period'],'date_precision':p['date_precision'],'date_estimated':p['date_estimated'],
                'activity':p['event'].get('theme'),'camera':p['camera'],'lens':p['lens'],'score':p['score'],'score_kind':p.get('score_kind','technical'),'technical_score':p.get('technical_score',p['score']),'aesthetic_score':p.get('aesthetic_score'),'pinned':p['pinned'],
                'location':{k:place_label(p['place'],k) for k in ('country','province','city')} if p.get('place') else None,
                'place_precision':'nearest_city' if p.get('place') else None,'location_estimated':p['gps_layer']=='inferred',
                'style_candidates':p['styles'],'topic_candidates':p['topics'],'subject_candidates':p['subjects'][:4],
                'has_people':bool(p['people_count']),'width':p['info'].get('width'),'height':p['info'].get('height'),
                'technical':p['technical'],'focal_length':p['focal_length'],'extension':PurePosixPath(p['name']).suffix.lstrip('.').upper()}
    def dispatch(self,name,args):
        model=MODELS.get(name)
        if not model:raise ValueError('工具不在白名单内')
        body=model.model_validate(args)
        if name=='catalog_schema':return schema()
        photos=self.load()
        if name=='lookup_keywords':
            Lexicon(self.db).validate_ids(body.context.keyword_ids)
            scoped=[p for p in photos if self.matches(p,body.context)]
            counts=Counter(identifier for p in scoped for identifier in set(p['keyword_ids']))
            result=Lexicon(self.db).lookup(body.query,body.domains,limit=body.limit,cursor=body.cursor,counts=counts,context_key=json.dumps(body.context.model_dump(),sort_keys=True))
            result['count_scope']='当前策展快照中的不同照片数；机器标签为候选'
            return result
        if name=='library_overview':return {'keyword_lexicon':Lexicon(self.db).status(),'photos':len(photos),'years':dict(Counter(p['period'][:4] for p in photos if p['period'])),
            'undated':sum(p['period'] is None for p in photos),'with_approximate_place':sum(bool(p['place']) for p in photos),
            'with_style_candidates':sum(bool(p['styles']) for p in photos),'with_topic_candidates':sum(bool(p['topics']) for p in photos),
            'unscored':sum(p['score'] is None for p in photos),'selection':'仅可展示成片，排除隐藏/缺失/越界/占位，视频仍由活动页浏览'}
        if name=='list_facets':
            counts=Counter()
            for p in photos:
                vals=self.values(p,body.field)
                # One canonical label per photo for devices/place; candidate labels for taxonomy.
                if body.field in ('style','topic','subject'):vals=[t['label'] for t in p[{'style':'styles','topic':'topics','subject':'subjects'}[body.field]]]
                else:vals=vals[:1]
                # A translated label and its source spelling identify the same fact.
                # Match either alias, but count one canonical label per photo.
                if body.field in ('country','province','city'):
                    aliases=self.values(p,body.field)
                    if aliases and any(body.query.casefold() in v.casefold() for v in aliases):counts.update(vals)
                else:counts.update(v for v in set(vals) if v and body.query.casefold() in str(v).casefold())
            return {'field':body.field,'values':[{'value':k,'count':v} for k,v in counts.most_common(body.limit)],'distinct':len(counts)}
        if name in ('summarize_trips','search_photos'):
            Lexicon(self.db).validate_ids(body.filters.keyword_ids)
            if body.filters.date_from and body.filters.date_to and span(body.filters.date_from)[0]>span(body.filters.date_to)[1]:raise ValueError('日期范围无效')
            if any(getattr(body.filters,k+'_min') is not None and getattr(body.filters,k+'_max') is not None and getattr(body.filters,k+'_min')>getattr(body.filters,k+'_max') for k in ('iso','aperture','exposure','focal')):raise ValueError('数值范围无效')
            found=[p for p in photos if self.matches(p,body.filters)]
            if name=='summarize_trips':
                return summarize_trips(found,body.gap_days,body.offset,body.limit)|{'filters':body.filters.model_dump(exclude={'person'})}
            rng=random.Random(hashlib.sha256((self.run_id+json.dumps(body.filters.model_dump(),sort_keys=True)).encode()).digest())
            if body.order=='time':found.sort(key=lambda p:(p['period'] is None,p['period'] or '',str(p['captured_at'] or ''),p['id']))
            elif body.order=='score':found.sort(key=lambda p:(p['score'] is None,-(p['score'] or 0),p['id']))
            else:
                rng.shuffle(found)
                if body.order=='diverse':
                    groups=defaultdict(list)
                    for p in found:groups[p['activity_id']].append(p)
                    for group in groups.values():group.sort(key=lambda p:-(p['score'] if p['score'] is not None else -1))
                    found=[]
                    while groups:
                        for gid in list(groups):
                            found.append(groups[gid].pop(0))
                            if not groups[gid]:del groups[gid]
            search_id='search-'+uuid.uuid4().hex[:20];self.searches[search_id]={'photos':found,'filters':body.filters.model_dump(),'order':body.order}
            selected=found[body.offset:body.offset+body.limit];self.seen.update(p['id'] for p in selected)
            return {'search_id':search_id,'total':len(found),'offset':body.offset,'items':[self.brief(p) for p in selected],'next_offset':body.offset+len(selected) if body.offset+len(selected)<len(found) else None,'resolved_keyword_ids':body.filters.keyword_ids}
        if name=='photo_details':
            if not set(body.photo_ids)<=self.seen:raise ValueError('只能读取本轮已检索候选')
            return {'items':[self.brief(p) for p in photos if p['id'] in body.photo_ids]}
        if name=='create_exhibition':
            found=self.searches.get(body.search_id)
            if not found:raise ValueError('查询句柄不存在，请先检索')
            pool=found['photos'];ids=set(body.photo_ids)
            if ids and not ids<=self.seen:raise ValueError('选片ID必须来自本轮已显示的候选')
            if ids and not ids<={p['id'] for p in pool}:raise ValueError('选片ID不属于本次查询')
            selected=([p for p in pool if p['id'] in ids] if ids else pool)[:body.max_photos]
            if not selected:raise ValueError('没有匹配照片，不能创建空展览')
            room=self.requested_room if self.requested_room in ROOMS else body.room
            self.draft={'title':body.title,'room':room,'photos':selected,'selection':{'filters':found['filters'],'order':found['order'],'search_id':body.search_id}}
            return {'draft_created':True,'title':body.title,'room':room,'count':len(selected),'requires_preparation':True,'note':'仅本地草案，待模型结束后校验缓存与版本'}
        raise ValueError('工具不可用')
