"""Tiny offline address worker for settings UI tests; generated data, no downloads."""
import os,threading,time,zipfile
from pathlib import Path
from photo_museum.analysis_worker import AnalysisWorker

def start(db,directory):
 root=Path(directory)/'models';geo=root/'geonames';geo.mkdir(parents=True)
 cities=[('1529046','Xinyuan',43.4,83.2,'CN','65'),('1863967','Fukuoka',33.59,130.4,'JP','07'),('2988507','Paris',48.86,2.35,'FR','11')]
 with zipfile.ZipFile(geo/'cities15000.zip','w') as z:z.writestr('cities15000.txt','\n'.join('\t'.join([gid,name,name,'',str(lat),str(lon),'P','PPL',country,'',admin]) for gid,name,lat,lon,country,admin in cities))
 (geo/'admin1.txt').write_text('CN.65\tXinjiang\tXinjiang\t1529047\nJP.07\tFukuoka\tFukuoka\t1863958\nFR.11\tIle-de-France\tIle-de-France\t3012874\n')
 (geo/'countries.txt').write_text('CN\tCHN\t156\tCH\tChina\nJP\tJPN\t392\tJA\tJapan\nFR\tFRA\t250\tFR\tFrance\n')
 os.environ['MUSEUM_MODELS']=str(root);os.environ['MUSEUM_ANALYSIS_ENABLED']='1'
 class Provider:
  id='visual';version='p5-synthetic-v1';models=root
  def analyze(self,path):return {'score':72,'tags':[],'faces':[],'offline':True}
 worker=AnalysisWorker(db,Provider());stop=threading.Event()
 def work():
  while not stop.is_set():
   worker.tick();stop.wait(.08)
 thread=threading.Thread(target=work,daemon=True);thread.start()
 def close():stop.set();thread.join(timeout=3)
 return close
