"""Explicit, checksum-pinned public model download. Runtime inference stays offline."""
import argparse
import hashlib
import json
from pathlib import Path
import urllib.request

ROOT=Path(__file__).resolve().parents[1]


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--models',default=str(ROOT/'data/models'))
    args=parser.parse_args()
    dest=Path(args.models)/'photography';dest.mkdir(parents=True,exist_ok=True)
    records=json.loads((ROOT/'docs/research/photography-model-manifest.json').read_text())
    manifest=dest/'manifest.json'
    if manifest.is_file():
        record=json.loads(manifest.read_text())
        converted=dest/'clip.safetensors'
        if record.get('source')==records and converted.is_file():
            with converted.open('rb') as stream:digest=hashlib.file_digest(stream,'sha256').hexdigest()
            if digest==record['weights_sha256']:
                print('photography weights verified',converted.stat().st_size);return
    for name,info in records.items():
        file=dest/name
        if not file.exists():
            temp=dest/(name+'.download')
            with urllib.request.urlopen(info['url'],timeout=60) as source,temp.open('wb') as out:
                while block:=source.read(1024**2):out.write(block)
            with temp.open('rb') as stream:digest=hashlib.file_digest(stream,'sha256').hexdigest()
            if digest!=info['sha256']:
                temp.unlink();raise ValueError('photography_model_checksum_mismatch')
            temp.replace(file)
        with file.open('rb') as stream:digest=hashlib.file_digest(stream,'sha256').hexdigest()
        if digest!=info['sha256']:raise ValueError('photography_model_checksum_mismatch')
        print(name,file.stat().st_size,flush=True)
    # Execute only the checksum-verified official archive during explicit preparation.
    # Runtime loads plain tensors, not a TorchScript program or arbitrary pickle.
    import torch
    from safetensors.torch import save_file
    model=torch.jit.load(str(dest/'clip.pt'),map_location='cpu').eval()
    state={k:v.detach().contiguous() for k,v in model.state_dict().items()
           if k not in ('input_resolution','context_length','vocab_size')}
    temp=dest/'clip.safetensors.download';save_file(state,str(temp));temp.replace(dest/'clip.safetensors')
    with (dest/'clip.safetensors').open('rb') as stream:digest=hashlib.file_digest(stream,'sha256').hexdigest()
    record={'source':records,'weights_sha256':digest,'architecture':'ViT-B-32-quickgelu'}
    temp=dest/'manifest.json.download';temp.write_text(json.dumps(record,indent=2));temp.replace(manifest)
    (dest/'clip.pt').unlink()
    print('converted verified tensors',flush=True)


if __name__=='__main__':main()
