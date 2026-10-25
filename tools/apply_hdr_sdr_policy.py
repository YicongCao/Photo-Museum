"""Queue only old HDR still previews. Workers must be stopped for --apply.
Never downloads NAS files, deletes photos, or alters manual metadata/curation.
"""
import argparse
from collections import Counter
import fcntl
import json
from pathlib import Path
import time
from photo_museum.cache import Cache
from photo_museum.db import Database
from photo_museum.media import HDR_VERSION


def apply_policy(db, apply=False):
    with (Cache(db).root / '.lock').open('a+b') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        with db.connect() as c:
            c.execute('BEGIN IMMEDIATE')
            if apply and c.execute("SELECT 1 FROM media_jobs WHERE status='running' AND lease_until>? LIMIT 1", (time.time(),)).fetchone():
                raise RuntimeError('Stop workers and wait for leases to expire')
            rows=c.execute("""SELECT e.id asset_id,e.revision,q.status,m.data_json FROM entries e
                JOIN media_jobs q ON q.asset_id=e.id AND q.revision=e.revision
                LEFT JOIN media_info m ON m.asset_id=e.id AND m.revision=e.revision
                WHERE e.kind='image_candidate' AND e.missing=0 AND e.scope_excluded=0
                AND ((q.status='ready' AND json_extract(m.data_json,'$.hdr_source')=1
                      AND coalesce(json_extract(m.data_json,'$.version'),'')!=?)
                  OR (q.status IN ('failed','unsupported') AND q.error IN
                      ('gainmap_requires_sdr_base_validation','hdr_metadata_requires_sdr_base_or_tonemap_validation',
                       'pq_or_hlg_transfer','pq_or_hlg_profile')))
                ORDER BY e.parent DESC,e.path DESC""", (HDR_VERSION,)).fetchall()
            cohort=[{'asset_id':r['asset_id'],'revision':r['revision'],
                     'previous_color':json.loads(r['data_json'] or '{}').get('color'),
                     'previous_status':r['status']} for r in rows]
            report={'apply':apply,'target_version':HDR_VERSION,'queued':len(rows),
                    'previous_colors':dict(Counter(r['previous_color'] or 'unconverted' for r in cohort)),
                    'cohort':cohort}
            if apply:
                for r in rows:
                    c.execute("UPDATE media_jobs SET status='pending',attempts=0,available=0,error=NULL,token=NULL,lease_until=NULL,updated=? WHERE asset_id=? AND revision=?", (time.time(),r['asset_id'],r['revision']))
                    # Keep historical completion events; pending jobs and the new per-asset version
                    # prevent them from counting as a fresh completion. Preserve all human edits.
                if rows:c.execute("DELETE FROM settings WHERE key='media_directory'")
            return report


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--data',default='data/server');p.add_argument('--apply',action='store_true');p.add_argument('--receipt')
    a=p.parse_args();report=apply_policy(Database(a.data),a.apply)
    if a.receipt:
        path=Path(a.receipt);path.write_text(json.dumps(report,indent=2));path.chmod(0o600)
    print(json.dumps({k:v for k,v in report.items() if k!='cohort'},indent=2))
