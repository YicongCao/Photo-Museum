"""Bounded server-side snapshots for expensive read-only dashboard projections."""
from collections import OrderedDict
from functools import wraps
import threading
import time


def cached_read(database, *, ttl=30):
    def decorate(fn):
        lock = threading.Lock()
        snapshots = OrderedDict()
        def token():
            with database.connect() as c:
                return tuple(c.execute('SELECT catalog,work,telemetry FROM runtime_revision WHERE id=1').fetchone())
        @wraps(fn)
        def read(*args, **kwargs):
            key = (args, tuple(sorted(kwargs.items())))
            with lock:
                before = token()
                previous = snapshots.get(key)
                if previous and previous[0] == before and time.monotonic() < previous[1]:
                    return previous[2]
                result = fn(*args, **kwargs)
                # Expiring leases and temporary files aren't database writes.
                active = bool(result.get('active')) or any(r.get('active') or r.get('state') == 'leased' for r in result.get('items', []))
                lifetime = min(ttl, 1) if active else ttl
                if token() == before:
                    snapshots[key] = (before, time.monotonic()+lifetime, result)
                    snapshots.move_to_end(key)
                    while len(snapshots) > 8:
                        snapshots.popitem(last=False)
                return result
        return read
    return decorate
