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


def run_loop(tick, *, idle=1, once=False, sleep=time.sleep, log=print):
    failures = 0
    while True:
        try:
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
            sleep(idle)
