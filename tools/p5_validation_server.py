"""P5 synthetic dated/geotagged/equipment fixture. No private catalog or NAS access."""
import importlib.util,io,json,os,tempfile,time
from pathlib import Path
from PIL import Image,ImageDraw,ImageCms
import uvicorn
port=int(os.environ.get('MUSEUM_FIXTURE_PORT','8795'))
os.environ['MUSEUM_HOSTS']=f'127.0.0.1:{port},localhost:{port}'
os.environ.setdefault('MUSEUM_WEB_DIST',str(Path('data/p5-validation/web-dist').resolve()))
spec=importlib.util.spec_from_file_location('fixture',Path('tests/p1/fixture.py'));fixture=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixture)
from photo_museum.api import create_app
from photo_museum.worker import Worker
from photo_museum.media_worker import MediaWorker
from photo_museum.analysis_worker import AnalysisWorker

with tempfile.TemporaryDirectory(prefix='museum-p5-') as directory,fixture.fixture() as (remote,url):
 app=create_app(directory);db=app.state.db;security=app.state.security;security.setup('synthetic-owner-password')
 remote.entries={fixture.ROOT:None}
 events=['2025-06-海岸之旅','2025-04-城市漫步','2024-10-山间露营','2024-10-花园午后','2024-10-海边的一天','2023-四季片段']
 for index,event in enumerate(events):
  folder=fixture.ROOT+'/'+event;remote.entries[folder]=None
  for n in range(14):
   image=Image.new('RGB',(1200,800));draw=ImageDraw.Draw(image)
   for y in range(800):draw.line((0,y,1200,y),fill=(35+int(y*.06),60+int(y*.06),77+int(y*.035)))
   draw.ellipse((850,65,1000,215),fill='#d8ae72');draw.polygon([(0,690),(340,170+n*5),(680,680),(960,280),(1200,680),(1200,800),(0,800)],fill=['#263e34','#35484a','#4b493e'][index%3])
   draw.polygon([(0,700),(500,530),(820,800),(0,800)],fill='#8e7454')
   if n%4==1:image=image.rotate(90,expand=True)
   if n%4==2:image=image.resize((1800,700))
   out=io.BytesIO();image.save(out,'JPEG',icc_profile=ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes())
   remote.entries[folder+f'/IMG_{n:04}.jpg']=out.getvalue()
 with db.connect() as c:c.execute('INSERT INTO sources VALUES(?,?,?,?,?,?,?,?,?)',('fixture','合成照片源',url,fixture.ROOT,'pulsar',security.encrypt('fixture-only'),None,1,time.time()))
 db.new_job('fixture',fixture.ROOT);w=Worker(db)
 while w.tick():pass
 m=MediaWorker(db)
 while m.tick():pass
 class Scores:
  id='visual';version='p5-synthetic-v1'
  def analyze(self,path):return {'score':72,'faces':[],'tags':[],'offline':True}
 worker=AnalysisWorker(db,Scores())
 while worker.tick():pass
 with db.connect() as c:rows=[dict(r) for r in c.execute('SELECT * FROM entries WHERE is_dir=0 ORDER BY path')]
 assert len(rows)==84,'Synthetic source did not scan completely'
 for n,row in enumerate(rows):
  event=json.loads(row['event_json']);month=event.get('month');year=event['year']
  if month and n%7!=0:db.set_metadata(row['id'],'captured_at',f'{year}:{month:02}:{n%27+1:02} 12:30:00','observed',row['revision'],'p5-fixture')
  if n%17==0:db.set_metadata(row['id'],'captured_at',None,'manual')
  camera,make,lens=[('ILCE-7CR','SONY','FE 50mm F1.4 GM'),('X-T50','FUJIFILM','17-70mm F/2.8'),('iPhone 15 Pro Max','Apple','iPhone back triple camera')][n%3]
  for field,value in [('camera',camera),('make',make),('lens',lens),('focal_length',[24,35,50,85,135][n%5])]:db.set_metadata(row['id'],field,value,'observed',row['revision'],'p5-fixture')
  if n%5!=0:
   country,code,province,city,gid,lat,lon=[('China','CN','Xinjiang','Xinyuan','1529046',43.4,83.2),('Japan','JP','Fukuoka','Fukuoka','1863967',33.59,130.4),('France','FR','Ile-de-France','Paris','2988507',48.86,2.35)][n%3]
   db.set_metadata(row['id'],'gps',{'latitude':lat+n%4*.002,'longitude':lon+n%3*.002},'observed',row['revision'],'p5-fixture')
   gps=db.effective(row['id'])['gps']
   place={'country':country,'country_code':code,'province':province,'city':city,'geonames_id':gid,'precision':'nearest_city','distance_m':321,'input_record':gps['record_id']}
   with db.connect() as c:c.execute('INSERT OR REPLACE INTO analysis VALUES(?,?,?,?,?,?)',(row['id'],row['revision'],'places','p5-places',json.dumps(place),time.time()))
  if n%9==0:
   with db.connect() as c:c.execute('INSERT OR REPLACE INTO curation VALUES(?,?,?,?)',(row['id'],1,0,time.time()))
 if os.environ.get('MUSEUM_VALIDATION_CURATOR')=='1':
  import httpx
  from photo_museum.curator_provider import ProviderInput,save_config
  from tests.p1.curator_fixture import FakeLLM
  save_config(db,security,ProviderInput(api_key='fake-provider-key'))
  app.state.curator.transport=httpx.MockTransport(FakeLLM(delay=.06))
 cleanup=lambda:None
 if os.environ.get('MUSEUM_VALIDATION_SETTINGS')=='1':
  from tools.settings_fixture import start
  cleanup=start(db,directory)
 print('P5/P6 synthetic ready',flush=True)
 try:uvicorn.run(app,host='127.0.0.1',port=port,access_log=False)
 finally:cleanup()
