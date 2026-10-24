"""Primary-image NCLX HDR to SDR, retaining high bit depth until tone mapping."""
import tempfile
from pathlib import Path
from PIL import Image


def tone_map(heif, folder, command, max_edge=3840):
    nclx = heif.info.get('nclx_profile') or {}
    transfer, primaries = nclx.get('transfer_characteristics'), nclx.get('color_primaries')
    if transfer not in (16, 18) or primaries not in (1, 9, 12):
        raise ValueError('Unsupported primary HDR color encoding')
    mode = heif.mode
    if mode not in ('RGB;16', 'RGBA;16'):
        raise ValueError('HDR decode must retain 16-bit samples')
    width, height = heif.size
    ratio = min(1, max_edge / max(width, height)) if max_edge else 1
    w, h = max(1, round(width * ratio)), max(1, round(height * ratio))
    # libheif applies container transforms during decode. No second EXIF rotation here.
    with tempfile.TemporaryDirectory(prefix='hdr-', dir=folder) as temporary:
        raw, output = Path(temporary)/'frame.raw', Path(temporary)/'sdr.png'
        channels = 4 if mode.startswith('RGBA') else 3
        row_bytes = width * channels * 2
        data = memoryview(heif.data)
        with raw.open('wb') as stream:
            for y in range(height): stream.write(data[y*heif.stride:y*heif.stride+row_bytes])
        del data
        vf = (f'format=gbrp16le,zscale=w={w}:h={h}:pin={primaries}:tin={transfer}:min=0:rin=full:'
              'p=1:t=linear:m=0:r=full:npl=100,format=gbrpf32le,'
              'tonemap=mobius:param=0.3:desat=2:peak=10,'
              'zscale=t=iec61966-2-1:p=1:m=0:r=full,format=rgb24')
        command(['ffmpeg','-v','error','-y','-threads','1','-filter_threads','1',
                 '-f','rawvideo','-pixel_format','rgba64le' if channels==4 else 'rgb48le',
                 '-video_size',f'{width}x{height}','-i',str(raw),'-frames:v','1','-vf',vf,str(output)],180)
        with Image.open(output) as image: result = image.copy()
    return result
