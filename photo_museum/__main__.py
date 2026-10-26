"""Local development/acceptance supervisor; no system service installation."""
import argparse
import importlib.util
import os
from pathlib import Path
import signal
import sys
from .supervisor import supervise


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
    env['MUSEUM_PHOTOGRAPHY_ENABLED']='0'
    if (models/'photography/manifest.json').exists() and importlib.util.find_spec('open_clip'):
        env['MUSEUM_PHOTOGRAPHY_ENABLED']='1'
        commands.append([sys.executable,'-m','photo_museum.photography_worker','--data',env['MUSEUM_DATA'],'--models',str(models)])
    env['MUSEUM_AESTHETICS_ENABLED']='0'
    if (models/'aesthetics/head.safetensors').exists() and (models/'photography/manifest.json').exists() and importlib.util.find_spec('open_clip'):
        env['MUSEUM_AESTHETICS_ENABLED']='1'
        commands.append([sys.executable,'-m','photo_museum.aesthetics_worker','--data',env['MUSEUM_DATA'],'--models',str(models)])
    stopping = False
    def stop(*_):
        nonlocal stopping
        stopping = True
    commands.append([sys.executable,'-m','photo_museum.lexicon_worker','--data',env['MUSEUM_DATA']])
    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    return supervise(commands, env, lambda: stopping)

if __name__ == '__main__':
    sys.exit(main())
