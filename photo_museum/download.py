"""Bounded on-demand spool for P2 media jobs; separate from directory scan recovery.
Only a strong ETag permits .part continuation. The NAS is never written to.
"""
import fcntl
import hashlib
import json
import os
import re
import time
import httpx
from .webdav import DAVError, strong

class TransferCancelled(Exception):
    pass


def download(dav, entry, spool, cancelled=lambda: False, max_bytes=256*1024*1024, budget=512*1024*1024):
    try:
        return _download(dav, entry, spool, cancelled, max_bytes, budget)
    except httpx.TransportError:
        raise DAVError('network_unavailable', True) from None


def _download(dav, entry, spool, cancelled, max_bytes, budget):
    from pathlib import Path
    spool = Path(spool)
    spool.mkdir(parents=True, exist_ok=True, mode=0o700)
    if entry.size is None or entry.size < 0 or entry.size > max_bytes:
        raise DAVError('download_size_limit')
    key = hashlib.sha256((entry.path + '\0' + entry.revision).encode()).hexdigest()
    part, target, manifest = (spool / (key + suffix) for suffix in ('.part', '.bin', '.json'))
    # One transfer per spool, cross-process; fail fast, caller may requeue.
    with open(spool / '.lock', 'a+b') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise DAVError('spool_busy', True)
        if target.exists():
            try:
                with open(target, 'rb') as cached:
                    digest = hashlib.file_digest(cached, 'sha256').hexdigest()
                info = json.loads(manifest.read_text())
                if info['sha256'] == digest and target.stat().st_size == entry.size:
                    return {'path': target, 'resumed_bytes': 0, 'cached': True, 'sha256': digest}
            except (OSError, ValueError, KeyError):
                pass
            target.unlink(missing_ok=True)
            manifest.unlink(missing_ok=True)
        if not strong(entry.etag):
            part.unlink(missing_ok=True)
        offset = part.stat().st_size if part.exists() else 0
        if offset > entry.size:
            part.unlink()
            offset = 0
        used = sum(p.stat().st_size for p in spool.iterdir() if p.is_file())
        if used + entry.size - offset + 4096 > budget:
            raise DAVError('spool_budget_exceeded')
        started = time.monotonic()
        resumed = 0
        for attempt in range(2):
            headers = {'Accept-Encoding': 'identity'}
            if strong(entry.etag):
                headers['If-Match'] = entry.etag
            if offset:
                headers.update({'Range': f'bytes={offset}-', 'If-Range': entry.etag})
            with dav.client.stream('GET', dav.url(entry.path), headers=headers) as response:
                if response.status_code == 416 and offset:
                    part.unlink(missing_ok=True)
                    offset = 0
                    continue
                if response.status_code == 412:
                    part.unlink(missing_ok=True)
                    raise DAVError('source_version_changed')
                dav.check(response.status_code)
                if response.status_code not in (200, 206):
                    raise DAVError('unexpected_media_response')
                if strong(entry.etag) and response.headers.get('etag') != entry.etag:
                    part.unlink(missing_ok=True)
                    raise DAVError('source_version_changed')
                if response.status_code == 206:
                    match = re.fullmatch(r'bytes (\d+)-(\d+)/(\d+)', response.headers.get('content-range', ''))
                    if not match or tuple(map(int, match.groups())) != (offset, entry.size - 1, entry.size):
                        part.unlink(missing_ok=True)
                        raise DAVError('invalid_content_range')
                    resumed = offset
                else:
                    offset = 0  # Range ignored or If-Range no longer matches: never append 200.
                count = offset
                try:
                    with open(part, 'ab' if offset else 'wb') as out:
                        os.chmod(part, 0o600)
                        for chunk in response.iter_raw(64 * 1024):
                            if cancelled():
                                raise TransferCancelled()
                            if time.monotonic() - started > 120:
                                raise DAVError('download_deadline', True)
                            count += len(chunk)
                            if count > entry.size or count > max_bytes:
                                raise DAVError('download_size_mismatch')
                            out.write(chunk)
                        out.flush()
                        os.fsync(out.fileno())
                finally:
                    if not strong(entry.etag) and count != entry.size:
                        part.unlink(missing_ok=True)
                if count != entry.size:
                    raise DAVError('download_incomplete', True)
                # For weak validators, pre/post metadata checks are best effort, never byte-resume proof.
                current = dav.list(entry.path, depth=0)
                if not current or current[0].revision != entry.revision:
                    part.unlink(missing_ok=True)
                    raise DAVError('source_version_changed')
                with open(part, 'rb') as f:
                    digest = hashlib.file_digest(f, 'sha256').hexdigest()
                os.replace(part, target)
                info = {'sha256': digest, 'revision': entry.revision, 'size': count, 'etag': entry.etag}
                temp = manifest.with_suffix('.json.tmp')
                temp.write_text(json.dumps(info))
                os.chmod(temp, 0o600)
                os.replace(temp, manifest)
                return {'path': target, 'resumed_bytes': resumed, 'cached': False, 'sha256': digest}
        raise DAVError('range_restart_failed')
