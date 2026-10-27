"""Canonical local vocabulary and durable incremental metadata indexing; zero media I/O."""
from collections import Counter,defaultdict
from contextlib import contextmanager
from functools import lru_cache
import base64,hashlib,json,time,unicodedata
from .localization import catalog as localization
from .preferences import read_preferences

VERSION='keyword-lexicon-v1'
DOMAINS=('subject','topic','style','city')

def normalize(value):
    return ' '.join(unicodedata.normalize('NFKC',str(value)).casefold().split())

@lru_cache(maxsize=1)
def subject_names():
    result=defaultdict(set)
    for entry in localization()['synsets'].values():
        for word in {entry['en'],entry['source_en'],entry['zh'],*entry['en'].split(', ')}:
            result[normalize(word)].add(entry['synset'])
    return result

def config_stamp(c):
    keys=('analysis_version','photography_version','geography_version','geography_generation','lexicon_epoch')
    versions=dict(c.execute('SELECT key,value FROM settings WHERE key IN (?,?,?,?,?)',keys))
    p=read_preferences(c)
    return hashlib.sha256(json.dumps([VERSION,localization()['version'],versions,p['gps_use_inferred'],p['gps_max_distance_km']],sort_keys=True).encode()).hexdigest()

def photo_terms(p):
    """Resolve only known IDs/unique aliases, never related concepts or guessed geography."""
    result={};public=localization()
    def add(identity,domain,label,words,source,parents=None,precision=None):
        identifier=domain+':'+identity
        row=result.setdefault(identifier,{'id':identifier,'domain':domain,'label':label,'parents':parents or {},'precision':precision,
                                         'candidate':domain!='city','aliases':[],'source':source})
        for word,origin in words:
            if isinstance(word,str) and word.strip() and len(word)<=160:
                alias={'value':word.strip(),'source':origin,'language':'zh' if any('\u3400'<=x<='\u9fff' for x in word) else 'und'}
                if alias not in row['aliases']:row['aliases'].append(alias)
    for field,domain in [('subjects','subject'),('topics','topic'),('styles','style')]:
        for tag in p.get(field,[]):
            raw=str(tag.get('id') or '');label=tag.get('label') or raw
            words=[(label,'observed-label'),(raw,'observed-id'),(tag.get('raw_label'),'observed-label')]
            identity=raw
            if domain=='subject':
                known_taxonomy=tag.get('taxonomy') in (None,'','imagenet1k')
                entry=(public['synsets'].get(raw) or (public['indices'].get(int(raw)) if raw.isdigit() else None)) if known_taxonomy else None
                if not entry and known_taxonomy:
                    candidates=subject_names().get(normalize(raw),set()) or subject_names().get(normalize(label),set())
                    if len(candidates)==1:entry=public['synsets'][next(iter(candidates))]
                if entry:
                    identity=entry['synset'];label=entry['zh']
                    words.extend((w,'imagenet1k/'+public['version']) for w in {entry['zh'],entry['en'],entry['source_en'],*entry['en'].split(', ')})
                else:identity='unresolved-'+hashlib.sha256(json.dumps([tag.get('taxonomy'),raw,label],ensure_ascii=False).encode()).hexdigest()[:20]
            if not identity:continue
            if domain!='subject':words.append((raw.replace('_',' ').replace('-',' '),'photography-taxonomy-id'))
            provider='visual' if domain=='subject' else 'photography'
            source={'provider':provider,'model_version':p.get('lexicon_versions',{}).get(provider),'media_version':p.get('info',{}).get('version')}
            if tag.get('confirmed'):source={'provider':'manual','model_version':tag.get('confirmed_source_version'),'media_version':None}
            add(identity,domain,label,words,source)
    place=p.get('place')
    if place and place.get('city'):
        zh=place.get('display_zh') or {};country=str(place.get('country_code') or place.get('country') or '')
        province=str(place.get('province_code') or place.get('province') or '')
        gid=place.get('geonames_id')
        identity='geonames:'+str(gid) if gid else 'provisional-'+hashlib.sha256(json.dumps([country,province,normalize(place['city'])],ensure_ascii=False).encode()).hexdigest()[:20]
        words=[(place['city'],'place-observation'),(zh.get('city'),'place-display')]
        entry=public['geo']['places'].get(str(gid))
        if entry:words.extend((entry.get(k),'geonames/'+public['version']) for k in ('name','ascii','zh'))
        parents={k:zh.get(k) or place.get(k) for k in ('country','province')}
        parents.update(country_code=country,province_code=province)
        add(identity,'city',zh.get('city') or place['city'],words,{'provider':'places','model_version':p.get('place_version')},parents,'nearest_city')
    return result

class SnapshotDatabase:
    """All projection reads share one existing read transaction, with no nested commits."""
    def __init__(self,connection):self.connection=connection
    @contextmanager
    def connect(self):yield self.connection

class LexiconWorker:
    batch_size=128
    def __init__(self,db):self.db=db
    def ensure_generation(self):
        with self.db.connect() as c:
            stamp=config_stamp(c);state=dict(c.execute('SELECT * FROM lexicon_state').fetchone())
            target=state['building_generation'] or state['active_generation']
            row=c.execute('SELECT stamp FROM lexicon_generations WHERE id=?',(target,)).fetchone()
            if row and row['stamp']==stamp:return target
        with self.db.connect() as c:
            c.execute('BEGIN IMMEDIATE')
            if config_stamp(c)!=stamp:return None
            state=dict(c.execute('SELECT * FROM lexicon_state').fetchone())
            target=state['building_generation'] or state['active_generation']
            row=c.execute('SELECT stamp FROM lexicon_generations WHERE id=?',(target,)).fetchone()
            if row and row['stamp']==stamp:return target
            if state['building_generation']:c.execute("UPDATE lexicon_generations SET state='retired' WHERE id=?",(state['building_generation'],))
            generation=c.execute("INSERT INTO lexicon_generations(stamp,state,created) VALUES(?,'building',?)",(stamp,time.time())).lastrowid
            c.execute('UPDATE lexicon_state SET building_generation=?,heartbeat=?',(generation,time.time()))
            c.execute("INSERT INTO lexicon_dirty SELECT id,hex(randomblob(16)) FROM entries WHERE is_dir=0 ON CONFLICT(asset_id) DO UPDATE SET token=excluded.token")
            return generation
    def tick(self):
        target=self.ensure_generation()
        if target is None:return False
        with self.db.connect() as c:
            c.execute('BEGIN');stamp=config_stamp(c)
            jobs=[dict(r) for r in c.execute('SELECT * FROM lexicon_dirty ORDER BY asset_id LIMIT ?',(self.batch_size,))]
            if jobs:
                from .curator_tools import LocalTools
                from .exhibitions import ExhibitionCatalog
                snapshot=SnapshotDatabase(c)
                photos={p['id']:p for p in LocalTools(snapshot,ExhibitionCatalog(snapshot),'lexicon-local').load([r['asset_id'] for r in jobs])}
                projected={aid:photo_terms(p) for aid,p in photos.items()}
            else:photos={};projected={}
        with self.db.connect() as c:
            c.execute('BEGIN IMMEDIATE')
            state=dict(c.execute('SELECT * FROM lexicon_state').fetchone())
            target_stamp=c.execute('SELECT stamp FROM lexicon_generations WHERE id=?',(target,)).fetchone()
            if (state['building_generation'] or state['active_generation'])!=target or config_stamp(c)!=stamp or not target_stamp or target_stamp[0]!=stamp:return True
            touched=set();processed=0
            for job in jobs:
                current=c.execute('SELECT token FROM lexicon_dirty WHERE asset_id=?',(job['asset_id'],)).fetchone()
                if not current or current['token']!=job['token']:continue
                aid=job['asset_id'];old=list(c.execute('SELECT term_id,evidence_json FROM lexicon_asset_terms WHERE generation=? AND asset_id=?',(target,aid)));touched.update(r['term_id'] for r in old)
                for link in old:
                    for alias in json.loads(link['evidence_json']).get('aliases',[]):
                        c.execute('UPDATE lexicon_aliases SET refs=refs-1 WHERE generation=? AND term_id=? AND normalized=? AND label=? AND source=?',(target,link['term_id'],normalize(alias['value']),alias['value'],alias['source']))
                c.execute('DELETE FROM lexicon_asset_terms WHERE generation=? AND asset_id=?',(target,aid))
                for term in projected.get(aid,{}).values():
                    identifier=term['id'];touched.add(identifier)
                    info={k:v for k,v in term.items() if k not in ('id','label','domain','aliases','source')}
                    c.execute('INSERT INTO lexicon_terms VALUES(?,?,?,?,?,0) ON CONFLICT(generation,id) DO UPDATE SET label=excluded.label,info_json=excluded.info_json',
                              (target,identifier,term['domain'],term['label'],json.dumps(info,ensure_ascii=False)))
                    c.executemany('INSERT INTO lexicon_aliases VALUES(?,?,?,?,?,1) ON CONFLICT(generation,term_id,normalized,label,source) DO UPDATE SET refs=refs+1',[(target,identifier,normalize(a['value']),a['value'],a['source']) for a in term['aliases']])
                    c.execute('INSERT INTO lexicon_asset_terms VALUES(?,?,?,?,?)',(target,aid,photos[aid]['revision'],identifier,json.dumps({'source':term['source'],'aliases':term['aliases'],'input_layer':photos[aid].get('gps_layer') if term['domain']=='city' else None},ensure_ascii=False)))
                c.execute('DELETE FROM lexicon_dirty WHERE asset_id=? AND token=?',(aid,job['token']));processed+=1
            for identifier in touched:
                count=c.execute('SELECT count(*) FROM lexicon_asset_terms WHERE generation=? AND term_id=?',(target,identifier)).fetchone()[0]
                c.execute('UPDATE lexicon_terms SET photo_count=? WHERE generation=? AND id=?',(count,target,identifier))
                c.execute('DELETE FROM lexicon_aliases WHERE generation=? AND term_id=? AND refs<=0',(target,identifier))
            if processed:c.execute('UPDATE lexicon_state SET revision=revision+1,updated=?',(time.time(),))
            c.execute('UPDATE lexicon_generations SET processed=processed+? WHERE id=?',(processed,target))
            c.execute('UPDATE lexicon_state SET heartbeat=?',(time.time(),))
            if state['building_generation'] and not c.execute('SELECT 1 FROM lexicon_dirty LIMIT 1').fetchone():
                c.execute("UPDATE lexicon_generations SET state='retired' WHERE state='active'")
                c.execute("UPDATE lexicon_generations SET state='active',published=? WHERE id=?",(time.time(),target))
                c.execute('UPDATE lexicon_state SET active_generation=?,building_generation=NULL,updated=?',(target,time.time()))
        if not jobs:self.cleanup_retired()
        return bool(jobs) or bool(state['building_generation'])

    def cleanup_retired(self):
        # Keep one previous generation; bounded transactions reclaim older staging data.
        with self.db.connect() as c:
            old=c.execute("SELECT id FROM lexicon_generations WHERE state='retired' ORDER BY id DESC LIMIT -1 OFFSET 1").fetchall()
            if not old:return
            generation=old[-1][0]
            c.execute('BEGIN IMMEDIATE')
            for table in ('lexicon_asset_terms','lexicon_aliases','lexicon_terms'):
                deleted=c.execute('DELETE FROM '+table+' WHERE rowid IN (SELECT rowid FROM '+table+' WHERE generation=? LIMIT 1000)',(generation,)).rowcount
                if deleted:return
            c.execute("DELETE FROM lexicon_generations WHERE id=? AND state='retired'",(generation,))

class Lexicon:
    def __init__(self,db):self.db=db
    def status(self):
        with self.db.connect() as c:
            c.execute('BEGIN');state=dict(c.execute('SELECT * FROM lexicon_state').fetchone())
            generation=state['active_generation'];current=c.execute('SELECT * FROM lexicon_generations WHERE id=?',(generation,)).fetchone()
            building=c.execute('SELECT * FROM lexicon_generations WHERE id=?',(state['building_generation'],)).fetchone()
            domains={r['domain']:r['n'] for r in c.execute('SELECT domain,count(*) n FROM lexicon_terms WHERE generation=? AND photo_count>0 GROUP BY domain',(generation,))}
            aliases=c.execute('SELECT count(DISTINCT normalized) FROM lexicon_aliases WHERE generation=? AND refs>0',(generation,)).fetchone()[0]
            ambiguous=c.execute('SELECT count(*) FROM (SELECT t.domain,a.normalized FROM lexicon_aliases a JOIN lexicon_terms t ON t.generation=a.generation AND t.id=a.term_id WHERE a.generation=? AND t.photo_count>0 AND a.refs>0 GROUP BY t.domain,a.normalized HAVING count(DISTINCT a.term_id)>1)',(generation,)).fetchone()[0]
            photos=c.execute('SELECT count(DISTINCT asset_id) FROM lexicon_asset_terms WHERE generation=?',(generation,)).fetchone()[0]
            pending=c.execute('SELECT count(*) FROM lexicon_dirty').fetchone()[0]
            stale=not current or current['stamp']!=config_stamp(c)
            return {'generation':generation,'revision':state['revision'],'version':VERSION,'ready':bool(generation),'building':bool(building),'stale':stale,
                    'domains':{d:domains.get(d,0) for d in DOMAINS},'aliases':aliases,'ambiguous':ambiguous,'photos':photos,'pending':pending,
                    'updated':state['updated'],'worker_recent':state['heartbeat']>time.time()-15,'processed':building['processed'] if building else current['processed'] if current else 0}
    def lookup(self,query='',domains=DOMAINS,*,limit=20,cursor=None,counts=None,context_key=''):
        domains=tuple(domains or DOMAINS)
        if any(d not in DOMAINS for d in domains) or not 1<=limit<=60:raise ValueError('词库查询参数无效')
        query=normalize(query);status=self.status();generation=status['generation'];revision=status['revision']
        signature=hashlib.sha256(json.dumps([query,sorted(domains),context_key],ensure_ascii=False,sort_keys=True).encode()).hexdigest()[:20]
        offset=0
        if cursor:
            try:
                decoded=json.loads(base64.urlsafe_b64decode(cursor+'='*(-len(cursor)%4)))
                if decoded[:3]!=[generation,revision,signature] or type(decoded[3]) is not int or not 0<=decoded[3]<=1000000:raise ValueError()
                offset=decoded[3]
            except (ValueError,TypeError,IndexError,UnicodeError):raise ValueError('词库已更新或分页条件已变化，请重新查询') from None
        if not generation:return {'items':[],'total':0,'next_cursor':None,'status':status,'complete':False}
        escaped=query.replace('\\','\\\\').replace('%','\\%').replace('_','\\_')
        with self.db.connect() as c:
            c.execute('BEGIN')
            state=c.execute('SELECT active_generation,revision FROM lexicon_state').fetchone()
            if tuple(state)!=(generation,revision):raise ValueError('词库已更新或分页条件已变化，请重新查询')
            rows=[dict(r) for r in c.execute('SELECT t.*,a.normalized,a.label alias FROM lexicon_terms t JOIN lexicon_aliases a ON a.generation=t.generation AND a.term_id=t.id WHERE t.generation=? AND t.photo_count>0 AND a.refs>0 AND t.domain IN ('+','.join('?' for _ in domains)+") AND (?='' OR a.normalized LIKE ? ESCAPE '\\' OR t.id=?)",(generation,*domains,query,'%'+escaped+'%',query))]
            found={}
            for row in rows:
                count=counts.get(row['id'],0) if counts is not None else row['photo_count']
                if not count:continue
                rank=0 if row['normalized']==query or row['id']==query else 1 if row['normalized'].startswith(query) else 2
                if not query:rank=3
                candidate=found.setdefault(row['id'],{**row,'count':count,'rank':rank,'matches':set()})
                candidate['rank']=min(rank,candidate['rank']);candidate['matches'].add(row['alias'])
            ordered=sorted(found.values(),key=lambda r:(r['rank'],-r['count'],r['domain'],r['label'],r['id']))
            exact=Counter(r['domain'] for r in ordered if r['rank']==0)
            items=[]
            for row in ordered[offset:offset+limit]:
                alias_rows=c.execute('SELECT label,source FROM lexicon_aliases WHERE generation=? AND term_id=? AND refs>0 ORDER BY source,label',(generation,row['id']))
                by_label={}
                for alias in alias_rows:by_label.setdefault(alias['label'],[]).append(alias['source'])
                aliases=[{'value':label,'source':sources[0],'sources':sources,'language':'zh' if any('\u3400'<=x<='\u9fff' for x in label) else 'und'} for label,sources in list(by_label.items())[:16]]
                info=json.loads(row['info_json'])
                sources=[json.loads(r[0]) for r in c.execute("SELECT DISTINCT json_extract(evidence_json,'$.source') FROM lexicon_asset_terms WHERE generation=? AND term_id=? LIMIT 12",(generation,row['id']))]
                items.append({'id':row['id'],'domain':row['domain'],'display_name':row['label'],'photo_count':row['count'],'aliases':aliases,'matched_aliases':sorted(row['matches'])[:8],
                              'match_type':('exact','prefix','contains','browse')[row['rank']],'ambiguous':row['rank']==0 and exact[row['domain']]>1,'sources':sources,**info})
            next_offset=offset+len(items)
            next_cursor=base64.urlsafe_b64encode(json.dumps([generation,revision,signature,next_offset]).encode()).decode().rstrip('=') if next_offset<len(ordered) else None
        return {'items':items,'total':len(ordered),'next_cursor':next_cursor,'status':status,'complete':not(status['building'] or status['stale'] or status['pending'])}
    def validate_ids(self,identifiers):
        if not identifiers:return
        with self.db.connect() as c:
            state=c.execute('SELECT active_generation FROM lexicon_state').fetchone()
            found={r[0] for r in c.execute('SELECT id FROM lexicon_terms WHERE generation=? AND id IN ('+','.join('?' for _ in identifiers)+')',(state[0],*identifiers))}
        if found!=set(identifiers):raise ValueError('关键词 ID 无效或已过期，请先查询词库')
