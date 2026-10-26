"""One directory at a time, descending source-relative path, including analysis."""
import json
import os
import sqlite3

def directory_focus(c, *, persist=True):
    enabled=os.environ.get('MUSEUM_ANALYSIS_ENABLED')=='1'
    row=c.execute("SELECT value FROM settings WHERE key='analysis_version'").fetchone()
    version=row['value'] if row else ''
    unfinished="(q.status IN ('pending','running')"
    params=[]
    if enabled:
        unfinished+=" OR (q.status='ready' AND NOT EXISTS(SELECT 1 FROM analysis a WHERE a.asset_id=e.id AND a.revision=e.revision AND a.provider='visual' AND (?='' OR a.version=?) AND json_extract(a.data_json,'$.input_media_version') IS json_extract(m.data_json,'$.version')))"
        params=[version,version]
    from . import photography,aesthetics
    for provider in (photography,aesthetics):
      if provider.enabled():
          row=c.execute("SELECT value FROM settings WHERE key=?",(provider.__name__.rsplit('.',1)[-1]+'_version',)).fetchone()
          photo_version=row[0] if row else ''
          unfinished+=" OR (q.status='ready' AND coalesce(json_extract(m.data_json,'$.metadata_only'),0)=0 AND NOT EXISTS(SELECT 1 FROM analysis a WHERE a.asset_id=e.id AND a.revision=e.revision AND a.provider=? AND a.version=? AND json_extract(a.data_json,'$.input_media_version') IS json_extract(m.data_json,'$.version') AND json_extract(a.data_json,'$.input_preview_updated') IS m.updated))"
          params.extend([provider.__name__.rsplit('.',1)[-1],photo_version])
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
    if persist and (saved is None or saved['value'] != json.dumps(focus)):
        c.execute("INSERT OR REPLACE INTO settings VALUES('media_directory',?)",(json.dumps(focus),))
    return focus


def choose_directory(database):
    """Read the expensive projection outside the short compare-and-set write."""
    for _ in range(3):
        with database.connect() as c:
            c.execute('BEGIN')
            saved = c.execute("SELECT value FROM settings WHERE key='media_directory'").fetchone()
            expected = saved['value'] if saved else None
            focus = directory_focus(c, persist=False)
        value = json.dumps(focus)
        if expected == value:
            return focus
        with database.connect() as c:
            c.execute('BEGIN IMMEDIATE')
            current = c.execute("SELECT value FROM settings WHERE key='media_directory'").fetchone()
            if (current['value'] if current else None) != expected:
                continue
            c.execute("INSERT OR REPLACE INTO settings VALUES('media_directory',?)", (value,))
            return focus
    # Another lane moved the focus; retry from a fresh snapshot next tick.
    raise sqlite3.OperationalError('database is busy')
