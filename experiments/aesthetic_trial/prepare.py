"""Explicit public-weight download for the pilot only; never called by inference."""
import argparse,hashlib,json,urllib.request
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
COMMIT='6d122adad522ab246644d9dc1c6d7a3810ee255f'
FILES={
 'sa_0_4_vit_b_32_linear.pth':'c7b14cead230694acc7b9447974d3cad78003c72da032e402a303b6c2429e85f',
 'LICENSE':'3c8693d95e6ae2e39f37083b1242dfefde5639f754ff8a0a6d4d51038247a00a',
 'README.md':'c146fa39e3ef99e52f7d2c5bec99e92c553daa51be58e097a61e90945807e824'}

def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',default='data/aesthetic-trial-2026-10-26');args=parser.parse_args()
 root=(ROOT/args.output).resolve()
 if not root.is_relative_to(ROOT/'data'):raise ValueError('Trial weights must stay in ignored data/')
 root=root/'models';root.mkdir(parents=True,exist_ok=True);records={}
 for name,expected in FILES.items():
  url=f'https://raw.githubusercontent.com/LAION-AI/aesthetic-predictor/{COMMIT}/{name}'
  with urllib.request.urlopen(url,timeout=30) as response:blob=response.read()
  actual=hashlib.sha256(blob).hexdigest()
  if actual!=expected:raise ValueError('Upstream model/license checksum changed')
  (root/name).write_bytes(blob);records[name]={'url':url,'sha256':actual,'bytes':len(blob)}
 import torch
 from safetensors.torch import save_file
 state=torch.load(root/'sa_0_4_vit_b_32_linear.pth',map_location='cpu',weights_only=True)
 if set(state)!={'weight','bias'} or state['weight'].shape!=(1,512) or state['bias'].shape!=(1,):raise ValueError('Unexpected model tensors')
 if not all(torch.isfinite(v).all() for v in state.values()):raise ValueError('Non-finite tensors')
 save_file(state,str(root/'head.safetensors'));records['converted']={'sha256':hashlib.sha256((root/'head.safetensors').read_bytes()).hexdigest(),'format':'safetensors','keys':{k:list(v.shape) for k,v in state.items()}}
 (root/'manifest.json').write_text(json.dumps({'repository':'https://github.com/LAION-AI/aesthetic-predictor','commit':COMMIT,'license':'MIT repository license; no separate weight license file at upstream root','files':records},indent=2))
 print('Pinned public weights and license verified; converted to safetensors')

if __name__=='__main__':main()
