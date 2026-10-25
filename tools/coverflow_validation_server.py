"""Synthetic media + real pipeline test server. No NAS credentials or user images."""
import io
import importlib.util
import os
from pathlib import Path
import tempfile
import time
import threading
from PIL import Image,ImageDraw,ImageCms
import uvicorn
os.environ['MUSEUM_HOSTS']='127.0.0.1:8794'
spec=importlib.util.spec_from_file_location('fixture',Path(__file__).resolve().parents[1]/'tests/p1/fixture.py')
fixture=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixture)
from photo_museum.api import create_app
from photo_museum.worker import Worker
from photo_museum.media_worker import MediaWorker

with tempfile.TemporaryDirectory(prefix='museum-gallery-fixture-') as directory,fixture.fixture() as (remote,url):
 app=create_app(directory);db=app.state.db;sec=app.state.security;sec.setup('synthetic-owner-password')
 remote.entries={fixture.ROOT:None}
 # Generated geometric color charts are validation fixtures, not concept photographs.
 for event in [f'2026-{12-i//2:02}-合成活动-{i:02}' for i in range(24)]:
  folder=fixture.ROOT+'/'+event;remote.entries[folder]=None
  for n in range(18):
   image=Image.new('RGB',(1200,800),['#496575','#a67e55','#536b62','#877463','#476b7d'][n%5]);draw=ImageDraw.Draw(image)
   draw.polygon([(0,600),(300+n*20,150),(650,620),(900,260),(1200,650),(1200,800),(0,800)],fill='#253b3c');draw.ellipse((850,80,980,210),fill='#d8ae72')
   if n%3==1:image=image.rotate(90,expand=True)
   if n%3==2:image=image.resize((1800,600))
   out=io.BytesIO();image.save(out,'JPEG',icc_profile=ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes())
   remote.entries[folder+f'/IMG_{n:04}.jpg']=out.getvalue()
 with db.connect() as c:c.execute('INSERT INTO sources VALUES(?,?,?,?,?,?,?,?,?)',('fixture','合成照片源',url,fixture.ROOT,'pulsar',sec.encrypt('fixture-only'),None,1,time.time()))
 db.new_job('fixture',fixture.ROOT);w=Worker(db)
 while w.tick():pass
 m=MediaWorker(db)
 while m.tick():pass
 from photo_museum.analysis_worker import AnalysisWorker
 class SyntheticScore:
  id='visual';version='synthetic-v1'
  def analyze(self,path):return {'score':70,'faces':[],'tags':[],'offline':True}
 analysis=AnalysisWorker(db,SyntheticScore())
 while analysis.tick():pass
 print('Synthetic exhibition ready',flush=True)
 uvicorn.run(app,host='127.0.0.1',port=8794,access_log=False)
