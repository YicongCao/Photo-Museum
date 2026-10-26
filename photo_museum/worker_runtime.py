"""Retry transient SQLite contention without replaying a transaction body."""
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
        if not worked:
            if revision is None:
                sleep(idle)
                continue
            # Recheck only the cheap transactional change token while idle.
            # A change during tick must also wake us; timed leases/retries still
            # get a bounded periodic check even without a database write.
            remaining = max_idle if revision else idle
            while remaining > 0:
                step = min(idle, 1, remaining)
                sleep(step)
                remaining -= step
                if heartbeat and int(max_idle-remaining) % 5 == 0:
                    try:
                        heartbeat()
                    except sqlite3.OperationalError as error:
                        if not is_database_busy(error):
                            raise
                        break
                if revision:
                    try:
                        if revision() != before:
                            break
                    except sqlite3.OperationalError as error:
                        if not is_database_busy(error):
                            raise
                        break
