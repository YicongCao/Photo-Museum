"""Offline neural aesthetics, independent of technical quality and identity analysis."""
import hashlib
import json
import math
import os
from pathlib import Path

BASE_SHA = '431adb635d7a35aaaf5b70acf8738712c6f9ae30d08e17698c6f505c9a686fb8'
HEAD_SHA = '61f78d14fb6c4a9cdfcc7183bd374dcfa43002f82b68f5d0cf8ddf2ec5ad6a06'
METHOD = 'clip-vit-b32-laion-v1-display-center-v1'


def enabled():
    return os.environ.get('MUSEUM_AESTHETICS_ENABLED') == '1'


def pipeline_suffix(c):
    if not enabled():
        return ''
    row = c.execute("SELECT value FROM settings WHERE key='aesthetics_version'").fetchone()
    return '|' + (row[0] if row else 'aesthetics-loading')


def current(c, aid, revision):
    row = c.execute("""SELECT a.version,a.data_json FROM analysis a
        JOIN entries e ON e.id=a.asset_id AND e.revision=a.revision
        JOIN media_info m ON m.asset_id=e.id AND m.revision=e.revision
        JOIN media_jobs q ON q.asset_id=e.id AND q.revision=e.revision
        WHERE a.asset_id=? AND a.revision=? AND a.provider='aesthetics'
        AND a.version=(SELECT value FROM settings WHERE key='aesthetics_version')
        AND e.missing=0 AND e.scope_excluded=0 AND q.status='ready'
        AND json_extract(a.data_json,'$.input_media_version') IS json_extract(m.data_json,'$.version')
        AND json_extract(a.data_json,'$.input_preview_updated') IS m.updated""", (aid, revision)).fetchone()
    return {'version': row['version'], 'data': json.loads(row['data_json'])} if row else None


def score_value(data):
    value = data.get('score') if data and not data.get('error') else None
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) else None


def scores(c):
    """Bulk current values for local exhibition projections; no per-photo SQL loop."""
    return {r['asset_id']: score_value(json.loads(r['data_json'])) for r in c.execute("""
        SELECT a.asset_id,a.data_json FROM analysis a
        JOIN entries e ON e.id=a.asset_id AND e.revision=a.revision
        JOIN media_info m ON m.asset_id=e.id AND m.revision=e.revision
        JOIN media_jobs q ON q.asset_id=e.id AND q.revision=e.revision
        WHERE a.provider='aesthetics' AND a.version=(SELECT value FROM settings WHERE key='aesthetics_version')
        AND e.missing=0 AND e.scope_excluded=0 AND q.status='ready'
        AND json_extract(a.data_json,'$.input_media_version') IS json_extract(m.data_json,'$.version')
        AND json_extract(a.data_json,'$.input_preview_updated') IS m.updated""")}


class LocalAesthetics:
    id = 'aesthetics'

    def __init__(self, models):
        import torch
        import open_clip
        from safetensors.torch import load_file
        root = Path(models)
        base, head = root/'photography/clip.safetensors', root/'aesthetics/head.safetensors'
        for path, expected in ((base, BASE_SHA), (head, HEAD_SHA)):
            with path.open('rb') as stream:
                if hashlib.file_digest(stream, 'sha256').hexdigest() != expected:
                    raise ValueError('aesthetics_model_checksum_mismatch')
        identity = [METHOD, BASE_SHA, HEAD_SHA, open_clip.__version__]
        self.version = 'aesthetics-v1-' + hashlib.sha256(json.dumps(identity).encode()).hexdigest()[:16]
        self.torch = torch
        torch.set_num_threads(2)
        self.model, _, self.preprocess = open_clip.create_model_and_transforms(
            'ViT-B-32-quickgelu', pretrained=str(base), device='cpu')
        self.model.eval()
        self.head = torch.nn.Linear(512, 1)
        self.head.load_state_dict(load_file(str(head)))
        self.head.eval()

    def analyze(self, path, progress=lambda *args: None):
        from PIL import Image, ImageOps
        progress('aesthetic', 'running')
        with Image.open(path) as source:
            image = ImageOps.exif_transpose(source).convert('RGB')
        try:
            with self.torch.inference_mode():
                features = self.model.encode_image(self.preprocess(image).unsqueeze(0), normalize=True)
                value = float(self.head(features).item())
            if not math.isfinite(value):
                raise ValueError('nonfinite_aesthetic_score')
        finally:
            image.close()
        progress('aesthetic', 'done')
        # Raw estimate retained: not clipped, not multiplied into a percentage, no technical penalty.
        return {'score': value, 'method': METHOD, 'score_kind': 'aesthetic_prediction',
                'nominal_scale': 10, 'calibrated_for_owner': False, 'offline': True,
                'input_profile': 'display', 'preprocess': 'clip-standard-center-crop'}
