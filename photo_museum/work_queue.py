"""One directory at a time, descending source-relative path, including analysis."""
import json
import os

def directory_focus(c):
    enabled=os.environ.get('MUSEUM_ANALYSIS_ENABLED')=='1'
    row=c.execute("SELECT value FROM settings WHERE key='analysis_version'").fetchone()
    version=row['value'] if row else ''
    unfinished="(q.status IN ('pending','running')"
    params=[]
    if enabled:
        unfinished+=" OR (q.status='ready' AND NOT EXISTS(SELECT 1 FROM analysis a WHERE a.asset_id=e.id AND a.revision=e.revision AND a.provider='visual' AND (?='' OR a.version=?) AND json_extract(a.data_json,'$.input_media_version') IS json_extract(m.data_json,'$.version')))"
        params=[version,version]
    unfinished+=')'
    query="""SELECT e.source_id,e.parent FROM entries e JOIN media_jobs q ON q.asset_id=e.id AND q.revision=e.revision
      JOIN jobs j ON j.id=e.seen_job LEFT JOIN media_info m ON m.asset_id=e.id AND m.revision=e.revision
      WHERE e.missing=0 AND e.scope_excluded=0 AND e.is_dir=0 AND j.status NOT IN ('paused','cancelled','blocked') AND """+unfinished
    saved=c.execute("SELECT value FROM settings WHERE key='media_directory'").fetchone()
    focus=json.loads(saved['value']) if saved else None
    if focus and c.execute(query+' AND e.source_id=? AND e.parent=? LIMIT 1',[*params,focus['source_id'],focus['parent']]).fetchone():
        return focus
    row=c.execute(query+' ORDER BY e.parent DESC,e.source_id LIMIT 1',params).fetchone()
    focus=dict(row) if row else None
    c.execute("INSERT OR REPLACE INTO settings VALUES('media_directory',?)",(json.dumps(focus),))
    return focus
