"""Metadata-only vocabulary worker. Does not import a model or a source client."""
import argparse
from .db import Database
from .lexicon import LexiconWorker
from .worker_runtime import run_loop

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data',default='data/server');parser.add_argument('--once',action='store_true')
    args=parser.parse_args();worker=LexiconWorker(Database(args.data))
    run_loop(worker.tick,idle=2,once=args.once)

if __name__=='__main__':main()
