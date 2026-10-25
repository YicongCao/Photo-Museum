"""Explicit real-provider probe using only three generated images and a local DAV fixture."""
import argparse,asyncio,io,json,tempfile,time,uuid
from pathlib import Path
from PIL import Image,ImageCms
from tests.p1.fixture import fixture,ROOT
from photo_museum.api import create_app
from photo_museum.auth import Security
from photo_museum.db import Database
from photo_museum.curator_provider import load_config,save_config,ProviderInput
from photo_museum.worker import Worker
from photo_museum.media_worker import MediaWorker
from photo_museum.analysis_worker import AnalysisWorker

def main():
 p=argparse.ArgumentParser();p.add_argument('--config-data',required=True);p.add_argument('--receipt',required=True);args=p.parse_args()
 config_db=Database(args.config_data);config=load_config(config_db,Security(config_db),True)
 with tempfile.TemporaryDirectory(prefix='museum-p6-probe-') as directory,fixture() as (remote,url):
  app=create_app(directory);db=app.state.db;security=app.state.security
  save_config(db,security,ProviderInput(**config))
  folder=ROOT+'/2024-10-三张合成风景';remote.entries={ROOT:None,folder:None}
  for n,color in enumerate(['#496575','#a67e55','#536b62']):
   image=Image.new('RGB',(360,240),color);out=io.BytesIO();image.save(out,'JPEG',icc_profile=ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes());remote.entries[folder+f'/SYNTH_{n}.jpg']=out.getvalue()
  with db.connect() as c:c.execute('INSERT INTO sources VALUES(?,?,?,?,?,?,?,?,?)',('fixture','synthetic',url,ROOT,'pulsar',security.encrypt('fixture-only'),None,1,time.time()))
  db.new_job('fixture',ROOT);worker=Worker(db)
  while worker.tick():pass
  media=MediaWorker(db)
  while media.tick():pass
  class Score:
   id='visual';version='p6-synthetic'
   def analyze(self,path):return {'score':72,'faces':[],'tags':[],'offline':True}
  analysis=AnalysisWorker(db,Score())
  while analysis.tick():pass
  rid=uuid.uuid4().hex;now=time.time()
  with db.connect() as c:c.execute('INSERT INTO curator_runs(id,prompt,room,status,created,updated) VALUES(?,?,?,?,?,?)',(rid,'这是合成图库接口验收。请筛选2024年的可展照片，生成一个简短命名的照片墙展览；不要放宽年份。','wall','queued',now,now))
  started=time.monotonic();asyncio.run(app.state.curator.run(rid,config));run=app.state.curator.get_run(rid)
  with db.connect() as c:events=[(r['kind'],json.loads(r['data_json'])) for r in c.execute('SELECT kind,data_json FROM curator_events WHERE run_id=?',(rid,))]
  result={'synthetic_only':True,'model':config['model'],'temperature':config['temperature'],'status':run['status'],'error':run['error'],'elapsed':round(time.monotonic()-started,2),
   'tool_names':[d['name'] for k,d in events if k=='tool_start'],'thinking_characters':sum(len(d['text']) for k,d in events if k=='thinking'),
   'usage':[d for k,d in events if k=='usage'],'preparation':[d for k,d in events if k=='preparation'],'created_exhibition':bool(run['exhibition_id'])}
  Path(args.receipt).write_text(json.dumps(result,indent=2));print(json.dumps(result))
  if run['status']!='completed' or not run['exhibition_id']:raise SystemExit(1)
if __name__=='__main__':main()
