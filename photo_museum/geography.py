"""Optional offline GeoNames nearest-settlement lookup; never claims a street address."""
import hashlib
import io
import json
from pathlib import Path
import zipfile
from .inference import distance

class GeoNames:
 id='places'
 def __init__(self,directory):
  import numpy as np
  self.np=np;root=Path(directory)
  files=['cities15000.zip','admin1.txt','countries.txt']
  self.version='geonames-city-v1-'+hashlib.sha256(b''.join((root/f).read_bytes() for f in files)).hexdigest()[:12]
  self.admin={}
  for line in (root/'admin1.txt').read_text().splitlines():
   p=line.split('\t');self.admin[p[0]]=p[1]
  self.countries={}
  for line in (root/'countries.txt').read_text().splitlines():
   if line and not line.startswith('#'):
    p=line.split('\t');self.countries[p[0]]=p[4]
  self.cities=[]
  with zipfile.ZipFile(root/'cities15000.zip') as z:
   for line in io.TextIOWrapper(z.open('cities15000.txt')):
    p=line.rstrip('\n').split('\t')
    self.cities.append({'latitude':float(p[4]),'longitude':float(p[5]),'city':p[1],'country_code':p[8],'province':self.admin.get(p[8]+'.'+p[10]),'id':p[0]})
  coords=np.radians([[c['latitude'],c['longitude']] for c in self.cities])
  self.xyz=np.column_stack((np.cos(coords[:,0])*np.cos(coords[:,1]),np.cos(coords[:,0])*np.sin(coords[:,1]),np.sin(coords[:,0])))
 def reverse(self,gps):
  np=self.np;lat,lon=np.radians([gps['latitude'],gps['longitude']]);q=np.array([np.cos(lat)*np.cos(lon),np.cos(lat)*np.sin(lon),np.sin(lat)])
  city=self.cities[int(np.argmax(self.xyz@q))]
  d=distance(gps,city)
  if d>100000:return {'status':'unknown','precision':'unknown','attribution':'GeoNames CC BY'}
  return {'country':self.countries.get(city['country_code'],city['country_code']),'country_code':city['country_code'],'province':city['province'],'city':city['city'],'district':None,'street':None,'precision':'nearest_city','distance_m':round(d),'attribution':'GeoNames CC BY','geonames_id':city['id']}
