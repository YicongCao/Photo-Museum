"""Metadata-only vocabulary worker. Does not import a model or a source client."""
import argparse
import time
from .db import Database
from .lexicon import LexiconWorker
from .worker_runtime import run_loop

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data',default='data/server');parser.add_argument('--once',action='store_true')
    args=parser.parse_args();worker=LexiconWorker(Database(args.data))
    def revision():
        with worker.db.connect() as c:
            return tuple(c.execute('SELECT catalog,work FROM runtime_revision WHERE id=1').fetchone()) + tuple(c.execute('SELECT building_generation FROM lexicon_state').fetchone()) + tuple(c.execute('SELECT token FROM lexicon_dirty LIMIT 1').fetchone() or ())
    def heartbeat():
        with worker.db.connect() as c:
            c.execute('UPDATE lexicon_state SET heartbeat=?', (time.time(),))
    run_loop(worker.tick,idle=2,once=args.once,revision=revision,heartbeat=heartbeat)

if __name__=='__main__':main()
