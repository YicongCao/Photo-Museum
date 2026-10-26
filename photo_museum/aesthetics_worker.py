"""Resumable aesthetics-only backfill. No NAS client and no face/technical rewrites."""
import argparse
from .db import Database
from .photography_worker import PhotographyWorker
from .worker_runtime import run_loop


class AestheticsWorker(PhotographyWorker):
    provider_id = 'aesthetics'
    steps = ('aesthetic',)
    profiles = ('display',)  # Never silently switch to thumb: trial showed preprocessing changes scores.


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data', default='data/server')
    parser.add_argument('--models', default='data/models')
    parser.add_argument('--once', action='store_true')
    args = parser.parse_args()
    from .aesthetics import LocalAesthetics
    worker = AestheticsWorker(Database(args.data), LocalAesthetics(args.models))
    run_loop(worker.tick, idle=2, once=args.once)


if __name__ == '__main__':
    main()
