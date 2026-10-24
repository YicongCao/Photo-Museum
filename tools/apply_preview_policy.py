"""Opt-in local migration: remove generated full-size derivatives and retry specific failures.
Run with workers stopped. Defaults to a dry run. Never contacts the source NAS.
"""
import argparse
import fcntl
import json
from pathlib import Path
import time
import shutil
from photo_museum.db import Database
from photo_museum.cache import Cache

ERRORS=('pq_or_hlg_transfer','unknown_color_profile','source_exceeds_2gib_limit','media_DecompressionBombError')


def apply_policy(db, apply=False):
    cache=Cache(db)
    with open(cache.root/'.lock','a+b') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        with db.connect() as c:
            c.execute('BEGIN IMMEDIATE')
            # Fail closed if a live worker has a lease; rerun after the supervisor stops.
            if apply and c.execute("SELECT 1 FROM media_jobs WHERE status='running' AND lease_until>? LIMIT 1",(time.time(),)).fetchone():
                raise RuntimeError('Wait for expired leases after stopping the workers')
            rows=c.execute("SELECT * FROM cache_files WHERE profile IN ('compatible','playback')").fetchall()
            paths={cache.root/r['path'] for r in rows}
            # Old interrupted publication may leave unregistered generated derivatives.
            for pattern in ('*/compatible.jpg','*/playback.mp4'):paths.update(cache.root.glob(pattern))
            paths={p for p in paths if p.resolve().is_relative_to(cache.root.resolve()) and p.is_file()}
            marks=','.join('?' for _ in ERRORS)
            retry=c.execute(f"SELECT q.asset_id,q.revision,q.error FROM media_jobs q JOIN entries e ON e.id=q.asset_id AND e.revision=q.revision WHERE e.missing=0 AND e.scope_excluded=0 AND q.status IN ('failed','unsupported') AND q.error IN ({marks})",ERRORS).fetchall()
            retry=list(retry)
            existing=c.execute("SELECT q.asset_id,q.revision,'oversized_existing' error FROM media_jobs q JOIN entries e ON e.id=q.asset_id AND e.revision=q.revision LEFT JOIN media_info m ON m.asset_id=e.id AND m.revision=e.revision WHERE e.missing=0 AND e.scope_excluded=0 AND q.status IN ('indexed','ready') AND json_extract(m.data_json,'$.placeholder') IS NULL AND ((e.kind='video_candidate' AND e.size>2147483648) OR (e.kind='image_candidate' AND e.size>268435456))").fetchall()
            retry.extend(existing)
            counts={error:sum(r['error']==error for r in retry) for error in (*ERRORS,'oversized_existing')}
            report={'apply':apply,'removed_files':len(paths),'removed_bytes':sum(p.stat().st_size for p in paths),'retry':counts,'cohort':[dict(r) for r in retry]}
            assumptions=c.execute("SELECT asset_id,revision,data_json FROM media_info WHERE json_extract(data_json,'$.color')='untagged_assumed_srgb'").fetchall()
            report['existing_assumptions']=len(assumptions)
            if not apply:return report
            for path in paths:path.unlink(missing_ok=True)
            shutil.rmtree(cache.root/'work',ignore_errors=True)
            c.execute("DELETE FROM cache_files WHERE profile IN ('compatible','playback')")
            c.execute("DELETE FROM derivatives WHERE profile IN ('compatible','playback')")
            for r in retry:
                c.execute("UPDATE media_jobs SET status='pending',available=0,attempts=0,error=NULL,token=NULL,lease_until=NULL WHERE asset_id=? AND revision=?",(r['asset_id'],r['revision']))
            for r in assumptions:
                info=json.loads(r['data_json']);info.update(assumed_color=True,score_penalty=15)
                c.execute('UPDATE media_info SET data_json=? WHERE asset_id=? AND revision=?',(json.dumps(info),r['asset_id'],r['revision']))
                scores=c.execute("SELECT provider,data_json FROM analysis WHERE asset_id=? AND revision=? AND provider='visual'",(r['asset_id'],r['revision'])).fetchall()
                for a in scores:
                    score=json.loads(a['data_json'])
                    if isinstance(score.get('score'),(int,float)):
                        raw=score.get('raw_score',score['score'])
                        score.update(raw_score=raw,score=max(0,raw-15),score_penalty=15,score_penalty_reason='assumed_srgb')
                        c.execute('UPDATE analysis SET data_json=? WHERE asset_id=? AND revision=? AND provider=?',(json.dumps(score),r['asset_id'],r['revision'],a['provider']))
            # Re-enter descending directory order, allowing newly eligible recent HDR photos first.
            if retry:c.execute("DELETE FROM settings WHERE key='media_directory'")
            return report

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--data',default='data/server');p.add_argument('--apply',action='store_true');p.add_argument('--receipt');a=p.parse_args()
    report=apply_policy(Database(a.data),a.apply)
    if a.receipt:
        path=Path(a.receipt);path.write_text(json.dumps(report,indent=2));path.chmod(0o600)
    print(json.dumps({k:v for k,v in report.items() if k!='cohort'},indent=2))
