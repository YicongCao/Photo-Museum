"""Isolated synthetic P1 browser fixture. Never reads data/server or NAS credentials."""
import importlib.util
import os
from pathlib import Path
import tempfile
import threading
import uvicorn

os.environ['MUSEUM_HOSTS'] = '127.0.0.1:8791'
spec=importlib.util.spec_from_file_location('p1_fixture',Path(__file__).resolve().parents[1]/'tests/p1/fixture.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
from photo_museum.api import create_app
from photo_museum.worker import Worker

with tempfile.TemporaryDirectory(prefix='museum-p1-browser-') as directory, module.fixture() as (remote,url):
    app=create_app(directory)
    db=app.state.db;sec=app.state.security
    sec.setup('synthetic-owner-password')
    remote.delay=1
    for n in range(4):
        remote.entries[module.EVENT+f'/子集{n}']=None
        remote.entries[module.EVENT+f'/子集{n}/sample.jpg']=b'demo'
    import time
    with db.connect() as c:
        c.execute('INSERT INTO sources VALUES(?,?,?,?,?,?,?,?,?)',('fixture','合成照片源',url,module.ROOT,'pulsar',sec.encrypt('fixture-only'),None,1,time.time()))
    stop=threading.Event()
    def run():
        worker=Worker(db)
        while not stop.is_set():
            if not worker.tick():stop.wait(.1)
    thread=threading.Thread(target=run,daemon=True);thread.start()
    try:uvicorn.run(app,host='127.0.0.1',port=8791,access_log=False)
    finally:stop.set();thread.join(timeout=25)
