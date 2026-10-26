"""Offline aesthetic pilot. Reads the production index/cache; never writes to them."""
import argparse,base64,hashlib,io,json,math,random,socket,sqlite3,time
from collections import defaultdict
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]

def digest(path):
 with Path(path).open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()

def average_ranks(values):
 ordered=sorted(range(len(values)),key=lambda i:values[i]);ranks=[0.]*len(values);start=0
 while start<len(ordered):
  end=start+1
  while end<len(ordered) and values[ordered[end]]==values[ordered[start]]:end+=1
  for i in ordered[start:end]:ranks[i]=(start+end-1)/2
  start=end
 return ranks

def sample_rows(database,cache,events=8,per_event=32):
 c=sqlite3.connect(f'file:{Path(database).resolve()}?mode=ro',uri=True);c.row_factory=sqlite3.Row
 try:
  version=c.execute("SELECT value FROM settings WHERE key='analysis_version'").fetchone()[0]
  faces=dict(c.execute('SELECT asset_id,count(*) FROM faces GROUP BY asset_id'))
  rows=list(c.execute("""SELECT e.id,e.revision,e.source_id,e.parent,e.path,e.event_json,a.data_json analysis_json,
   m.data_json media_json,t.path thumb,d.path display FROM entries e
   JOIN analysis a ON a.asset_id=e.id AND a.revision=e.revision AND a.provider='visual' AND a.version=?
   JOIN media_info m ON m.asset_id=e.id AND m.revision=e.revision
   JOIN media_jobs q ON q.asset_id=e.id AND q.revision=e.revision AND q.status='ready'
   JOIN cache_files t ON t.asset_id=e.id AND t.revision=e.revision AND t.profile='thumb'
   JOIN cache_files d ON d.asset_id=e.id AND d.revision=e.revision AND d.profile='display'
   WHERE e.kind='image_candidate' AND e.missing=0 AND e.scope_excluded=0
   AND NOT EXISTS(SELECT 1 FROM curation u WHERE u.asset_id=e.id AND u.excluded=1)
   AND json_extract(a.data_json,'$.input_media_version') IS json_extract(m.data_json,'$.version')
   AND json_extract(a.data_json,'$.error') IS NULL AND json_extract(a.data_json,'$.score') IS NOT NULL
   AND coalesce(json_extract(m.data_json,'$.metadata_only'),0)=0
   AND coalesce(json_extract(m.data_json,'$.placeholder'),0)=0 ORDER BY e.path""",(version,)))
 finally:c.close()
 groups=defaultdict(list)
 for raw in rows:
  r=dict(raw);r['analysis']=json.loads(r.pop('analysis_json'));r['media']=json.loads(r.pop('media_json'))
  r['event']=json.loads(r.pop('event_json'));r['face_count']=faces.get(r['id'],0)
  if all((Path(cache)/r[k]).is_file() for k in ('thumb','display')):groups[(r['source_id'],r['parent'])].append(r)
 eligible=[(key,items) for key,items in groups.items() if len(items)>=per_event]
 chosen=[]
 def pick(key):
  remaining=[g for g in eligible if g[0] not in {v[0] for v in chosen}]
  if remaining:chosen.append(max(remaining,key=key))
 pick(lambda g:sum(r['face_count']>0 for r in g[1])/len(g[1]))
 pick(lambda g:sum(r['analysis'].get('features',{}).get('clipped_fraction',0)>.25 for r in g[1])/len(g[1]))
 pick(lambda g:sum(r['media'].get('width',1)/max(1,r['media'].get('height',1))>=2.4 for r in g[1])/len(g[1]))
 pick(lambda g:sum(bool(r['analysis'].get('score_penalty')) for r in g[1])/len(g[1]))
 pick(lambda g:max(r['event'].get('year',0) or 0 for r in g[1]))
 pick(lambda g:-min(r['event'].get('year',9999) or 9999 for r in g[1]))
 while len(chosen)<min(events,len(eligible)):pick(lambda g:hashlib.sha256(str(g[0]).encode()).hexdigest())
 result=[]
 for index,(_,items) in enumerate(chosen[:events]):
  ranked=sorted(items,key=lambda r:(-r['analysis']['score'],r['path'],r['id']))
  selected={r['id']:r for r in ranked[:10]}
  # Preserve old Top10, add time/file-sequence and score-range coverage deterministically.
  for pool in (items,ranked[::-1],ranked):
   for i in range(per_event):
    r=pool[round(i*(len(pool)-1)/max(1,per_event-1))]
    if len(selected)<per_event:selected[r['id']]=r
  result.append({'id':f'event-{index}','event':items[0]['event'],'population':len(items),'rows':list(selected.values())})
 return result,version

def make_pairs(items,groups):
 rng=random.Random(1026);byid={p['id']:p for p in items};pairs=[];used=set()
 for g in groups:
  ps=[byid[x] for x in g['photos']];possible=[]
  for i,a in enumerate(ps):
   for b in ps[i+1:]:
    if abs(a['technical']-b['technical'])>=3 and abs(a['center']-b['center'])>=.15 and (a['technical']-b['technical'])*(a['center']-b['center'])<0:
     possible.append((abs(a['center']-b['center']),a,b))
  selected=[(a,b,'disagreement') for _,a,b in sorted(possible,key=lambda v:-v[0])[:2]]
  for _ in range(100):
   a,b=rng.sample(ps,2)
   if not any({a['id'],b['id']}=={x['id'],y['id']} for x,y,_ in selected):selected.append((a,b,'random'))
   if len(selected)>=4:break
  for a,b,kind in selected:
   key=tuple(sorted((a['id'],b['id'])))
   if key in used:continue
   used.add(key)
   if rng.random()<.5:a,b=b,a
   pairs.append({'id':hashlib.sha256('|'.join(key).encode()).hexdigest()[:16],'left':a['id'],'right':b['id'],'group':g['id'],'kind':kind})
 rng.shuffle(pairs);return pairs

def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',default='data/aesthetic-trial-2026-10-26');parser.add_argument('--events',type=int,default=8);parser.add_argument('--per-event',type=int,default=32);args=parser.parse_args()
 out=(ROOT/args.output).resolve()
 if not out.is_relative_to(ROOT/'data'):raise ValueError('Private results must stay inside ignored data/')
 out.mkdir(parents=True,exist_ok=True);models=out/'models';manifest=json.loads((models/'manifest.json').read_text())
 if digest(models/'head.safetensors')!=manifest['files']['converted']['sha256']:raise ValueError('Head checksum mismatch')
 base=ROOT/'data/models/photography';base_manifest=json.loads((base/'manifest.json').read_text())
 if digest(base/'clip.safetensors')!=base_manifest['weights_sha256']:raise ValueError('Base checksum mismatch')
 def blocked(*_args,**_kwargs):raise RuntimeError('Inference has network disabled')
 socket.socket.connect=blocked;socket.create_connection=blocked
 import torch,open_clip,numpy as np
 from PIL import Image,ImageOps
 from safetensors.torch import load_file
 torch.set_num_threads(2);torch.manual_seed(1026)
 started=time.monotonic();model,_,preprocess=open_clip.create_model_and_transforms('ViT-B-32-quickgelu',pretrained=str(base/'clip.safetensors'),device='cpu');model.eval()
 head=torch.nn.Linear(512,1);head.load_state_dict(load_file(str(models/'head.safetensors')));head.eval()
 groups,visual_version=sample_rows(ROOT/'data/server/catalog.sqlite',ROOT/'data/server/cache',args.events,args.per_event)
 if not groups:raise RuntimeError('No eligible cached activities')
 records=[];embeddings=[];thumb_delta=[];center_view_delta=[]
 def score(views):
  with torch.inference_mode():
   features=model.encode_image(torch.stack([preprocess(v) for v in views]),normalize=True)
   assert features.shape[1]==512 and torch.isfinite(features).all()
   predicted=head(features).flatten();manual=features@head.weight[0]+head.bias[0]
   assert torch.allclose(predicted,manual,atol=1e-5)
  return predicted.tolist(),features[1 if len(views)>1 else 0].numpy().copy()
 for gi,g in enumerate(groups):
  ids=[]
  for ri,r in enumerate(g.pop('rows')):
   uid=hashlib.sha256((r['id']+r['revision']).encode()).hexdigest()[:20]
   with Image.open(ROOT/'data/server/cache'/r['display']) as original:
    image=ImageOps.exif_transpose(original).convert('RGB');w,h=image.size;side=min(w,h)
    crops=[image.crop((x,0,x+side,h)) for x in (0,(w-side)//2,w-side)] if w>=h else [image.crop((0,y,w,y+side)) for y in (0,(h-side)//2,h-side)]
    values,_=score(crops)
    center_value,feature=score([image]);center_view_delta.append(abs(center_value[0]-values[1]))
    if not records:
     repeated,_=score([image]);assert abs(repeated[0]-center_value[0])<1e-5
    preview=image.copy();preview.thumbnail((1152,864),Image.Resampling.LANCZOS);buffer=io.BytesIO();preview.save(buffer,'WEBP',quality=81)
   if ri<2:
    with Image.open(ROOT/'data/server/cache'/r['thumb']) as thumb:thumb_score,_=score([thumb.convert('RGB')])
    thumb_delta.append(abs(thumb_score[0]-center_value[0]))
   event=r['event'];label=str(event.get('year') or '')+('-'+str(event['month']).zfill(2) if event.get('month') else '')+' · '+event.get('theme','活动')
   record={'id':uid,'group':g['id'],'name':Path(r['path']).name,'technical':r['analysis']['score'],'center':center_value[0],'multi':sum(values)/len(values),'crop_span':max(values)-min(values),'faces':r['face_count'],'aspect':round(w/h,3),'assumed_color_penalty':r['analysis'].get('score_penalty',0),'image':'data:image/webp;base64,'+base64.b64encode(buffer.getvalue()).decode()}
   records.append(record);embeddings.append(feature);ids.append(uid);g['label']=label
  g['photos']=ids;print(json.dumps({'event':gi+1,'events':len(groups),'scored':len(records)}),flush=True)
 pairs=make_pairs(records,groups);byid={r['id']:r for r in records};overlaps=[]
 for g in groups:
  ids=g['photos'];old=set(sorted(ids,key=lambda k:-byid[k]['technical'])[:10]);new=set(sorted(ids,key=lambda k:-byid[k]['center'])[:10]);overlaps.append(len(old&new))
 center=np.array([r['center'] for r in records]);tech=np.array([r['technical'] for r in records]);multi=np.array([r['multi'] for r in records]);order=average_ranks
 summary={'photos':len(records),'activities':len(groups),'pairs':len(pairs),'model':'OpenAI CLIP ViT-B/32 + LAION aesthetics V1 linear head','base_sha256':base_manifest['weights_sha256'],'head_sha256':manifest['files']['converted']['sha256'],'source_commit':manifest['commit'],'old_visual_version':visual_version,'center_score_range':[float(center.min()),float(center.max())],'center_score_median':float(np.median(center)),'technical_vs_center_rank_correlation':float(np.corrcoef(order(tech),order(center))[0,1]),'center_vs_multicrop_rank_correlation':float(np.corrcoef(order(center),order(multi))[0,1]),'top10_overlap_per_activity':overlaps,'median_thumb_display_score_delta':float(np.median(thumb_delta)),'max_crop_score_span':max(r['crop_span'] for r in records),'runtime_seconds':round(time.monotonic()-started,2),'device':'CPU, two threads','network_disabled_during_inference':True,'production_db_open_mode':'ro','production_writes':0,'nas_requests':0,'calibrated_for_owner':False,'preferences_collected':0,'warning':'Purposive subset; rankings within 32-photo samples, not neural Top10 of entire activities. No user preference quality claim.'}
 dataset_id=hashlib.sha256(json.dumps([g['photos'] for g in groups]).encode()+summary['head_sha256'].encode()).hexdigest()[:24]
 data={'dataset_id':dataset_id,'summary':summary,'groups':groups,'photos':records,'pairs':pairs}
 summary['max_center_view_pipeline_delta']=max(center_view_delta)
 (out/'result.json').write_text(json.dumps(data,ensure_ascii=False));(out/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2));np.savez_compressed(out/'private-embeddings.npz',ids=np.array([p['id'] for p in records]),embeddings=np.stack(embeddings))
 public=Path(__file__).parent
 html=(public/'review.html').read_text().replace('/*TRIAL_CSS*/',(public/'review.css').read_text()).replace('/*TRIAL_JS*/',(public/'review.js').read_text()).replace('/*TRIAL_DATA*/',json.dumps(data,ensure_ascii=False).replace('<',chr(92)+'u003c'))
 (out/'review.html').write_text(html);print(json.dumps(summary,ensure_ascii=False),flush=True)

if __name__=='__main__':main()
