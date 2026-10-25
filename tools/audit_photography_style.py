"""Aggregate persisted current-version styles and probe 8 uncertain + 8 positive local thumbnails.

Output stays private; no NAS/LLM access or database writes.
"""
import argparse,json,sqlite3,socket,collections,random,os
from contextlib import contextmanager
from pathlib import Path
parser=argparse.ArgumentParser(description='Read-only, offline style coverage and cached-preview gate audit; never retags photos.')
parser.add_argument('--database',type=Path,default=Path('data/server/catalog.sqlite'))
parser.add_argument('--models',type=Path,default=Path('data/models'))
parser.add_argument('--output',type=Path,required=True)
args=parser.parse_args()
repo=Path(__file__).resolve().parents[1];output=args.output.resolve()
if not output.is_relative_to(repo/'data'):parser.error('Private output must be inside repository data/')
output.mkdir(parents=True,exist_ok=True);os.chmod(output,0o700)
attempts=[]
def deny(*a,**k):attempts.append(1);raise RuntimeError('Network disabled')
socket.socket.connect=deny;socket.create_connection=deny
from photo_museum.photography import LocalPhotography
c=sqlite3.connect(args.database.resolve().as_uri()+'?mode=ro',uri=True);c.row_factory=sqlite3.Row;c.execute('PRAGMA query_only=ON')
from photo_museum.exhibitions import ExhibitionCatalog
class ReadOnly:
 @contextmanager
 def connect(self):yield c
ids={p['id'] for p in ExhibitionCatalog(ReadOnly()).photos()}
expected=c.execute("SELECT value FROM settings WHERE key='photography_version'").fetchone()[0]
rows=[dict(r) for r in c.execute("""SELECT a.asset_id,a.data_json,f.path FROM analysis a JOIN entries e ON e.id=a.asset_id AND e.revision=a.revision
JOIN media_info m ON m.asset_id=e.id AND m.revision=e.revision JOIN media_jobs q ON q.asset_id=e.id AND q.revision=e.revision
JOIN cache_files f ON f.asset_id=e.id AND f.revision=e.revision AND f.profile='thumb'
WHERE a.provider='photography' AND a.version=(SELECT value FROM settings WHERE key='photography_version') AND q.status='ready'
AND json_extract(a.data_json,'$.input_media_version') IS json_extract(m.data_json,'$.version')
AND json_extract(a.data_json,'$.input_preview_updated') IS m.updated""") if r['asset_id'] in ids];c.close()
counts=collections.Counter();labels=collections.Counter();groups=collections.defaultdict(list)
for r in rows:
 d=json.loads(r['data_json']);state='error' if d.get('error') else d.get('style',{}).get('status','no_result');counts[state]+=1;groups[state].append(r)
 labels.update(x['label'] for x in d.get('style',{}).get('labels',[]))
model=LocalPhotography(args.models)
if model.version!=expected:raise RuntimeError('Local model/taxonomy version differs from the current catalog; do not compare scores')
rng=random.Random(42);selected=[]
for state in ['uncertain','candidates']:
 group=sorted(groups[state],key=lambda r:r['asset_id']);selected.extend(rng.sample(group,min(8,len(group))))
from PIL import Image
failures=collections.Counter();checked=collections.Counter();details=[]
for r in selected:
 old=json.loads(r['data_json']);state=old['style']['status']
 cache=(args.database.resolve().parent/'cache').resolve();image_path=(cache/r['path']).resolve()
 if not image_path.is_relative_to(cache):raise RuntimeError('Preview must stay inside local cache')
 with Image.open(image_path) as source:image=source.convert('RGB')
 try:
  with model.torch.inference_mode():
   features=model.model.encode_image(model.preprocess(image).unsqueeze(0),normalize=True)
   scores=dict(zip(model.ids,(features@model.text_features.T)[0].tolist()))
 finally:image.close()
 spec=model.catalog['style'];neutral=max(scores[k] for k in spec['neutral']);top=max(spec['labels'],key=lambda item:scores[item['id']]);score=scores[top['id']];margin=score-neutral;checked[state]+=1
 if state=='uncertain':failures['absolute_threshold' if score<spec['minimum_similarity'] else 'neutral_margin' if margin<spec['minimum_margin'] else 'unexpected_pass']+=1
 details.append({'asset_id':r['asset_id'],'old_status':state,'top_style':top['id'],'similarity':score,'neutral_similarity':neutral,'margin':margin})
result={'eligible_snapshot':len(ids),'current_photography_records':len(rows),'style_status_counts':dict(counts),'style_label_counts':dict(labels),'sample_counts':dict(checked),'uncertain_sample_gate_failures':dict(failures),'network_attempts':len(attempts),'model_version_verified':True,'boundary':'Current-version persisted results plus 16 deterministic stratified local-thumbnail score probes. No human style ground truth, no threshold changes or model/NAS downloads.'}
(output/'style-audit-private.json').write_text(json.dumps(details,ensure_ascii=False,indent=2));(output/'style-summary.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));print(json.dumps(result,ensure_ascii=False))

for p in output.glob('style-*.json'):os.chmod(p,0o600)
