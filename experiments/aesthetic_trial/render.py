"""Re-render the private trial page without rerunning models or reading production."""
import argparse,json
from pathlib import Path
from run import ROOT,average_ranks

def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',default='data/aesthetic-trial-2026-10-26');args=parser.parse_args();out=(ROOT/args.output).resolve()
 if not out.is_relative_to(ROOT/'data'):raise ValueError('Private results must stay inside data/')
 data=json.loads((out/'result.json').read_text());s=data['summary']
 import numpy as np
 for a,b,key in [('technical','center','technical_vs_center_rank_correlation'),('center','multi','center_vs_multicrop_rank_correlation')]:
  s[key]=float(np.corrcoef(average_ranks([p[a] for p in data['photos']]),average_ranks([p[b] for p in data['photos']]))[0,1])
 template=Path(__file__).parent;html=(template/'review.html').read_text().replace('/*TRIAL_CSS*/',(template/'review.css').read_text()).replace('/*TRIAL_JS*/',(template/'review.js').read_text()).replace('/*TRIAL_DATA*/',json.dumps(data,ensure_ascii=False).replace('<',chr(92)+'u003c'))
 (out/'review.html').write_text(html);(out/'result.json').write_text(json.dumps(data,ensure_ascii=False));(out/'summary.json').write_text(json.dumps(s,ensure_ascii=False,indent=2));print('Private page re-rendered; tied ranks averaged; production untouched')

if __name__=='__main__':main()
