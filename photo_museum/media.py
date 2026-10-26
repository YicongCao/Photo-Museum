"""Bounded codecs. ICC-aware SDR stills; explicit HLG/PQ to SDR video conversion."""
import io
import os
import signal
import json
import subprocess
import tempfile
import shutil
from pathlib import Path
from PIL import Image, ImageCms, ImageOps
import pillow_heif
from tools.media_probe import hdr_reason, has_gain_map

pillow_heif.register_heif_opener()
Image.MAX_IMAGE_PIXELS = 110_000_000
VERSION = 'media-srgb-v2'
HDR_VERSION = 'media-hdr-sdr-v3'

class MediaUnsupported(Exception):
    pass

def command(args, timeout=90):
    if args[0]=='ffmpeg':
        full='/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg'
        args=[os.environ.get('MUSEUM_FFMPEG',full if Path(full).is_file() else 'ffmpeg'),*args[1:]]
    proc=subprocess.Popen(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
    try:
        out,err=proc.communicate(timeout=timeout)
        if proc.returncode:
            raise subprocess.CalledProcessError(proc.returncode,args,output=out,stderr=err)
        return out
    finally:
        if proc.poll() is None:
            os.killpg(proc.pid,signal.SIGKILL)
            proc.communicate()

def metadata(path):
    row = json.loads(command(['exiftool','-json','-n',str(path)]))[0]
    row.pop('SourceFile',None)
    return row

def facts(meta):
    fields = {'Make':'make','Model':'camera','LensModel':'lens','FNumber':'aperture', 'ExposureTime':'exposure','ISO':'iso','FocalLength':'focal_length', 'FocalLengthIn35mmFormat':'focal_35mm','DateTimeOriginal':'captured_at','OffsetTimeOriginal':'timezone','ImageWidth':'width','ImageHeight':'height','Orientation':'orientation','ContentIdentifier':'content_identifier'}
    result = {dest:meta[src] for src,dest in fields.items() if src in meta}
    lat, lon = meta.get('GPSLatitude'), meta.get('GPSLongitude')
    if isinstance(lat,(int,float)) and isinstance(lon,(int,float)) and -90<=lat<=90 and -180<=lon<=180:
        result['gps'] = {'latitude':lat,'longitude':lon}
    return result

def still(path, folder, meta, progress=lambda *args: None, *, compatible=False):
    try:
        return _still_strict(path, folder, meta, progress, compatible=compatible)
    except OSError as exc:
        # Only a missing JPEG EOI, with a strict second decode. Never enable global truncation tolerance.
        if meta.get('FileType')!='JPEG' or 'image file is truncated' not in str(exc):raise
        if Path(path).stat().st_size>256*1024**2:raise
        with Path(path).open('rb') as source:
            if source.read(2)!=b'\xff\xd8':raise
            source.seek(-2,2)
            if source.read()==b'\xff\xd9':raise
        with tempfile.TemporaryDirectory(prefix='jpeg-eoi-',dir=folder) as temporary:
            repaired=Path(temporary)/'repaired.jpg'
            with Path(path).open('rb') as source,repaired.open('wb') as target:
                shutil.copyfileobj(source,target);target.write(b'\xff\xd9')
            result=_still_strict(repaired,folder,meta,progress,compatible=compatible)
        return result|{'recovery':'jpeg_missing_eoi','recovery_version':'bounded-compat-v1','source_repaired':False}
    except ValueError as exc:
        # This specific HEIF container limit is handled by the bounded native process, not disabled.
        from . import apple_sdr
        if (meta.get('FileType') not in ('HEIC','HEIF','HIF') or 'Number of references in iref box' not in str(exc)
            or not apple_sdr.available()):raise
        w,h=meta.get('ImageWidth'),meta.get('ImageHeight')
        if (not isinstance(w,(int,float)) or not isinstance(h,(int,float)) or w<=0 or h<=0
            or w*h>Image.MAX_IMAGE_PIXELS or Path(path).stat().st_size>256*1024**2):raise
        with tempfile.TemporaryDirectory(prefix='heif-native-',dir=folder) as temporary:
            temporary=Path(temporary)
            image,size=apple_sdr.render(path,temporary,command,max_edge=None if compatible else 3840)
            try:
                decoded=temporary/'decoded.png'
                image.save(decoded,icc_profile=ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes())
            finally:image.close()
            result=_still_strict(decoded,folder,{'FileType':'PNG','ColorSpace':1},progress,compatible=compatible)
        result.update(width=size[0],height=size[1],color='apple_native_sdr',hdr_source=bool(hdr_reason(meta)),
                      source_color=meta.get('ProfileDescription'),source_bit_depth=meta.get('BitsPerSample') or meta.get('BitDepth'),
                      recovery='heif_iref_native',recovery_version='bounded-compat-v1',renderer='apple-coreimage')
        if result['hdr_source']:result.update(render_version=HDR_VERSION,hdr_policy='explicit-sdr-v3',hdr_renderer='apple-coreimage')
        return result


def _still_strict(path, folder, meta, progress=lambda *args: None, *, compatible=False):
    nclx, auxiliaries, h = {}, [], None
    if meta.get('FileType') in ('HEIC','HEIF','HIF'):
        h = pillow_heif.open_heif(path, convert_hdr_to_8bit=False)
        nclx = h.info.get('nclx_profile') or {}
        auxiliaries = list(h.info.get('aux',{}))
        if h.size[0] * h.size[1] > Image.MAX_IMAGE_PIXELS:
            raise Image.DecompressionBombError("Image exceeds preview pixel budget")
    source_bits = h.info.get('bit_depth') if h else meta.get('BitsPerSample') or meta.get('BitDepth')
    source_color = meta.get('ProfileDescription') or {1:'sRGB / BT.709',9:'BT.2020',12:'Display P3'}.get(nclx.get('color_primaries'))
    reason = hdr_reason(meta,nclx,auxiliaries)
    gain_map = has_gain_map(meta, auxiliaries)
    apple_sdr_base = (meta.get('FileType') in ('HEIC','HEIF','HIF') and meta.get('Make')=='Apple' and meta.get('ProfileDescription') in ('Display P3','sRGB IEC61966-2.1') and nclx.get('transfer_characteristics') not in (16,18))
    jpeg_sdr_base = meta.get('FileType')=='JPEG' and meta.get('ProfileDescription') in ('Display P3','sRGB IEC61966-2.1','sRGB') and meta.get('TransferCharacteristics') not in (16,18)
    primary_hdr = nclx.get('transfer_characteristics') in (16, 18)
    # ExifTool may report an auxiliary item's PQ tag. Primary 8-bit ICC SDR is authoritative.
    icc_sdr_base = bool(h and h.info.get('bit_depth') == 8 and h.info.get('icc_profile')
                        and meta.get('ProfileDescription') in ('Display P3','sRGB IEC61966-2.1','sRGB') and not primary_hdr)
    from . import apple_sdr
    native_sdr_nclx = bool(h and not h.info.get('icc_profile') and nclx.get('color_primaries')==12 and nclx.get('transfer_characteristics') in (1,13) and not reason)
    use_apple = bool((reason or native_sdr_nclx) and apple_sdr.available())
    if gain_map and primary_hdr and not use_apple:
        raise MediaUnsupported('gainmap_hdr_base_requires_native_sdr')
    if reason and not (use_apple or primary_hdr or apple_sdr_base or jpeg_sdr_base or icc_sdr_base):
        raise MediaUnsupported(reason)
    srgb = ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB'))
    assumed = False
    if use_apple:
        del h
        image, original_size = apple_sdr.render(path, folder, command, max_edge=None if compatible else 3840)
        color = 'apple_native_sdr'
    elif primary_hdr:
        from .hdr import tone_map
        if nclx.get('color_primaries') not in (1,9,12):
            raise MediaUnsupported('unsupported_hdr_primaries')
        original_size = h.size
        image = tone_map(h, folder, command, max_edge=None if compatible else 3840)
        color = 'primary_nclx_mobius_203_srgb'
        del h
    else:
        del h
        with Image.open(path) as src:
            if src.width*src.height>Image.MAX_IMAGE_PIXELS:raise Image.DecompressionBombError()
            icc = src.info.get('icc_profile')
            image = ImageOps.exif_transpose(src)
            if icc:
                image = ImageCms.profileToProfile(image, ImageCms.ImageCmsProfile(io.BytesIO(icc)),srgb,outputMode='RGB')
                color = 'icc_to_srgb'
            elif meta.get('ColorSpace') == 1 or (nclx.get('color_primaries')==1 and nclx.get('transfer_characteristics')==13):
                image = image.convert('RGB')
                color = 'declared_srgb'
            else:
                if nclx.get('color_primaries') not in (None,0,2):
                    image.close()
                    raise MediaUnsupported('unsupported_sdr_nclx')
                image = image.convert('RGB')
                color = 'untagged_assumed_srgb'
                assumed = True
        original_size = image.size
    try:
        result = {'width':original_size[0],'height':original_size[1],'color':color,'hdr':False,'hdr_source':bool(reason),'sdr_base':apple_sdr_base or jpeg_sdr_base or icc_sdr_base,'assumed_color':assumed,'score_penalty':15 if assumed else 0,'cache_policy':'preview-only-v1','source_bit_depth':source_bits,'source_color':source_color}
        if use_apple and native_sdr_nclx:
            result.update(recovery='declared_p3_sdr_native',renderer='apple-coreimage',recovery_version='bounded-compat-v1')
        if reason:
            result.update(render_version=HDR_VERSION, hdr_policy='explicit-sdr-v3',
                          source_gain_map=gain_map,
                          hdr_renderer='apple-coreimage' if use_apple else 'portable-sdr-base' if not primary_hdr else 'portable-mobius-203')
        for profile,edge,quality in [('display',3840,80),('thumb',640,74)]:
            progress(profile, 'running')
            out = image.copy()
            out.thumbnail((edge,edge),Image.Resampling.LANCZOS)
            out.save(folder/(profile+'.webp'),'WEBP',quality=quality,method=4,icc_profile=srgb.tobytes())
            out.close()
            progress(profile, 'done')
        # Native JPEG/PNG gets the source file. HEIF needs a full-resolution compatibility image.
        if compatible:
            progress('compatible', 'running')
            image.save(folder/'compatible.jpg','JPEG',quality=94,icc_profile=srgb.tobytes())
            progress('compatible', 'done')
        return result
    finally:
        image.close()

def video(path,folder,meta,progress=lambda *args: None):
    probe=json.loads(command(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(path)]))
    streams=[s for s in probe.get('streams',[]) if s['codec_type']=='video' and not s.get('disposition',{}).get('attached_pic')]
    if not streams:
        raise MediaUnsupported('no_video_stream')
    s=streams[0]
    duration=float(probe.get('format',{}).get('duration',0))
    if duration<=0:
        raise MediaUnsupported('unknown_duration')
    assumed=False
    if not any(s.get(k) for k in ('color_transfer','color_primaries','color_space')) and s.get('pix_fmt') in ('yuv420p','yuvj420p'):
        assumed=True
        fallback='bt709' if s.get('height',0)>=720 else 'smpte170m'
        s.update(color_primaries=fallback,color_transfer=fallback,color_space=fallback)
    hdr=s.get('color_transfer') in ('arib-std-b67','smpte2084')
    if hdr:
        vf='zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=mobius:desat=2,zscale=t=iec61966-2-1:m=bt709:r=full,format=rgb24'
    elif s.get('color_primaries') in ('bt709','smpte432','smpte170m','bt2020') and s.get('color_transfer') in ('bt709','iec61966-2-1','smpte170m'):
        vf=('colorspace=iall='+s['color_primaries']+':all=bt709:trc=iec61966-2-1:format=yuv444p,format=rgb24') if assumed else 'colorspace=all=bt709:trc=iec61966-2-1:format=yuv444p,format=rgb24'
    else:
        raise MediaUnsupported('unknown_video_color')
    progress('frame', 'running')
    frame=folder/'frame.png'
    command(['ffmpeg','-v','error','-y','-threads','2','-ss',str(duration/2),'-i',str(path),'-frames:v','1','-vf',vf,str(frame)],180)
    progress('frame', 'done')
    result=still(frame,folder,{'ColorSpace':1,'FileType':'PNG'},progress)
    frame.unlink()
    return result | {'assumed_color':assumed,'duration':duration,'hdr_source':hdr,'frame_time':duration/2,'codec':s.get('codec_name'),'color':'hlg_pq_mobius_sdr' if hdr else 'bt709_to_srgb'}
