"""Online SQLite backup + encryption key. Destination is private; restore never overwrites."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
from .db import Database

def backup(database,destination):
 target=Path(destination).resolve()
 target.mkdir(mode=0o700,parents=True,exist_ok=False)
 with database.connect() as source:
  dest=sqlite3.connect(target/'catalog.sqlite')
  try:
   source.backup(dest)
   dest.execute('DELETE FROM sessions')
   dest.commit()
   dest.execute('PRAGMA journal_mode=DELETE')
  finally:
   dest.close()
 shutil.copyfile(database.directory/'secrets.key',target/'secrets.key')
 manifest={}
 for name in ('catalog.sqlite','secrets.key'):
  p=target/name
  os.chmod(p,0o600)
  manifest[p.name]=hashlib.sha256(p.read_bytes()).hexdigest()
 (target/'manifest.json').write_text(json.dumps(manifest,indent=2))
 os.chmod(target/'manifest.json',0o600)
 return target

def restore(source,destination):
 source=Path(source).resolve();target=Path(destination).resolve()
 manifest=json.loads((source/'manifest.json').read_text())
 if set(manifest)!={'catalog.sqlite','secrets.key'}:raise ValueError('Invalid backup manifest')
 for name,digest in manifest.items():
  if hashlib.sha256((source/name).read_bytes()).hexdigest()!=digest:raise ValueError('Backup checksum mismatch')
 target.mkdir(mode=0o700,parents=True,exist_ok=False)
 for name in manifest:
  shutil.copyfile(source/name,target/name);os.chmod(target/name,0o600)
 database=Database(target)
 with database.connect() as c:
  if c.execute('PRAGMA integrity_check').fetchone()[0]!='ok':raise ValueError('Database integrity failure')
  c.execute('DELETE FROM sessions');c.execute('DELETE FROM workers')
  c.execute("UPDATE scan_dirs SET state='pending',token=NULL,lease_until=NULL WHERE state='leased'")
  c.execute("UPDATE media_jobs SET status='pending',token=NULL,lease_until=NULL,available=0 WHERE status IN ('running','ready')")
  c.execute("UPDATE derivatives SET status='evicted',path=NULL")
  c.execute('DELETE FROM cache_files')
  c.execute('DELETE FROM processing_progress')
 return database

def main():
 p=argparse.ArgumentParser();p.add_argument('action',choices=('backup','restore'));p.add_argument('source');p.add_argument('destination');a=p.parse_args()
 if a.action=='backup':backup(Database(a.source),a.destination)
 else:restore(a.source,a.destination)
 print('Completed; private backup contains NAS encryption key. Store securely.')
if __name__=='__main__':main()
