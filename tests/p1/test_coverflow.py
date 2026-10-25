import json,time
from photo_museum.media_worker import MediaWorker
from .test_media import jpeg
from .test_service import system,scan
from .fixture import ROOT,EVENT


def test_strict_score_top10_and_chronological_wall(system):
    app,client,remote,sid=system
    remote.entries={ROOT:None,EVENT:None,**{EVENT+f'/{i:02}.jpg':jpeg() for i in range(12)},EVENT+'/solo.mp4':b'index only'}
    scan(app,client,sid);db=app.state.db;worker=MediaWorker(db)
    while worker.tick():pass
    with db.connect() as c:
        rows=c.execute("SELECT e.*,m.data_json FROM entries e JOIN media_info m ON m.asset_id=e.id WHERE e.kind='image_candidate' ORDER BY e.path").fetchall()
        for i,row in enumerate(rows):
            # A low-score pin and identical burst signatures must not override raw score Top10.
            info=json.loads(row['data_json'])
            c.execute('INSERT INTO analysis VALUES(?,?,?,?,?,?)',(row['id'],row['revision'],'visual','test',json.dumps({'score':i,'signature':'000','input_media_version':info['version']}),time.time()))
        c.execute('INSERT INTO curation(asset_id,pinned,excluded,updated) VALUES(?,1,0,0)',(rows[0]['id'],))
    for i,r in enumerate(rows):db.set_metadata(r['id'],'captured_at',f'2024:10:{12-i:02} 12:00:00','observed',r['revision'])
    activity=client.get('/api/gallery').json()['activities'][0]
    assert [p['score'] for p in activity['selected']]==list(range(11,1,-1))
    assert activity['selection_policy']=='score-top10'
    wall=client.get('/api/gallery/'+activity['id']+'?limit=15').json()
    assert wall['photos']==12 and wall['videos']==1
    assert [p['id'] for p in wall['previews']]==[r['id'] for r in reversed(rows)]
    assert [p['id'] for p in wall['items'][:12]]==[r['id'] for r in reversed(rows)]
    assert wall['items'][-1]['metadata_only'] and wall['items'][-1]['preview'] is None
    assert client.get('/api/assets/'+rows[0]['id']+'/manifest').json()['media']['width']==240
    # Unknown score is excluded; zero is a valid score, not treated as unknown.
    with db.connect() as c:c.execute('DELETE FROM analysis WHERE asset_id=?',(rows[-1]['id'],))
    selection=client.get('/api/gallery').json()['activities'][0]['selected']
    assert [p['score'] for p in selection]==list(range(10,0,-1))
