"""Isolated synthetic catalog with optional read-only copies of local preview bytes.
No production credentials, names, EXIF or NAS reads. All output remains in data/.
"""
import json, os, runpy, shutil, sqlite3
from pathlib import Path
import uvicorn
out=Path('data/image-performance');out.mkdir(parents=True,exist_ok=True)
manifest=out/'sample.json'
if not manifest.exists():
    root=Path('data/server').resolve()
    with sqlite3.connect(f'file:{root}/catalog.sqlite?mode=ro',uri=True) as c:
        rows=c.execute("SELECT t.path,d.path FROM cache_files t JOIN cache_files d ON t.asset_id=d.asset_id AND t.revision=d.revision WHERE t.profile='thumb' AND d.profile='display' AND t.path LIKE '%.webp' AND d.path LIKE '%.webp' ORDER BY d.size,t.path").fetchall()
    rows=[r for r in rows if all((root/'cache'/p).is_file() for p in r)]
    selected=[rows[round(i*(len(rows)-1)/83)] for i in range(84)]
    samples=[]
    for i,pair in enumerate(selected):
        item={}
        for profile,p in zip(('thumb','display'),pair):
            target=out/f'sample-{i}-{profile}.webp';shutil.copyfile(root/'cache'/p,target);item[profile]=str(target.resolve())
        samples.append(item)
    manifest.write_text(json.dumps(samples))
samples=json.loads(manifest.read_text())
serve=uvicorn.run
def start(app,**kwargs):
    db=app.state.db
    with db.connect() as c:
        entries=c.execute('SELECT id FROM entries WHERE is_dir=0 ORDER BY path').fetchall()
        for i,row in enumerate(entries):
            # Stable ranks across random fixture IDs and server restarts.
            c.execute("UPDATE analysis SET data_json=json_set(data_json,'$.score',?) WHERE asset_id=? AND provider='visual'",(70+i/100,row['id']))
            for profile in ('thumb','display'):
                cached=c.execute('SELECT path FROM cache_files WHERE asset_id=? AND profile=?',(row['id'],profile)).fetchone()
                if cached:shutil.copyfile(samples[i%len(samples)][profile],db.directory/'cache'/cached['path'])
    print('Performance fixture ready: real cached bytes, synthetic metadata',flush=True)
    return serve(app,**kwargs)
uvicorn.run=start
runpy.run_path('tools/p5_validation_server.py',run_name='__main__')
