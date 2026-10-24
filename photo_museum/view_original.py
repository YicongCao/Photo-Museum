"""On-demand SDR original conversion. Temporary workspace is removed after delivery."""
import tempfile
import threading
from pathlib import Path
from fastapi import HTTPException
from fastapi.responses import StreamingResponse
from starlette.background import BackgroundTask
from .download import download
from .media import metadata, still, MediaUnsupported
from .webdav import DAVError

_slots = threading.BoundedSemaphore(1)


def converted_original(db, row, client):
    if not _slots.acquire(blocking=False):
        client.close()
        raise HTTPException(503, '原图转换忙，请稍后重试')
    temporary = None
    handle = None
    try:
        if row['size'] is None or row['size'] > 256 * 1024**2:
            raise HTTPException(413, '原图超过单次转换上限')
        parent = db.directory / 'view-work'
        parent.mkdir(mode=0o700, exist_ok=True)
        temporary = tempfile.TemporaryDirectory(prefix='original-', dir=parent)
        folder = Path(temporary.name)
        current = client.list(row['path'], depth=0)
        if len(current) != 1 or current[0].revision != row['revision']:
            raise HTTPException(409, '原图已更新，请重新扫描')
        local = download(client, current[0], folder/'spool', max_bytes=256*1024**2, budget=300*1024**2)['path']
        outputs = folder/'outputs'; outputs.mkdir()
        # Full-resolution SDR conversion; all outputs belong to this one transient request.
        still(local, outputs, metadata(local))
        result = outputs/'compatible.jpg'
        if not result.exists():
            raise HTTPException(415, '此文件无需兼容转换，请使用原图入口')
        handle = result.open('rb')
    except BaseException as exc:
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
    return TemporaryImageResponse(chunks(), media_type='image/jpeg', headers={'Cache-Control':'private, no-store'}, background=BackgroundTask(cleanup))
