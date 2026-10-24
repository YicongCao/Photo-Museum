"""Explicit inbound downloads only. Runtime providers never download or upload."""
import hashlib
import json
from pathlib import Path
import urllib.request
ROOT=Path(__file__).resolve().parents[1]
DEST=ROOT/'data/models'
MODELS={
 'yunet.onnx':('https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx','MIT'),
 'sface.onnx':('https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx','Apache-2.0'),
 'mobilenet.safetensors':('https://huggingface.co/timm/mobilenetv3_small_100.lamb_in1k/resolve/main/model.safetensors','Apache-2.0'),
}
def main():
 DEST.mkdir(parents=True,exist_ok=True)
 records=json.loads((ROOT/'docs/research/model-manifest.json').read_text())
 for name,info in records.items():
  file=DEST/name
  if not file.exists():
   temp=file.with_suffix('.download')
   urllib.request.urlretrieve(info['url'],temp)
   if hashlib.sha256(temp.read_bytes()).hexdigest()!=info['sha256']:
    temp.unlink()
    raise ValueError('Downloaded model differs from reviewed manifest: '+name)
   temp.replace(file)
  if hashlib.sha256(file.read_bytes()).hexdigest()!=info['sha256']:
   raise ValueError('Local model checksum mismatch: '+name)
  print(name,file.stat().st_size,flush=True)
 (DEST/'manifest.json').write_text(json.dumps(records,indent=2))
if __name__=='__main__':main()
