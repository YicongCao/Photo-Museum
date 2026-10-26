"""Small transactionally updated tokens; no cache-touch/heartbeat invalidation."""
def revision(database, lane='work'):
    if lane not in ('work', 'catalog'):
        raise ValueError('Unknown revision lane')
    with database.connect() as c:
        return c.execute(f'SELECT {lane} FROM runtime_revision WHERE id=1').fetchone()[0]


def heartbeat(database, worker_id):
    import time
    with database.connect() as c:
        c.execute('INSERT OR REPLACE INTO workers VALUES(?,?)', (worker_id, time.time()))
