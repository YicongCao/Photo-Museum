"""Dry-run / targeted retry of previously diagnosed failures, with a private receipt."""
import argparse
import json
import time
from pathlib import Path
from photo_museum.db import Database

ERRORS = {'media_ValueError','media_OSError','unsupported_sdr_nclx'}


def candidates(c,diagnostics):
    expected={r['id']:r for r in diagnostics if r.get('recorded_error') in ERRORS}
    rows=c.execute("""SELECT e.id,e.revision,e.path,e.size,q.status,q.error FROM entries e
        JOIN media_jobs q ON q.asset_id=e.id AND q.revision=e.revision
        WHERE e.missing=0 AND e.scope_excluded=0 AND q.status IN ('failed','unsupported')""")
    return [dict(r) for r in rows if r['id'] in expected and expected[r['id']]['recorded_error']==r['error']
            and expected[r['id']]['path']==r['path'] and expected[r['id']]['bytes']==r['size']]


def apply(db, receipt, diagnostics, write=False):
    with db.connect() as c:
        if write:c.execute('BEGIN IMMEDIATE')
        rows=candidates(c,diagnostics)
        report={'applied':write,'created':time.time(),'policy':'bounded-compat-v1','items':rows}
        if write:
            # Write audit receipt before any mutation; rollback on file failure.
            receipt.parent.mkdir(parents=True,exist_ok=True)
            receipt.write_text(json.dumps(report,ensure_ascii=False,indent=2));receipt.chmod(0o600)
            for r in rows:
                c.execute("UPDATE media_jobs SET status='pending',attempts=0,available=0,error=NULL,updated=? WHERE asset_id=? AND revision=? AND status=? AND error=?",
                          (time.time(),r['id'],r['revision'],r['status'],r['error']))
        return report


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data',default='data/server');parser.add_argument('--apply',action='store_true')
    parser.add_argument('--diagnostics',type=Path,default=Path('data/failed-media-diagnosis/evidence.json'))
    parser.add_argument('--receipt',type=Path,default=Path('data/aesthetic-rollout/media-retry-receipt.json'))
    args=parser.parse_args()
    root=Path(__file__).resolve().parents[1]/'data'
    if not args.receipt.resolve().is_relative_to(root):raise ValueError('Private receipt must stay inside ignored data/')
    if args.apply and args.receipt.exists():raise ValueError('Choose a new receipt; do not overwrite prior evidence')
    report=apply(Database(args.data),args.receipt,json.loads(args.diagnostics.read_text()),args.apply)
    print(json.dumps({'applied':report['applied'],'count':len(report['items']),'policy':report['policy']}))


if __name__=='__main__':main()
