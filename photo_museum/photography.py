"""Offline CLIP photography candidates; semantic similarity is not a probability."""
import hashlib
import json
import math
import os
from pathlib import Path

CATALOG=Path(__file__).with_name('photography-taxonomy.json')


def enabled():
    return os.environ.get('MUSEUM_PHOTOGRAPHY_ENABLED')=='1'


def pipeline_suffix(c):
    if not enabled():return ''
    row=c.execute("SELECT value FROM settings WHERE key='photography_version'").fetchone()
    return '|'+(row[0] if row else 'photography-loading')


def current(c,aid,revision):
    row=c.execute("""SELECT a.version,a.data_json FROM analysis a JOIN media_info m ON m.asset_id=a.asset_id AND m.revision=a.revision
        JOIN entries e ON e.id=m.asset_id AND e.revision=m.revision JOIN media_jobs q ON q.asset_id=e.id AND q.revision=e.revision
        WHERE a.asset_id=? AND a.revision=? AND a.provider='photography' AND e.missing=0 AND e.scope_excluded=0
        AND q.status='ready' AND a.version=(SELECT value FROM settings WHERE key='photography_version')
        AND json_extract(a.data_json,'$.input_media_version') IS json_extract(m.data_json,'$.version')
        AND json_extract(a.data_json,'$.input_preview_updated') IS m.updated""",(aid,revision)).fetchone()
    return {'version':row['version'],'data':json.loads(row['data_json'])} if row else None


def select_candidates(catalog, scores):
    """Independent groups may abstain; mutually exclusive styles share a group."""
    result={}
    for axis in ('style','topic'):
        spec=catalog[axis];neutral=max(float(scores[x]) for x in spec['neutral'])
        ranked=[]
        for item in spec['labels']:
            score=float(scores[item['id']]);margin=score-neutral
            if math.isfinite(score) and score>=spec['minimum_similarity'] and margin>=spec['minimum_margin']:
                ranked.append({'id':item['id'],'label':item['label'],'similarity':round(score,4),
                               'margin':round(margin,4),'candidate':True,'group':item.get('group',item['id'])})
        ranked.sort(key=lambda x:(-x['similarity'],x['id']))
        groups=set();selected=[]
        for item in ranked:
            if item['group'] in groups:continue
            groups.add(item['group']);selected.append(item)
            if len(selected)==spec['maximum_labels']:break
        result[axis]={'status':'candidates' if selected else 'uncertain','labels':selected}
    return result


class LocalPhotography:
    id='photography'
    def __init__(self,models):
        import torch,open_clip
        self.torch=torch;torch.set_num_threads(2)
        root=Path(models)/'photography'
        manifest=json.loads((root/'manifest.json').read_text())
        with (root/'clip.safetensors').open('rb') as stream:
            if hashlib.file_digest(stream,'sha256').hexdigest()!=manifest['weights_sha256']:
                raise ValueError('photography_model_checksum_mismatch')
        self.catalog=json.loads(CATALOG.read_text())
        identity={'source':manifest['source'],'weights':manifest['weights_sha256'],
                  'taxonomy':self.catalog,'algorithm':'clip-cosine-abstain-v1','runtime':open_clip.__version__}
        self.version='photography-v1-'+hashlib.sha256(json.dumps(identity,sort_keys=True).encode()).hexdigest()[:16]
        self.model,_,self.preprocess=open_clip.create_model_and_transforms(
            'ViT-B-32-quickgelu',pretrained=str(root/'clip.safetensors'),device='cpu')
        self.model.eval()
        tokenizer=open_clip.get_tokenizer('ViT-B-32-quickgelu')
        self.ids=[];features=[]
        # Each class uses prompt ensembling. Never call a pretrained download factory.
        with torch.inference_mode():
            for axis in ('style','topic'):
                for item in self.catalog[axis]['labels']+self.catalog[axis]['neutral_labels']:
                    embeddings=self.model.encode_text(tokenizer(item['prompts']),normalize=True)
                    feature=embeddings.mean(dim=0);feature/=feature.norm().clamp(min=1e-8)
                    self.ids.append(item['id']);features.append(feature)
            self.text_features=torch.stack(features)

    def analyze(self,path,progress=lambda *args:None):
        from PIL import Image
        progress('style','running');progress('topic','running')
        with Image.open(path) as source:
            image=source.convert('RGB')
        try:
            with self.torch.inference_mode():
                image_features=self.model.encode_image(self.preprocess(image).unsqueeze(0),normalize=True)
                values=(image_features@self.text_features.T)[0].tolist()
            result=select_candidates(self.catalog,dict(zip(self.ids,values)))
        finally:image.close()
        progress('style','done');progress('topic','done')
        return result|{'offline':True,'method':'zero-shot-clip','score_kind':'cosine_similarity',
                       'calibrated':False,'taxonomy':self.catalog['version']}
