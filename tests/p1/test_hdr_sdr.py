"""Synthetic SDR contract, highlight preservation, versioned targeted retry."""
from array import array
import json
import subprocess
from types import SimpleNamespace
from PIL import Image, ImageCms
import pillow_heif
import pytest
from photo_museum import apple_sdr
from photo_museum.hdr import tone_map
from photo_museum.media import still, command, VERSION, HDR_VERSION
from photo_museum.media_worker import MediaWorker
from photo_museum.analysis_worker import AnalysisWorker
from tools.apply_hdr_sdr_policy import apply_policy
from tools.media_probe import hdr_reason
from .test_service import system, scan
from .test_media import jpeg
from .test_delivery import FakeProvider
from .fixture import ROOT, EVENT


def test_pq_highlights_do_not_collapse_to_flat_white(tmp_path):
    # Full PQ range: the old operator lost all steps above code 160.
    codes=[round(x/255*65535) for x in range(256)]
    data=array('H',[v for x in codes for v in [x]*3]).tobytes()
    heif=SimpleNamespace(info={'nclx_profile':{'transfer_characteristics':16,'color_primaries':9}},
                         mode='RGB;16',size=(256,1),data=data,stride=256*6)
    image=tone_map(heif,tmp_path,command)
    values=[image.getpixel((x,0))[0] for x in range(256)]
    image.close()
    assert values[166]<values[180]<values[200]<values[255]
    assert values.count(255)<64  # 8-bit quantization still merges the extreme tail.
    assert not list(tmp_path.iterdir())


def test_gainmap_metadata_routes_to_explicit_sdr(monkeypatch,tmp_path):
    path=tmp_path/'image.jpg';Image.new('RGB',(30,20),'gray').save(path)
    out=tmp_path/'out';out.mkdir();calls=[]
    monkeypatch.setattr(apple_sdr,'available',lambda:True)
    def render(source,folder,cmd,max_edge):
        calls.append(max_edge);return Image.new('RGB',(30,20),'gray'),(30,20)
    monkeypatch.setattr(apple_sdr,'render',render)
    info=still(path,out,{'FileType':'JPEG','HDRGainMapVersion':'1.0'},compatible=True)
    assert calls==[None] and info['color']=='apple_native_sdr'
    assert info['render_version']==HDR_VERSION
    assert {p.name for p in out.iterdir()}=={'thumb.webp','display.webp','compatible.jpg'}
    assert hdr_reason({'GainMapMin':0})=='gainmap_requires_sdr_base_validation'


def test_portable_gainmap_uses_sdr_base_without_expansion(monkeypatch,tmp_path):
    monkeypatch.setattr(apple_sdr,'available',lambda:False)
    path=tmp_path/'base.jpg';icc=ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes()
    Image.new('RGB',(30,20),(180,160,140)).save(path,icc_profile=icc)
    out=tmp_path/'out';out.mkdir()
    info=still(path,out,{'FileType':'JPEG','ProfileDescription':'sRGB','HDRGainMapVersion':'1.0'})
    assert info['sdr_base'] and info['hdr_renderer']=='portable-sdr-base'
    with Image.open(out/'display.webp') as decoded:
        assert max(abs(a-b) for a,b in zip(decoded.getpixel((10,10)),(180,160,140)))<5


def test_portable_hdr_base_gainmap_is_not_silently_ignored(monkeypatch,tmp_path):
    from photo_museum.media import MediaUnsupported
    monkeypatch.setattr(apple_sdr,'available',lambda:False)
    h=SimpleNamespace(size=(10,10),info={'bit_depth':10,'nclx_profile':{
        'transfer_characteristics':16,'color_primaries':9},
        'aux':{'urn:iso:std:iso:ts:21496:-1':1}})
    monkeypatch.setattr(pillow_heif,'open_heif',lambda *a,**kw:h)
    with pytest.raises(MediaUnsupported,match='gainmap_hdr_base_requires_native_sdr'):
        still(tmp_path/'source',tmp_path,{'FileType':'HEIC'})


@pytest.mark.skipif(not apple_sdr.available(),reason='Apple SDR integration requires macOS14 and Swift')
def test_native_sdr_dimensions_orientation_and_temporary_cleanup(tmp_path,monkeypatch):
    monkeypatch.setenv('MUSEUM_DATA',str(tmp_path/'runtime'))
    path=tmp_path/'base.png';Image.new('RGB',(90,60),(180,160,140)).save(path)
    out=tmp_path/'out';out.mkdir()
    image,size=apple_sdr.render(path,out,command,45)
    assert size==(90,60) and image.size==(45,30)
    assert max(abs(a-b) for a,b in zip(image.getpixel((10,10)),(180,160,140)))<=2
    image.close();assert not list(out.iterdir())
    exif=Image.Exif();exif[274]=6
    Image.new('RGB',(90,60),(180,160,140)).save(path,exif=exif)
    image,size=apple_sdr.render(path,out,command,45)
    assert size==(60,90) and image.size==(30,45)
    image.close()
    # Executable compile is cached outside preview storage.
    assert len(list((tmp_path/'runtime/native-codecs').glob('sdr-*')))==1
    broken=tmp_path/'broken';broken.write_bytes(b'not an image')
    with pytest.raises(subprocess.CalledProcessError):apple_sdr.render(broken,out,command,45)
    assert not list(out.iterdir())


@pytest.mark.skipif(not apple_sdr.available(),reason='Apple SDR integration requires macOS14 and Swift')
@pytest.mark.parametrize('transfer',[16,18])
def test_native_real_pq_hlg_container_uses_same_transient_pipeline(tmp_path,monkeypatch,transfer):
    monkeypatch.setenv('MUSEUM_DATA',str(tmp_path/'runtime'))
    path=tmp_path/'ramp.heic';out=tmp_path/'out';out.mkdir()
    data=array('H',[round(x/255*65535) for _ in range(32) for x in range(256) for _ in range(3)]).tobytes()
    encoded=pillow_heif.from_bytes('RGB;16',(256,32),data)
    # pillow-heif's documented singular spelling is ignored; assert the actual container tag.
    encoded.save(path,quality=100,chroma='444',save_nclx_profile=True,
                 color_primaries=9,transfer_characteristics=transfer,matrix_coefficients=9)
    decoded=pillow_heif.open_heif(path,convert_hdr_to_8bit=False)
    assert decoded.info['nclx_profile']['transfer_characteristics']==transfer
    info=still(path,out,{'FileType':'HEIC'},compatible=True)
    assert info['hdr_renderer']=='apple-coreimage' and info['source_bit_depth']==10
    assert (info['width'],info['height'])==(256,32)
    assert {p.name for p in out.iterdir()}=={'thumb.webp','display.webp','compatible.jpg'}
    with Image.open(out/'compatible.jpg') as image:
        assert image.getpixel((50,16))[0]<image.getpixel((100,16))[0]<image.getpixel((150,16))[0]


def test_hdr_retry_preserves_manual_data_and_counts_only_new_completion(system,monkeypatch):
    from photo_museum import media_worker as module
    app,client,remote,sid=system
    remote.entries={ROOT:None,EVENT:None,**{EVENT+f'/{i}.jpg':jpeg() for i in range(2)}}
    scan(app,client,sid);db=app.state.db;worker=MediaWorker(db)
    assert worker.tick() and worker.tick()
    analysis=AnalysisWorker(db,FakeProvider());assert analysis.tick() and analysis.tick()
    with db.connect() as c:
        rows=[dict(r) for r in c.execute('SELECT e.id,e.revision,m.data_json FROM entries e JOIN media_info m ON m.asset_id=e.id ORDER BY e.path')]
        target=rows[0];info=json.loads(target['data_json']);info.update(hdr_source=True)
        c.execute('UPDATE media_info SET data_json=? WHERE asset_id=?',(json.dumps(info),target['id']))
    client.post('/api/assets/'+target['id']+'/curation',json={'pinned':True})
    db.set_metadata(target['id'],'camera','my correction','manual')
    assert client.get('/api/media/state').json()['fully_done']==2
    assert apply_policy(db)['queued']==1 and apply_policy(db,True)['queued']==1
    assert apply_policy(db,True)['queued']==0
    assert client.get('/api/media/state').json()['fully_done']==1
    assert sum(r['done'] for r in client.get('/api/media/directories').json()['items'])==1
    # Do not analyze stale previews while their replacement is pending.
    assert not AnalysisWorker(db,FakeProvider()).tick()
    base=module.still
    def fixed(*args,**kwargs):
        return base(*args,**kwargs)|{'render_version':HDR_VERSION,'hdr_policy':'explicit-sdr-v3','hdr_source':True}
    monkeypatch.setattr(module,'still',fixed)
    assert worker.tick() and not worker.tick()  # synchronize accepts both SDR and HDR versions
    state=client.get('/api/media/state?after=0').json()
    assert state['fully_done']==2 and len(state['recent'])==2
    assert len([e for e in state['completion_events'] if e['id']==target['id']])==1
    assert any('render='+HDR_VERSION in r['preview'] for r in state['recent'])
    assert apply_policy(db,True)['queued']==0
    assert db.effective(target['id'])['camera']['value']=='my correction'
    with db.connect() as c:
        assert c.execute('SELECT pinned FROM curation WHERE asset_id=?',(target['id'],)).fetchone()[0]==1
        assert {json.loads(r[0])['version'] for r in c.execute('SELECT data_json FROM media_info')}=={VERSION,HDR_VERSION}
    assert AnalysisWorker(db,FakeProvider()).tick()
