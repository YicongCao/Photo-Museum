"""Explicit paid-provider test using only synthetic metadata and the user's regression prompt."""
import argparse,asyncio,json,tempfile,time,uuid
from pathlib import Path
from photo_museum.db import Database
from photo_museum.auth import Security
from photo_museum.curator import Curator
from photo_museum.curator_provider import load_config
from photo_museum.curator_tools import LocalTools

PROMPT='帮我从定位在日本的照片里，统计一下看看我平均多久去一次日本玩？或者说我每次去日本都间隔了多久？'

class SyntheticCatalog:
    def photos(self,asset_ids=None):
        result=[]
        for stamp,count,country in [('2024-01-01',210,'Japan'),('2024-01-03',1,'Japan'),('2024-03-01',1,'Japan'),('2024-03-02',1,'Japan'),('2024-07-01',1,'Japan'),('2024-08',1,'Japan'),(None,1,'Japan'),('2024-02-01',25,'China')]:
            for _ in range(count):
                result.append({'id':'synthetic-'+str(len(result)), 'revision':'synthetic-v1','kind':'image_candidate',
                    'period':stamp,'captured_at':stamp,'date_precision':{4:'year',7:'month',10:'day'}.get(len(stamp or ''),'unknown'),
                    'date_source':'metadata','date_estimated':False,'gps_layer':'observed',
                    'place':{'country':country,'country_code':'JP' if country=='Japan' else 'CN','city':'Synthetic City'},
                    'name':'synthetic.jpg','thumbnail':None,'preview':None,'info':{'width':1200,'height':800},'event':{'theme':'合成行程'},
                    'activity_id':'synthetic-activity','camera':'Synthetic Camera','camera_id':'synthetic-camera','make':'Synthetic',
                    'lens':'','lens_id':'synthetic-lens','score':75,'technical_score':75,'pinned':False,'focal_length':35})
        return result if asset_ids is None else [p for p in result if p['id'] in asset_ids]

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--config-data',required=True);p.add_argument('--output',required=True);p.add_argument('--live',action='store_true');args=p.parse_args()
    if not args.live:p.error('--live explicitly acknowledges a real provider invocation')
    source=Database(args.config_data);config=load_config(source,Security(source),True)
    with tempfile.TemporaryDirectory(prefix='museum-trip-probe-') as temp:
        db=Database(temp);catalog=SyntheticCatalog();manager=Curator(db,Security(db),catalog)
        expected=LocalTools(db,catalog,'oracle').dispatch('summarize_trips',{'filters':{'country':['日本']}})
        assert expected['trip_count']==3 and expected['start_to_start']['mean_days']==91
        rid=uuid.uuid4().hex;now=time.time()
        with db.connect() as c:c.execute('INSERT INTO curator_runs(id,prompt,room,status,created,updated) VALUES(?,?,?,?,?,?)',(rid,PROMPT,'auto','queued',now,now))
        started=time.monotonic();asyncio.run(manager.run(rid,config));run=manager.get_run(rid)
        with db.connect() as c:events=[{'kind':r['kind'],'data':json.loads(r['data_json'])} for r in c.execute('SELECT kind,data_json FROM curator_events WHERE run_id=? ORDER BY id',(rid,))]
        receipt={'synthetic_only':True,'model':config['model'],'prompt':PROMPT,'status':run['status'],'error':run['error'],'answer':run['answer'],
                 'elapsed_seconds':round(time.monotonic()-started,2),'expected':expected,'created_exhibition':bool(run['exhibition_id']),
                 'tools':[e['data']['name'] for e in events if e['kind']=='tool_start'],'events':events}
        out=Path(args.output);out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(receipt,ensure_ascii=False,indent=2))
        print(json.dumps({k:receipt[k] for k in ('status','error','elapsed_seconds','tools','created_exhibition','answer')},ensure_ascii=False))
        if run['status']!='completed' or run['exhibition_id'] or 'summarize_trips' not in receipt['tools']:raise SystemExit(1)
if __name__=='__main__':main()
