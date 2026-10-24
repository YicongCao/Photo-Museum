#!/usr/bin/env python3
"""Resumable, source-read-only filename inventory; not an EXIF scraper.

Known media suffixes are counted as file candidates without stat to avoid WebDAV
mount N+1 requests. Unusual directories named *.jpg therefore need production
PROPFIND validation. Unknown entries are checked for directory/symlink status.
"""
from __future__ import annotations

import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import json
import os
from pathlib import Path, PurePosixPath
import re
import sqlite3
import time

IMAGES = {".jpg", ".jpeg", ".heic", ".heif", ".hif", ".png", ".webp", ".avif", ".tif", ".tiff", ".gif"}
VIDEOS = {".mov", ".mp4", ".m4v", ".avi", ".mkv", ".mts", ".m2ts", ".3gp", ".webm"}
RAW = {".arw", ".dng", ".cr2", ".cr3", ".nef", ".nrw", ".raf", ".rw2", ".orf", ".pef", ".srw", ".raw"}
SIDECARS = {".aae", ".xmp", ".json", ".xml", ".thm", ".srt", ".lrf"}
KNOWN = IMAGES | VIDEOS | RAW | SIDECARS


def now():
    return datetime.now(timezone.utc).isoformat()


def parse_event(name):
    match = re.fullmatch(r"(?P<year>(?:19|20)\d{2})-(?:(?P<month>0[1-9]|1[0-2])-)?(?P<theme>.+)", name)
    if not match:
        return {"year": None, "month": None, "theme": name, "precision": "unknown"}
    d = match.groupdict()
    return {"year": int(d["year"]), "month": int(d["month"]) if d["month"] else None,
            "theme": d["theme"], "precision": "month" if d["month"] else "year"}


def excluded_directory(name):
    if name.startswith(".") or name in {"__MACOSX", "@eaDir", "#recycle", "$RECYCLE.BIN"}:
        return "system"
    if re.match(r"^(原片|底片|未处理|raw|originals?|arw)(?:$|[ _+()（）、-])", name, re.I):
        return "originals_directory"
    return None


def classify(name):
    ext = PurePosixPath(name).suffix.lower()
    if name.startswith("."):
        return "ignored"
    if ext in RAW:
        return "raw"
    if ext in IMAGES:
        return "image_candidate"
    if ext in VIDEOS:
        return "video_candidate"
    if ext in SIDECARS:
        return "sidecar"
    return "other"


def connect(db_path):
    db_path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(db_path)
    db.row_factory = sqlite3.Row
    db.executescript("""
    PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY, root TEXT NOT NULL, started_at TEXT NOT NULL,
      finished_at TEXT, status TEXT NOT NULL, mode TEXT NOT NULL DEFAULT 'filename_inventory');
    CREATE TABLE IF NOT EXISTS directories (
      run_id INTEGER NOT NULL, path TEXT NOT NULL, state TEXT NOT NULL,
      reason TEXT, error TEXT, elapsed REAL, PRIMARY KEY(run_id,path));
    CREATE TABLE IF NOT EXISTS files (
      run_id INTEGER NOT NULL, path TEXT NOT NULL, parent TEXT NOT NULL,
      event TEXT NOT NULL, name TEXT NOT NULL, stem TEXT NOT NULL,
      extension TEXT NOT NULL, kind TEXT NOT NULL, PRIMARY KEY(run_id,path));
    CREATE INDEX IF NOT EXISTS files_kind ON files(run_id,kind);
    CREATE INDEX IF NOT EXISTS files_pair ON files(run_id,parent,stem);
    """)
    return db


def begin(db, root, resume=False):
    row = db.execute("SELECT id FROM runs WHERE root=? AND status IN ('running','partial') ORDER BY id DESC LIMIT 1", (str(root),)).fetchone() if resume else None
    if row:
        run_id = row["id"]
        with db:
            db.execute("UPDATE directories SET state='pending',error=NULL WHERE run_id=? AND state IN ('running','error')", (run_id,))
            db.execute("UPDATE runs SET status='running',finished_at=NULL WHERE id=?", (run_id,))
    else:
        with db:
            run_id = db.execute("INSERT INTO runs(root,started_at,status) VALUES(?,?,'running')", (str(root),now())).lastrowid
            db.execute("INSERT INTO directories(run_id,path,state) VALUES(?,'','pending')", (run_id,))
    return run_id


def list_directory(root, relative):
    start = time.monotonic()
    rows, directories = [], []
    # Do not fetch source contents or per-media attributes in this initial census.
    with os.scandir(root / relative) as entries:
        for entry in entries:
            name = entry.name
            path = str(PurePosixPath(relative) / name)
            ext = PurePosixPath(name).suffix.lower()
            reason = excluded_directory(name)
            if not relative and parse_event(name)['precision'] != 'unknown':
                reason = None  # An activity title may legitimately mention original negatives.
            if name.startswith(".") or name in {"__MACOSX", "@eaDir", "#recycle", "$RECYCLE.BIN"}:
                directories.append((path, "excluded", "system"))
                continue
            if ext not in KNOWN:
                if entry.is_symlink():
                    rows.append((path, relative, path.split('/')[0] if relative else '', name, PurePosixPath(name).stem.casefold(), ext, "symlink_ignored"))
                    continue
                if entry.is_dir(follow_symlinks=False):
                    directories.append((path, "excluded" if reason else "pending", reason))
                    continue
            event = path.split('/')[0] if relative else ''
            rows.append((path, relative, event, name, PurePosixPath(name).stem.casefold(), ext, classify(name)))
    return rows, directories, time.monotonic()-start


def save_directory(db, run_id, path, result=None, error=None):
    with db:
        if error is not None:
            db.execute("UPDATE directories SET state='error',error=? WHERE run_id=? AND path=?", (str(error),run_id,path))
            return
        rows, directories, elapsed = result
        db.execute("DELETE FROM files WHERE run_id=? AND parent=?", (run_id,path))
        db.executemany("INSERT INTO files VALUES(?,?,?,?,?,?,?,?)", [(run_id,*r) for r in rows])
        db.executemany("INSERT OR IGNORE INTO directories(run_id,path,state,reason) VALUES(?,?,?,?)", [(run_id,*d) for d in directories])
        db.execute("UPDATE directories SET state='done',error=NULL,elapsed=? WHERE run_id=? AND path=?", (elapsed,run_id,path))


def scan(db, run_id, root, workers=3, max_directories=None):
    processed = 0
    with ThreadPoolExecutor(max_workers=workers) as pool:
        while True:
            remaining = workers if max_directories is None else min(workers,max_directories-processed)
            if remaining <= 0:
                break
            pending = db.execute("SELECT path FROM directories WHERE run_id=? AND state='pending' ORDER BY path LIMIT ?", (run_id,remaining)).fetchall()
            if not pending:
                break
            paths = [r["path"] for r in pending]
            with db:
                db.executemany("UPDATE directories SET state='running' WHERE run_id=? AND path=?", [(run_id,p) for p in paths])
            futures = {pool.submit(list_directory,root,p):p for p in paths}
            for future in as_completed(futures):
                path = futures[future]
                try:
                    result = future.result()
                    save_directory(db,run_id,path,result=result)
                    print(json.dumps({"directory_complete":path,"files":len(result[0]),"seconds":round(result[2],2)},ensure_ascii=False),flush=True)
                except OSError as exc:
                    save_directory(db,run_id,path,error=exc)
                    print(json.dumps({"directory_error":path,"error":str(exc)},ensure_ascii=False),flush=True)
                processed += 1
    unfinished = db.execute("SELECT count(*) FROM directories WHERE run_id=? AND state IN ('pending','running','error')", (run_id,)).fetchone()[0]
    with db:
        db.execute("UPDATE runs SET status=?,finished_at=? WHERE id=?", ('partial' if unfinished else 'complete',now(),run_id))


def summary(db, run_id):
    run = dict(db.execute("SELECT * FROM runs WHERE id=?",(run_id,)).fetchone())
    kinds = dict(db.execute("SELECT kind,count(*) FROM files WHERE run_id=? GROUP BY kind",(run_id,)).fetchall())
    extensions = dict(db.execute("SELECT extension,count(*) FROM files WHERE run_id=? GROUP BY extension ORDER BY count(*) DESC",(run_id,)).fetchall())
    directory_states = dict(db.execute("SELECT state,count(*) FROM directories WHERE run_id=? GROUP BY state",(run_id,)).fetchall())
    event_rows = db.execute("SELECT event,kind,count(*) n FROM files WHERE run_id=? GROUP BY event,kind",(run_id,)).fetchall()
    events = {r['path']: {**parse_event(r['path']), 'counts': {}}
              for r in db.execute("SELECT path FROM directories WHERE run_id=? AND path<>'' AND instr(path,'/')=0 AND state<>'excluded'", (run_id,))}
    for row in event_rows:
        e=events.setdefault(row['event'], {**parse_event(row['event']),"counts":{}})
        e['counts'][row['kind']]=row['n']
    pairs = db.execute("""SELECT parent,stem,
      sum(kind='image_candidate') images,sum(extension='.mov' AND kind='video_candidate') movies
      FROM files WHERE run_id=? GROUP BY parent,stem
      HAVING images>0 AND movies>0""",(run_id,)).fetchall()
    unique_pairs = sum(r['images']==1 and r['movies']==1 for r in pairs)
    excluded = [dict(r) for r in db.execute("SELECT path,reason FROM directories WHERE run_id=? AND state='excluded' ORDER BY path",(run_id,))]
    errors = [dict(r) for r in db.execute("SELECT path,error FROM directories WHERE run_id=? AND state='error'",(run_id,))]
    return {"run":run,"classification_version":"filename_inventory_v2","counting_method":"filename_only_without_per_media_stat_or_content_validation",
            "limitations":["Excluded original/system directory contents are not enumerated.","Media-suffix entries are candidates, not yet confirmed regular files or finished exports.","Live Photo pairs are filename candidates, not validated content identifiers.","No file sizes, EXIF, hashes or deduplication are inferred.","Resume continues the persisted queue; new entries in completed directories require a new run. This is not an atomic snapshot."],
            "kinds":kinds,"extensions":extensions,"directory_states":directory_states,
            "event_count":len([k for k in events if k]),"events_with_entries":sum(bool(v['counts']) for k,v in events.items() if k),"events":events,
            "live_photo_filename_pairs":unique_pairs,"ambiguous_live_photo_groups":len(pairs)-unique_pairs,
            "video_candidates_without_unique_pair":kinds.get('video_candidate',0)-unique_pairs,
            "excluded_directories":excluded,"errors":errors}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root',type=Path,required=True)
    parser.add_argument('--db',type=Path,default=Path('data/inventory.sqlite3'))
    parser.add_argument('--output',type=Path,default=Path('data/research/inventory.json'))
    parser.add_argument('--resume',action='store_true')
    parser.add_argument('--workers',type=int,choices=range(1,9),default=3)
    parser.add_argument('--max-directories',type=int)
    args=parser.parse_args()
    root=args.root.resolve()
    for output in [args.db.resolve(),args.output.resolve()]:
        if output==root or root in output.parents:
            parser.error('Outputs must be outside the read-only photo source')
    db=connect(args.db)
    run_id=begin(db,root,args.resume)
    scan(db,run_id,root,args.workers,args.max_directories)
    report=summary(db,run_id)
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({k:report[k] for k in ['kinds','directory_states','event_count','live_photo_filename_pairs','ambiguous_live_photo_groups']},ensure_ascii=False))
    return 0 if report['run']['status']=='complete' else 2


if __name__=='__main__':
    raise SystemExit(main())
