"""Local development/acceptance supervisor; no system service installation."""
import argparse
import os
from pathlib import Path
import signal
import subprocess
import sys
import time


def main():
    parser = argparse.ArgumentParser(description='Photo Museum API + independent scan worker')
    parser.add_argument('--data', default='data/server')
    parser.add_argument('--port', type=int, default=8790)
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        parser.error('port must be between 1024 and 65535')
    env = os.environ.copy()
    env['MUSEUM_DATA'] = str(Path(args.data).resolve())
    env['MUSEUM_HOSTS'] = f'127.0.0.1:{args.port},localhost:{args.port}'
    commands = [
        [sys.executable, '-m', 'uvicorn', 'photo_museum.api:create_app', '--factory', '--host', '127.0.0.1', '--port', str(args.port), '--no-access-log'],
        [sys.executable, '-m', 'photo_museum.worker', '--data', env['MUSEUM_DATA']],
    ]
    children = []
    stopping = False
    def stop(*_):
        nonlocal stopping
        stopping = True
    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    result = 0
    try:
        for cmd in commands:
            children.append(subprocess.Popen(cmd, env=env))
        while not stopping:
            failed = next((p for p in children if p.poll() is not None), None)
            if failed:
                result = failed.returncode or 1
                break
            time.sleep(.25)
    finally:
        for child in children:
            if child.poll() is None:
                child.terminate()
        for child in children:
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()
    return result

if __name__ == '__main__':
    sys.exit(main())
