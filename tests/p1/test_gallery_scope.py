from .test_service import system,scan
from .test_media import jpeg
from .fixture import ROOT,EVENT
from photo_museum.media_worker import MediaWorker
from photo_museum.gallery import event_id
from photo_museum import aesthetics


def test_activity_scope_preserves_groups_root_files_and_pagination(system,monkeypatch):
    app,client,remote,sid=system
    other=ROOT+'/2022-猫'
    remote.entries={ROOT:None,EVENT:None,other:None,ROOT+'/root.jpg':jpeg(),
                    EVENT+'/one.jpg':jpeg(),other+'/cat1.jpg':jpeg(),other+'/cat2.jpg':jpeg()}
    scan(app,client,sid)
    worker=MediaWorker(app.state.db)
    while worker.tick():pass
    monkeypatch.setenv('MUSEUM_AESTHETICS_ENABLED','1')
    calls=[];original=aesthetics.scores
    def observed(c,asset_ids=None):
        calls.append(asset_ids)
        return original(c,asset_ids)
    monkeypatch.setattr(aesthetics,'scores',observed)
    groups=client.get('/api/gallery').json()['activities'];assert len(groups)==3
    for group in groups:
        calls.clear()
        data=client.get('/api/gallery/'+group['id']).json()
        assert data['total']==group['count']
        assert len(calls)==1 and len(calls[0])==data['total']
        if data['total']==2:
            first=client.get('/api/gallery/'+group['id']+'?limit=1').json()
            second=client.get('/api/gallery/'+group['id']+'?offset=1&limit=1').json()
            assert first['items']+second['items']==data['items']
            assert first['total']==second['total']==2
            assert second['previews']==[]
    root=client.get('/api/gallery/'+event_id(sid,'root.jpg')).json()
    assert [p['name'] for p in root['items']]==['root.jpg']
    assert client.get('/api/gallery/unknown').json()['total']==0
    assert client.get('/api/gallery/unknown?offset=-1').status_code==400
