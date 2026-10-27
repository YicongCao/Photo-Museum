"""On-demand SDR original conversion. Temporary workspace is removed after delivery."""
import tempfile
import threading
import subprocess
import os
import signal
import sys
import time
from pathlib import Path
from fastapi import HTTPException
from fastapi.responses import StreamingResponse
from starlette.background import BackgroundTask
from .download import download, TransferCancelled
from .media import MediaUnsupported
from .webdav import DAVError

_slots = threading.BoundedSemaphore(1)


def convert_in_process(source, outputs, cancelled):
    """Run the decoder in its own process group so an obsolete decode can stop."""
    env = os.environ.copy()
    env['MUSEUM_VIEW_CONVERSION_CHILD'] = '1'
    proc = subprocess.Popen([sys.executable, '-m', 'photo_museum.view_conversion', str(source), str(outputs)],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env, start_new_session=True)
    deadline = time.monotonic() + 180
    try:
        while proc.poll() is None:
            if cancelled():
                raise TransferCancelled()
            if time.monotonic() >= deadline:
                raise HTTPException(504, '原图转换超时')
            time.sleep(.05)
        if cancelled():
            raise TransferCancelled()
        if proc.returncode == 2:
            raise MediaUnsupported('native_conversion_unsupported')
        if proc.returncode:
            raise HTTPException(500, '原图转换失败')
    finally:
        if proc.poll() is None:
            try: os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError: pass
            proc.wait()


def converted_original(db, row, client, progress=None, cancelled=lambda: False):
    deadline = time.monotonic() + 120
    acquired = False
    while not acquired:
        if cancelled():
            client.close()
            raise TransferCancelled()
        if time.monotonic() >= deadline:
            client.close()
            raise HTTPException(503, '原图转换忙，请稍后重试')
        acquired = _slots.acquire(timeout=.05)
    temporary = None
    handle = None
    try:
        if cancelled(): raise TransferCancelled()
        if progress: progress('download', 0, row['size'])
        if row['size'] is None or row['size'] > 256 * 1024**2:
            raise HTTPException(413, '原图超过单次转换上限')
        parent = db.directory / 'view-work'
        parent.mkdir(mode=0o700, exist_ok=True)
        temporary = tempfile.TemporaryDirectory(prefix='original-', dir=parent)
        folder = Path(temporary.name)
        current = client.list(row['path'], depth=0)
        if cancelled(): raise TransferCancelled()
        if len(current) != 1 or current[0].revision != row['revision']:
            raise HTTPException(409, '原图已更新，请重新扫描')
        local = download(client, current[0], folder/'spool', cancelled=cancelled, max_bytes=256*1024**2, budget=300*1024**2,
                         progress=(lambda done, total: progress('download', done, total)) if progress else None)['path']
        if cancelled(): raise TransferCancelled()
        if progress: progress('convert', row['size'], row['size'])
        outputs = folder/'outputs'; outputs.mkdir()
        # Full-resolution SDR conversion; all outputs belong to this one transient request.
        convert_in_process(local, outputs, cancelled)
        if cancelled(): raise TransferCancelled()
        result = outputs/'compatible.jpg'
        if not result.exists():
            raise HTTPException(415, '此文件无需兼容转换，请使用原图入口')
        handle = result.open('rb')
        length = result.stat().st_size
        if progress: progress('delivery', 0, length)
    except BaseException as exc:
        if progress and not isinstance(exc, TransferCancelled): progress('failed')
        if handle: handle.close()
        if temporary: temporary.cleanup()
        _slots.release()
        if isinstance(exc, MediaUnsupported):
            raise HTTPException(415, '原图色彩格式待适配') from None
        if isinstance(exc, DAVError):
            raise HTTPException(502, 'NAS 原图读取失败') from None
        raise
    finally:
        client.close()
    cleaned = False
    def cleanup():
        nonlocal cleaned
        if cleaned: return
        cleaned = True
        handle.close()
        temporary.cleanup()
        _slots.release()
    def chunks():
        try:
            while chunk := handle.read(128*1024): yield chunk
        finally:
            cleanup()
    class TemporaryImageResponse(StreamingResponse):
        async def __call__(self, scope, receive, send):
            try:
                await super().__call__(scope, receive, send)
            finally:
                cleanup()
    return TemporaryImageResponse(chunks(), media_type='image/jpeg', headers={'Cache-Control':'private, no-store', 'Content-Length':str(length)}, background=BackgroundTask(cleanup))
