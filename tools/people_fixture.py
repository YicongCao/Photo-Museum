"""Synthetic group labels/boxes for UI verification, never a detector-quality fixture."""
import json,time

def enrich(db):
 with db.connect() as c:
  photos=list(c.execute('SELECT id,revision FROM entries WHERE is_dir=0 ORDER BY path'))
  version=c.execute("SELECT value FROM settings WHERE key='analysis_version'").fetchone()[0]
  for n in range(55):
   pid=f'fixture-person-{n:03}';c.execute('INSERT INTO people VALUES(?,?,?)',(pid,'示例人物 '+str(n) if n%7==0 else '',time.time()))
   for k in range(3 if n==0 else 1):
    photo=photos[(n+k)%len(photos)]
    c.execute('INSERT INTO faces VALUES(?,?,?,?,?,?,?,?)',(f'fixture-face-{n:03}-{k}',photo['id'],photo['revision'],pid,json.dumps([.2,.2,.3,.3]),b'fixture-not-biometric',version,0))
