"""Conservative two-sided filename inference. Observed donors only; never EXIF copying."""
import datetime as dt
import json
import math
import re
from pathlib import PurePosixPath

RULE='two-sided-sequence-v1'
def sequence(path):
    m=re.fullmatch(r'([A-Za-z]+[_-]?)(\d{3,8})',PurePosixPath(path).stem)
    return (m[1].upper(),int(m[2])) if m else None

def timestamp(value):
    try:
        return dt.datetime.strptime(str(value),'%Y:%m:%d %H:%M:%S')
    except ValueError:
        return None

def distance(a,b):
    p,q=map(math.radians,(a['latitude'],b['latitude']))
    dl=math.radians(b['longitude']-a['longitude'])
    return 6371000*2*math.asin(min(1,math.sqrt(math.sin((q-p)/2)**2+math.cos(p)*math.cos(q)*math.sin(dl/2)**2)))

def infer_directory(database,source_id,parent):
    with database.connect() as c:
        entries=[dict(r) for r in c.execute("SELECT * FROM entries WHERE source_id=? AND parent=? AND missing=0 AND scope_excluded=0 AND is_dir=0 AND kind='image_candidate'",(source_id,parent))]
        ids={e['id'] for e in entries}
        observed={}
        for r in c.execute("SELECT * FROM metadata WHERE layer='observed' AND stale=0 AND asset_id IN (SELECT id FROM entries WHERE source_id=? AND parent=?)",(source_id,parent)):
            observed.setdefault(r['asset_id'],{})[r['field']]=dict(r)|{'value':json.loads(r['value_json'])}
    groups={}
    for e in entries:
        seq=sequence(e['path'])
        if seq:
            groups.setdefault(seq[0],[]).append((seq[1],e))
    for group in groups.values():
        group.sort(key=lambda x:(x[0],x[1]['id']))
        if len({n for n,_ in group})!=len(group):
            continue
        for i,(number,target) in enumerate(group):
            if i==0 or i==len(group)-1:
                continue
            left,right=group[i-1],group[i+1]
            if max(number-left[0],right[0]-number)>3:
                continue
            a,b=(observed.get(e[1]['id'],{}) for e in (left,right))
            own=observed.get(target['id'],{})
            ta,tb=timestamp(a.get('captured_at',{}).get('value')),timestamp(b.get('captured_at',{}).get('value'))
            if not ta or not tb or not 0<=(tb-ta).total_seconds()<=600 or ta.date()!=tb.date():
                continue
            # A known conflict always vetoes. Unknown camera keeps suggestions unaccepted.
            cameras=[x.get('camera',{}).get('value') for x in (a,own,b)]
            known=[x for x in cameras if x]
            if len(set(known))>1 or a.get('timezone',{}).get('value')!=b.get('timezone',{}).get('value'):
                continue
            confident=all(cameras) and len(set(cameras))==1
            for field in ('captured_at','gps'):
                if field in own or field not in a or field not in b:
                    continue
                donors=[(e['id'],e['revision'],facts[field]['record_id']) for (_,e),facts in ((left,a),(right,b))]
                info={'accepted':confident,'confidence':'supported' if confident else 'tentative','precision':'day' if field=='captured_at' else 'area','uncertainty':{'time_lower':str(ta),'time_upper':str(tb)}}
                if field=='captured_at':
                    value=ta.date().isoformat()
                else:
                    d=distance(a[field]['value'],b[field]['value'])
                    if d>200:
                        continue
                    value=a[field]['value']
                    info['uncertainty']['radius_m']=max(200,round(d))
                database.set_metadata(target['id'],field,value,'inferred',target['revision'],RULE,donors,info)
