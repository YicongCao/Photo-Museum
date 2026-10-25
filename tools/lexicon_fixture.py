"""Synthetic-only vocabulary used by UI/agent tests, never a real photo source."""
import json,threading
from photo_museum.lexicon import LexiconWorker
from photo_museum.localization import catalog

def start(db):
    public=list(catalog()['synsets'].values())
    with db.connect() as c:
        rows=c.execute('SELECT * FROM entries WHERE is_dir=0 ORDER BY path').fetchall()
        for n,row in enumerate(rows):
            t=public[n]
            tags=[{'synset':t['synset'],'label':t['en'],'taxonomy':'imagenet1k'}]
            if n%3==0:tags.append({'synset':'n04285008','label':'sports car, sport car','taxonomy':'imagenet1k'})
            c.execute("UPDATE analysis SET data_json=json_set(data_json,'$.tags',json(?)) WHERE asset_id=? AND provider='visual'",(json.dumps(tags),row['id']))
    worker=LexiconWorker(db)
    while worker.tick():pass
    stop=threading.Event()
    def loop():
        while not stop.wait(.25):worker.tick()
    thread=threading.Thread(target=loop,daemon=True);thread.start()
    def cleanup():stop.set();thread.join(timeout=5)
    return cleanup
