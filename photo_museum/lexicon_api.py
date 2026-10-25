"""Owner-only local vocabulary inspection, sharing the agent's published index."""
from fastapi import Depends,HTTPException,Query
from .lexicon import Lexicon

def register(app,db,owner):
    @app.get('/api/lexicon',dependencies=[Depends(owner)])
    def words(query:str=Query('',max_length=160),domain:str='subject',cursor:str|None=Query(None,max_length=256),limit:int=Query(20,ge=1,le=60)):
        try:return Lexicon(db).lookup(query,[domain],limit=limit,cursor=cursor)
        except ValueError as error:raise HTTPException(422,str(error)) from None
    @app.get('/api/lexicon/status',dependencies=[Depends(owner)])
    def status():return Lexicon(db).status()
    @app.post('/api/lexicon/rebuild',dependencies=[Depends(owner)])
    def rebuild():
        with db.connect() as c:
            c.execute('BEGIN IMMEDIATE')
            row=c.execute("SELECT value FROM settings WHERE key='lexicon_epoch'").fetchone()
            c.execute("INSERT OR REPLACE INTO settings VALUES('lexicon_epoch',?)",(str(int(row[0])+1 if row else 1),))
        return {'queued':True,'scope':'metadata-only'}
