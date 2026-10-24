"""Download public offline gazetteer. No photo/GPS data is sent."""
import hashlib
import json
from pathlib import Path
import urllib.request
DEST=Path(__file__).resolve().parents[1]/'data/models/geonames'
FILES={'cities15000.zip':'https://download.geonames.org/export/dump/cities15000.zip','admin1.txt':'https://download.geonames.org/export/dump/admin1CodesASCII.txt','countries.txt':'https://download.geonames.org/export/dump/countryInfo.txt'}
def main():
 DEST.mkdir(parents=True,exist_ok=True)
 manifest={}
 for name,url in FILES.items():
  target=DEST/name
  if not target.exists():
   temporary=target.with_suffix('.download')
   urllib.request.urlretrieve(url,temporary)
   temporary.replace(target)
  manifest[name]={'url':url,'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'bytes':target.stat().st_size,'license':'CC BY 4.0','attribution':'GeoNames'}
 (DEST/'manifest.json').write_text(json.dumps(manifest,indent=2))
 print('GeoNames ready; city-level approximation only')
if __name__=='__main__':main()
