"""Install pinned aesthetic head explicitly; inference never downloads weights."""
import argparse
import hashlib
import json
import shutil
import tempfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--models', default=str(ROOT/'data/models'))
    parser.add_argument('--from-trial', type=Path, help='Existing trial models directory; no network')
    args = parser.parse_args()
    from photo_museum.aesthetics import HEAD_SHA, BASE_SHA
    import torch
    from safetensors.torch import save_file
    models = Path(args.models)
    with (models/'photography/clip.safetensors').open('rb') as stream:
        if hashlib.file_digest(stream, 'sha256').hexdigest() != BASE_SHA:
            raise ValueError('Base model checksum mismatch; run prepare_photography first')
    manifest = json.loads((ROOT/'docs/research/aesthetic-model-manifest.json').read_text())
    models.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='aesthetics-install-', dir=models) as temporary:
        work = Path(temporary)
        for name, record in manifest['files'].items():
            if name == 'converted':
                continue
            if args.from_trial:
                blob = (args.from_trial/name).read_bytes()
            else:
                with urllib.request.urlopen(record['url'], timeout=60) as response:
                    blob = response.read()
            if hashlib.sha256(blob).hexdigest() != record['sha256']:
                raise ValueError('Public model/license checksum mismatch')
            (work/name).write_bytes(blob)
        state = torch.load(work/'sa_0_4_vit_b_32_linear.pth', map_location='cpu', weights_only=True)
        if (set(state) != {'weight', 'bias'} or state['weight'].shape != (1, 512)
            or state['bias'].shape != (1,) or not all(torch.isfinite(v).all() for v in state.values())):
            raise ValueError('Invalid predictor tensors')
        save_file(state, str(work/'head.safetensors'))
        if hashlib.sha256((work/'head.safetensors').read_bytes()).hexdigest() != HEAD_SHA:
            raise ValueError('Converted head checksum mismatch')
        (work/'manifest.json').write_text(json.dumps(manifest, indent=2))
        target = models/'aesthetics'
        target.mkdir(exist_ok=True)
        for name in ('head.safetensors', 'LICENSE', 'README.md', 'manifest.json'):
            shutil.copyfile(work/name, target/(name+'.install'))
            (target/(name+'.install')).replace(target/name)
    print('Aesthetic weights and license verified and installed; existing scores untouched')


if __name__ == '__main__':
    main()
