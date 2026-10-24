import io
import json
from array import array
from types import SimpleNamespace
from PIL import Image
import pytest
from photo_museum.media import still,command
from photo_museum.hdr import tone_map
from photo_museum.media_worker import MediaWorker
from photo_museum.analysis_worker import AnalysisWorker
from photo_museum.cache import Cache
from tools.apply_preview_policy import apply_policy
from .test_service import system,scan
from .test_media import jpeg
from .test_delivery import FakeProvider
from .fixture import ROOT,EVENT


def test_preview_only_and_explicit_transient_compatibility(tmp_path):
    source=tmp_path/'untagged.png';Image.new('RGB',(200,100),'red').save(source)
    out=tmp_path/'out';out.mkdir()
    info=still(source,out,{'FileType':'PNG'})
    assert {p.name for p in out.iterdir()}=={'display.webp','thumb.webp'}
    assert info['assumed_color'] and info['score_penalty']==15
    still(source,out,{'FileType':'PNG'},compatible=True)
    with Image.open(out/'compatible.jpg') as image:assert image.size==(200,100)


@pytest.mark.parametrize('transfer',[16,18])
@pytest.mark.parametrize('primaries',[9,12])
def test_hdr_high_depth_neutral_ramp(transfer,primaries,tmp_path):
    w,h=64,4
    raw=array('H',[v for _ in range(h) for x in range(w) for v in [round(x/(w-1)*65535)]*3]).tobytes()
    heif=SimpleNamespace(info={'nclx_profile':{'transfer_characteristics':transfer,'color_primaries':primaries}},mode='RGB;16',size=(w,h),data=raw,stride=w*6)
    image=tone_map(heif,tmp_path,command)
    values=[image.getpixel((x,0)) for x in range(w)]
    assert values[0]==(0,0,0) and min(values[-1])>=245
    assert all(max(rgb)-min(rgb)<=2 for rgb in values)
    assert all(values[i][0]<=values[i+1][0] for i in range(w-1))
    assert not list(tmp_path.iterdir())


@pytest.mark.parametrize('suffix,size,kind',[('.JPG',300*1024**2,'image'),('.MP4',3*1024**3,'video')])
def test_oversized_zero_get_placeholder_and_no_analysis(system,suffix,size,kind):
    app,client,remote,sid=system
    remote.entries={ROOT:None,EVENT:None,EVENT+'/huge'+suffix:jpeg()}
    scan(app,client,sid)
    with app.state.db.connect() as c:
        c.execute('UPDATE entries SET size=? WHERE is_dir=0',(size,))
        row=dict(c.execute('SELECT * FROM entries WHERE is_dir=0').fetchone())
    worker=MediaWorker(app.state.db);assert worker.tick()
    assert not any(call[0]=='GET' for call in remote.calls)
    assert not worker.tick()
    assert not AnalysisWorker(app.state.db,FakeProvider()).tick()
    manifest=client.get('/api/assets/'+row['id']+'/manifest').json()
    assert manifest['placeholder']==kind and manifest['original'] is None
    result=client.get(manifest['thumbnail'])
    assert result.status_code==200 and '超大' in result.text
    assert client.get('/api/assets/'+row['id']+'/original-compatible',params={'revision':row['revision']}).status_code==413
    assert not any(call[0]=='GET' for call in remote.calls)
    assert client.get('/api/gallery').json()['activities'][0]['selected']==[]
    assert client.get('/api/media/state').json()['fully_done']==1


def test_assumed_color_penalty_and_cleanup_idempotent(system):
    app,client,remote,sid=system
    out=io.BytesIO();Image.new('RGB',(240,160),'red').save(out,'JPEG')
    remote.entries={ROOT:None,EVENT:None,EVENT+'/one.jpg':out.getvalue()}
    scan(app,client,sid);MediaWorker(app.state.db).tick()
    worker=AnalysisWorker(app.state.db,FakeProvider());assert worker.tick()
    db=app.state.db;cache=Cache(db)
    with db.connect() as c:
        a=dict(c.execute('SELECT * FROM entries WHERE is_dir=0').fetchone())
        score=json.loads(c.execute("SELECT data_json FROM analysis WHERE provider='visual'").fetchone()[0])
        assert score['raw_score']==70 and score['score']==55
        for profile in ('compatible','playback'):
            path=cache.root/(profile+'.bin');path.write_bytes(b'x'*100)
            cache.register(c,a['id'],a['revision'],profile,path)
    assert apply_policy(db)['removed_bytes']==200
    assert apply_policy(db,True)['removed_bytes']==200
    assert apply_policy(db,True)['removed_bytes']==0
    with db.connect() as c:
        assert {r[0] for r in c.execute('SELECT profile FROM cache_files')}=={'thumb','display'}
        assert json.loads(c.execute("SELECT data_json FROM analysis WHERE provider='visual'").fetchone()[0])['score']==55


def test_policy_retry_is_scoped_and_keeps_other_errors(system):
    app,client,remote,sid=system
    remote.entries={ROOT:None,EVENT:None,**{EVENT+f'/{i}.jpg':jpeg() for i in range(3)}}
    scan(app,client,sid);db=app.state.db
    with db.connect() as c:
        rows=c.execute('SELECT id,revision FROM entries WHERE is_dir=0 ORDER BY path').fetchall()
        for row,error in zip(rows,['pq_or_hlg_transfer','gainmap_requires_sdr_base_validation','unknown_color_profile']):
            c.execute("INSERT OR REPLACE INTO media_jobs(asset_id,revision,status,error) VALUES(?,?,'unsupported',?)",(*row,error))
        c.execute('UPDATE entries SET scope_excluded=1 WHERE id=?',(rows[2]['id'],))
    report=apply_policy(db,True)
    assert report['retry']['pq_or_hlg_transfer']==1 and report['retry']['unknown_color_profile']==0
    with db.connect() as c:
        assert dict(c.execute('SELECT asset_id,status FROM media_jobs'))=={rows[0]['id']:'pending',rows[1]['id']:'unsupported',rows[2]['id']:'unsupported'}


def test_known_pixel_limit_does_not_fetch_or_decode(system):
    app,client,remote,sid=system
    remote.entries={ROOT:None,EVENT:None,EVENT+'/huge.jpg':jpeg()}
    scan(app,client,sid);db=app.state.db
    with db.connect() as c:row=dict(c.execute('SELECT * FROM entries WHERE is_dir=0').fetchone())
    db.record_extraction(row['id'],row['revision'],'extracted','fixture')
    for k in ('width','height'):db.set_metadata(row['id'],k,20000,'observed',row['revision'])
    assert MediaWorker(db).tick()
    assert not any(call[0]=='GET' for call in remote.calls)
    assert client.get('/api/assets/'+row['id']+'/original',params={'revision':row['revision']}).status_code==413
