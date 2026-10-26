from pathlib import Path
from types import SimpleNamespace
from PIL import Image,ImageFile
import pytest
from photo_museum import media,apple_sdr


def test_missing_jpeg_eoi_recovers_only_temporary_copy(tmp_path):
    path=tmp_path/'source.jpg';Image.new('RGB',(120,80),'tan').save(path)
    content=path.read_bytes()[:-2];path.write_bytes(content)
    out=tmp_path/'out';out.mkdir()
    result=media.still(path,out,{'FileType':'JPEG','ColorSpace':1})
    assert result['recovery']=='jpeg_missing_eoi' and result['source_repaired'] is False
    assert path.read_bytes()==content and not ImageFile.LOAD_TRUNCATED_IMAGES
    assert {p.name for p in out.iterdir()}=={'display.webp','thumb.webp'}
    for p in out.iterdir():
        with Image.open(p) as image:image.load();assert image.mode=='RGB' and image.info['icc_profile']


def test_other_jpeg_decode_errors_are_not_silently_accepted(tmp_path):
    path=tmp_path/'bad.jpg';path.write_bytes(b'not jpeg')
    with pytest.raises(OSError):media.still(path,tmp_path,{'FileType':'JPEG'})


def test_heif_reference_fallback_bounded_native_without_disabling_limits(tmp_path,monkeypatch):
    source=tmp_path/'source.heic';source.write_bytes(b'fixture');calls=[]
    def reject(*a,**k):raise ValueError('Invalid input: Number of references in iref box (1750) exceeds limits')
    monkeypatch.setattr(media.pillow_heif,'open_heif',reject)
    monkeypatch.setattr(apple_sdr,'available',lambda:True)
    def render(path,folder,cmd,max_edge):
        calls.append(path);return Image.new('RGB',(90,60),'gray'),(90,60)
    monkeypatch.setattr(apple_sdr,'render',render)
    meta={'FileType':'HEIC','ImageWidth':90,'ImageHeight':60}
    info=media.still(source,tmp_path,meta)
    assert info['recovery']=='heif_iref_native' and info['hdr_source'] is False
    assert calls==[source] and source.read_bytes()==b'fixture'
    assert not list(tmp_path.glob('heif-native-*'))
    with pytest.raises(ValueError):media.still(source,tmp_path,meta|{'ImageWidth':2000000})
    assert len(calls)==1
    monkeypatch.setattr(apple_sdr,'available',lambda:False)
    with pytest.raises(ValueError):media.still(source,tmp_path,meta)


def test_declared_p3_sdr_not_mislabeled_hdr_or_assumed_srgb(tmp_path,monkeypatch):
    h=SimpleNamespace(info={'bit_depth':8,'nclx_profile':{'color_primaries':12,'transfer_characteristics':1}},size=(90,60))
    monkeypatch.setattr(media.pillow_heif,'open_heif',lambda *a,**k:h)
    monkeypatch.setattr(apple_sdr,'available',lambda:True)
    monkeypatch.setattr(apple_sdr,'render',lambda *a,**k:(Image.new('RGB',(90,60),'gray'),(90,60)))
    result=media.still(tmp_path/'source',tmp_path,{'FileType':'HEIC'})
    assert result['recovery']=='declared_p3_sdr_native'
    assert not result['hdr_source'] and not result['assumed_color'] and result['source_color']=='Display P3'
