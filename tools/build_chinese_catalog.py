"""Build bundled display names from public offline sources; never reads photo metadata.

Inputs: tools/prepare_geography.py data plus downloaded files/manifest in
--sources (see docs/research/chinese-labels-validation.md). Network is not used here.
"""
import argparse,collections,hashlib,io,json,re,shutil,unicodedata,zipfile
from importlib import metadata
from pathlib import Path

LANG={'zh-Hans':0,'zh-CN':0,'zh':1,'zh-Hant':2,'zh-TW':3,'yue':3,'wuu':3,'':4}
def normalized(value):
 return ''.join(c for c in unicodedata.normalize('NFKD',value).casefold() if c.isalnum() and not unicodedata.combining(c))
def build(sources,geography,destination):
 from timm.data import ImageNetInfo
 destination.mkdir(parents=True,exist_ok=True)
 manifest=json.loads((sources/'manifest.json').read_text())
 for name in ['cn-alternate-names.zip','imagenet-cn.txt','imagenet-en.txt','Chinese-CLIP-LICENSE.txt']:
  if hashlib.sha256((sources/name).read_bytes()).hexdigest()!=manifest[name]['sha256']:raise ValueError('source_checksum_mismatch: '+name)
 records={};provinces={}
 for line in (geography/'admin1.txt').read_text().splitlines():
  p=line.split('\t')
  if p[0].startswith('CN.'):
   records[p[3]]={'kind':'province','name':p[1],'ascii':p[2],'province_code':p[0]};provinces[p[0]]=p[3]
 with zipfile.ZipFile(geography/'cities15000.zip') as z:
  for line in io.TextIOWrapper(z.open('cities15000.txt')):
   p=line.rstrip('\n').split('\t')
   if p[8]=='CN':records[p[0]]={'kind':'city','name':p[1],'ascii':p[2],'province_code':'CN.'+p[10]}
 candidates=collections.defaultdict(list)
 with zipfile.ZipFile(sources/'cn-alternate-names.zip') as z:
  for line in io.TextIOWrapper(z.open('CN.txt')):
   p=line.rstrip('\n').split('\t')
   if len(p)<8 or p[1] not in records or p[2] not in LANG or p[6]=='1' or p[7]=='1' or not re.search('[\u3400-\u9fff]',p[3]):continue
   if p[2]=='' and not re.fullmatch('[\u3400-\u9fff·（）()—\-\s]+',p[3]):continue
   candidates[p[1]].append((LANG[p[2]],p[4]!='1',p[5]!='1',len(p[3]),p[3]))
 localized={}
 for gid,record in records.items():
  names=candidates[gid]
  if not names:continue
  if min(n[0] for n in names)==4:
   bases={re.sub(r'(自治县|街道|省|市|县|区|镇|乡)$','',n[-1]) for n in names}
   if len(bases)!=1:continue # Unlabelled aliases with conflicting names are not guessed.
  selected=min(names)[-1]
  # A compact form is used only when explicitly present as another Chinese alias.
  compact=re.sub(r'(维吾尔自治区|壮族自治区|回族自治区|特别行政区|自治区|省|市|县|区|镇|乡)$','',selected)
  if len(compact)>=2 and any(n[-1]==compact and n[0]<=4 for n in names):selected=compact
  localized[gid]={**record,'zh':selected,'name_source':'geonames-unlabelled-han' if min(n[0] for n in names)==4 else 'geonames-chinese-language'}
 country={'places':localized,'provinces':provinces,'source':'GeoNames CC BY 4.0','scope':'CN; existing cities15000 and admin1 IDs; display only'}
 (destination/'geonames-zh.json').write_text(json.dumps(country,ensure_ascii=False,sort_keys=True,separators=(',',':'))+'\n')
 en=(sources/'imagenet-en.txt').read_text().splitlines();zh=(sources/'imagenet-cn.txt').read_text().splitlines()
 info=ImageNetInfo();assert len(en)==len(zh)==1000
 assert en[0]=='tench' and en[7]=='rooster' and en[999]=='toilet paper'
 entries=[{'index':i,'synset':info.index_to_label_name(i),'en':info.index_to_description(i),'source_en':en[i],'zh':zh[i]} for i in range(1000)]
 assert len({e['synset'] for e in entries})==1000
 (destination/'imagenet-zh.json').write_text(json.dumps(entries,ensure_ascii=False,separators=(',',':'))+'\n')
 shutil.copyfile(sources/'Chinese-CLIP-LICENSE.txt',destination/'Chinese-CLIP-LICENSE.txt')
 distribution=metadata.distribution('timm')
 license_path=next(p for p in distribution.files if str(p).endswith('.dist-info/licenses/LICENSE'))
 shutil.copyfile(distribution.locate_file(license_path),destination/'timm-LICENSE.txt')
 provenance=json.loads((sources/'manifest.json').read_text())
 provenance['timm']={'version':distribution.version,'source':'https://github.com/huggingface/pytorch-image-models','license':'Apache-2.0'}
 for name in ['cities15000.zip','admin1.txt']:
  raw=(geography/name).read_bytes();provenance[name]={'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw),'source':'GeoNames offline gazetteer'}
 for name in ['geonames-zh.json','imagenet-zh.json']:
  raw=(destination/name).read_bytes();provenance[name]={'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw)}
 (destination/'sources.json').write_text(json.dumps(provenance,indent=2)+'\n')
 print(json.dumps({'localized_places':len(localized),'cities':sum(p['kind']=='city' for p in localized.values()),'provinces':sum(p['kind']=='province' for p in localized.values()),'subject_classes':len(entries)},ensure_ascii=False))
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--sources',type=Path,default=Path('data/localization-sources'));p.add_argument('--geography',type=Path,default=Path('data/models/geonames'));p.add_argument('--output',type=Path,default=Path('photo_museum/locales'));a=p.parse_args();build(a.sources,a.geography,a.output)
