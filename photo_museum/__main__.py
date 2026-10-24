"""Local development/acceptance supervisor; no system service installation."""
import argparse
import importlib.util
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
    parser.add_argument('--host',default='127.0.0.1')
    parser.add_argument('--certfile')
    parser.add_argument('--keyfile')
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        parser.error('port must be between 1024 and 65535')
    env = os.environ.copy()
    env['MUSEUM_DATA'] = str(Path(args.data).resolve())
    env.setdefault('MUSEUM_HOSTS',f'127.0.0.1:{args.port},localhost:{args.port}')
    commands = [
        [sys.executable, '-m', 'uvicorn', 'photo_museum.api:create_app', '--factory', '--host', args.host, '--port', str(args.port), '--no-access-log'],
        [sys.executable, '-m', 'photo_museum.worker', '--data', env['MUSEUM_DATA']],
        [sys.executable, '-m', 'photo_museum.media_worker', '--data', env['MUSEUM_DATA']],
    ]
    if bool(args.certfile)!=bool(args.keyfile):
        parser.error('Provide both certfile and keyfile')
    if args.certfile:
        commands[0].extend(['--ssl-certfile',args.certfile,'--ssl-keyfile',args.keyfile])
    models = Path(os.environ.get('MUSEUM_MODELS', 'data/models')).resolve()
    env['MUSEUM_MODELS']=str(models)
    env['MUSEUM_ANALYSIS_ENABLED']='0'
    if (models / 'manifest.json').exists() and importlib.util.find_spec('timm'):
        env['MUSEUM_ANALYSIS_ENABLED']='1'
        commands.append([sys.executable, '-m', 'photo_museum.analysis_worker', '--data', env['MUSEUM_DATA'], '--models', str(models)])
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
