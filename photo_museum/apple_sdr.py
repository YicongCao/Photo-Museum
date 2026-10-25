"""Bounded local Apple SDR renderer. No original or full-size output survives a call."""
import fcntl
import hashlib
import json
import os
import platform
import shutil
import tempfile
from pathlib import Path
from PIL import Image


def available():
    return (platform.system() == 'Darwin' and int(platform.mac_ver()[0].split('.')[0]) >= 14
            and shutil.which('xcrun') is not None)


def executable(command):
    source = Path(__file__).with_name('native_sdr.swift')
    key = hashlib.sha256(source.read_bytes() + (platform.mac_ver()[0] + platform.machine()).encode()).hexdigest()[:20]
    root = Path(os.environ.get('MUSEUM_DATA', 'data/server')).resolve() / 'native-codecs'
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    binary = root / ('sdr-' + key)
    with (root / '.compile.lock').open('a+b') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if not binary.is_file():
            with tempfile.TemporaryDirectory(prefix='compile-', dir=root) as work:
                target = Path(work) / 'sdr'
                command(['xcrun', 'swiftc', '-O', str(source), '-o', str(target)], 180)
                target.chmod(0o700)
                target.replace(binary)
    return binary


def render(path, folder, command, max_edge=3840):
    binary = executable(command)
    with tempfile.TemporaryDirectory(prefix='apple-sdr-', dir=folder) as temporary:
        output = Path(temporary) / 'sdr.png'
        report = json.loads(command([str(binary), str(path), str(output), str(max_edge or 0)], 180))
        with Image.open(output) as decoded:
            if decoded.size != (report['width'], report['height']):
                raise ValueError('Native SDR dimensions mismatch')
            image = decoded.convert('RGB')
    return image, (report['sourceWidth'], report['sourceHeight'])
