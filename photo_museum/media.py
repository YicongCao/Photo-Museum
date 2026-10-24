"""Bounded codecs. ICC-aware SDR stills; explicit HLG/PQ to SDR video conversion."""
import io
import os
import signal
import json
import subprocess
from pathlib import Path
from PIL import Image, ImageCms, ImageOps
import pillow_heif
from tools.media_probe import hdr_reason

pillow_heif.register_heif_opener()
Image.MAX_IMAGE_PIXELS = 110_000_000
VERSION = 'media-srgb-v2'

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

def still(path, folder, meta, progress=lambda *args: None):
    nclx, auxiliaries = {}, []
    if meta.get('FileType') in ('HEIC','HEIF','HIF'):
        h = pillow_heif.open_heif(path, convert_hdr_to_8bit=False)
        nclx = h.info.get('nclx_profile') or {}
        auxiliaries = list(h.info.get('aux',{}))
        del h
    reason = hdr_reason(meta,nclx,auxiliaries)
    apple_sdr_base = (meta.get('FileType') in ('HEIC','HEIF','HIF') and meta.get('Make')=='Apple' and meta.get('ProfileDescription') in ('Display P3','sRGB IEC61966-2.1') and nclx.get('transfer_characteristics') not in (16,18))
    jpeg_sdr_base = meta.get('FileType')=='JPEG' and meta.get('ProfileDescription') in ('Display P3','sRGB IEC61966-2.1','sRGB') and meta.get('TransferCharacteristics') not in (16,18)
    if reason and not (apple_sdr_base or jpeg_sdr_base):
        raise MediaUnsupported(reason)
    srgb = ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB'))
    with Image.open(path) as src:
        icc = src.info.get('icc_profile')
        image = ImageOps.exif_transpose(src)
        if icc:
            image = ImageCms.profileToProfile(image, ImageCms.ImageCmsProfile(io.BytesIO(icc)),srgb,outputMode='RGB')
            color = 'icc_to_srgb'
        elif meta.get('ColorSpace') == 1 or (nclx.get('color_primaries')==1 and nclx.get('transfer_characteristics')==13):
            image = image.convert('RGB')
            color = 'declared_srgb'
        elif meta.get('FileType') in ('JPEG','PNG') and not nclx:
            # W3C untagged-image default. Explicit assumption, never described as measured ICC.
            image = image.convert('RGB')
            color = 'untagged_assumed_srgb'
        else:
            raise MediaUnsupported('unknown_color_profile')
        result = {'width':image.width,'height':image.height,'color':color,'hdr':False,'hdr_source':bool(reason),'sdr_base':apple_sdr_base}
        for profile,edge,quality in [('display',3840,80),('thumb',640,74)]:
            progress(profile, 'running')
            out = image.copy()
            out.thumbnail((edge,edge),Image.Resampling.LANCZOS)
            out.save(folder/(profile+'.webp'),'WEBP',quality=quality,method=4,icc_profile=srgb.tobytes())
            progress(profile, 'done')
        # Native JPEG/PNG gets the source file. HEIF needs a full-resolution compatibility image.
        if reason or meta.get('FileType') not in ('JPEG','PNG','WEBP'):
            progress('compatible', 'running')
            image.save(folder/'compatible.jpg','JPEG',quality=94,icc_profile=srgb.tobytes())
            progress('compatible', 'done')
        return result

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
    # Browser-compatible SDR H.264, bounded execution; preserves audio where present.
    playback_vf=('zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=mobius:desat=2,zscale=t=bt709:m=bt709:r=limited,' if hdr else ('colorspace=iall='+s['color_primaries']+':all=bt709,' if assumed else 'colorspace=all=bt709,'))+'scale=1920:1080:force_original_aspect_ratio=decrease:force_divisible_by=2,format=yuv420p'
    progress('playback', 'running')
    command(['ffmpeg','-v','error','-y','-i',str(path),'-map','0:v:0','-map','0:a:0?','-vf',playback_vf,'-c:v','libx264','-threads','2','-preset','fast','-crf','23','-c:a','aac','-b:a','128k','-fs','1073741824','-movflags','+faststart','-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709',str(folder/'playback.mp4')],900)
    output_duration=float(json.loads(command(['ffprobe','-v','error','-show_entries','format=duration','-of','json',str(folder/'playback.mp4')]))['format']['duration'])
    if abs(output_duration-duration)>1:
        raise MediaUnsupported('playback_exceeds_output_limit')
    progress('playback', 'done')
    return result | {'assumed_color':assumed,'duration':duration,'hdr_source':hdr,'frame_time':duration/2,'codec':s.get('codec_name'),'color':'hlg_pq_mobius_sdr' if hdr else 'bt709_to_srgb'}
