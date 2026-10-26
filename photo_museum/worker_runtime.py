"""Bound idle probes and retry SQLite contention without replaying transactions."""
import random
import sqlite3
import time


def is_database_busy(error):
    if not isinstance(error, sqlite3.OperationalError):
        return False
    code = getattr(error, 'sqlite_errorcode', None)
    if code is not None:
        return (code & 255) in (sqlite3.SQLITE_BUSY, sqlite3.SQLITE_LOCKED)
    return str(error) in ('database is locked', 'database table is locked', 'database is busy')


def run_loop(tick, *, idle=1, once=False, sleep=time.sleep, log=print, revision=None, max_idle=30, heartbeat=None):
    failures = 0
    delay = idle
    probe_delay = min(idle, 5)
    while True:
        try:
            before = revision() if revision else None
            worked = tick()
            failures = 0
        except sqlite3.OperationalError as error:
            if not is_database_busy(error) or once:
                raise
            failures += 1
            if failures == 1 or failures & (failures - 1) == 0:
                log('Database busy; worker will retry', flush=True)
            sleep(min(5, .25 * 2 ** min(failures - 1, 5)) * random.uniform(.8, 1.2))
            continue
        if once:
            return worked
        if worked:
            delay = idle
            probe_delay = min(idle, 5)
            continue
        if revision is None:
            # No revision source: bounded full checks (including timed retries).
            sleep(delay)
            delay = min(max_idle, delay * 2)
            continue
        # Read the transactional token at 1/2/4/5 second intervals; keep the
        # five-second liveness heartbeat independent of backoff. Time-based
        # leases/retries still get a full tick at least every max_idle seconds.
        elapsed = 0
        next_probe = probe_delay
        next_heartbeat = 5
        while elapsed < max_idle:
            due = min(next_probe, next_heartbeat if heartbeat else max_idle, max_idle)
            sleep(max(0, due - elapsed))
            elapsed = due
            try:
                if heartbeat and elapsed >= next_heartbeat:
                    heartbeat()
                    next_heartbeat += 5
                if elapsed >= next_probe:
                    if revision() != before:
                        probe_delay = min(idle, 5)
                        break
                    probe_delay = min(5, probe_delay * 2)
                    next_probe = elapsed + probe_delay
            except sqlite3.OperationalError as error:
                if not is_database_busy(error):
                    raise
                failures += 1
                if failures == 1 or failures & (failures - 1) == 0:
                    log('Database busy; worker will retry', flush=True)
                break
