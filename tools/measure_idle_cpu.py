"""Read-only process CPU deltas; private evidence stays under data/ by default.

Run with the same visible page and task state before/after. GPU telemetry is
whole-device data, never a measurement of one browser page.
"""
import argparse
import json
from pathlib import Path
import plistlib
import sqlite3
import statistics
import subprocess
import time


def processes(supervisor):
    rows = {}
    for line in subprocess.check_output(['ps', '-Ao', 'pid=,ppid=,time=,rss=,args='], text=True).splitlines():
        parts = line.strip().split(None, 4)
        if len(parts) != 5:
            continue
        pid, parent, elapsed, rss, command = parts
        if int(pid) != supervisor and int(parent) != supervisor:
            continue
        role = 'supervisor' if int(pid) == supervisor else (
            'api' if '-m uvicorn photo_museum.api' in command else
            command.split('-m ', 1)[-1].split()[0])
        seconds = sum(float(n) * 60 ** i for i, n in enumerate(reversed(elapsed.split(':'))))
        rows[int(pid)] = dict(role=role, seconds=seconds, rss_mib=int(rss)/1024)
    return rows


def database_state(directory):
    with sqlite3.connect((Path(directory)/'catalog.sqlite').resolve().as_uri()+'?mode=ro', uri=True) as db:
        return {
            'media_jobs': dict(db.execute('SELECT status,count(*) FROM media_jobs GROUP BY status')),
            'completion_max': db.execute('SELECT max(id) FROM file_completions').fetchone()[0],
            'recent_analysis': list(db.execute('SELECT provider,count(*) FROM analysis WHERE updated>? GROUP BY provider', (time.time()-60,))),
        }


def device_gpu():
    try:
        nodes = plistlib.loads(subprocess.check_output(['ioreg', '-a', '-l', '-r', '-c', 'IOAccelerator']))
        return [n['PerformanceStatistics'].get('Device Utilization %') for n in nodes if 'PerformanceStatistics' in n]
    except (OSError, subprocess.CalledProcessError):
        return []


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pid', type=int)
    parser.add_argument('--data', default='data/server')
    parser.add_argument('--seconds', type=float, default=60)
    parser.add_argument('--interval', type=float, default=2)
    parser.add_argument('--output', required=True, help='Use an ignored directory under data/')
    args = parser.parse_args()
    if args.seconds <= 0 or args.interval <= 0:
        parser.error('Durations must be positive')
    pid = args.pid or int(Path('data/service/8790.pid').read_text())
    output = Path(args.output); output.mkdir(parents=True, exist_ok=True)
    initial = database_state(args.data); previous = processes(pid)
    if not previous:
        parser.error('Supervisor not running')
    started = last = time.monotonic(); samples = []
    while time.monotonic()-started < args.seconds:
        time.sleep(min(args.interval, max(0, args.seconds-(time.monotonic()-started))))
        current = processes(pid); now = time.monotonic(); dt = now-last
        samples.append({'interval': dt, 'processes': [dict(pid=p, **v, cpu=max(0, (v['seconds']-previous[p]['seconds'])/dt*100)) for p, v in current.items() if p in previous], 'whole_device_gpu': device_gpu()})
        previous = current; last = now
    summary = []
    for p in sorted({r['pid'] for s in samples for r in s['processes']}):
        rows = [(r, s['interval']) for s in samples for r in s['processes'] if r['pid'] == p]
        summary.append({'pid': p, 'role': rows[0][0]['role'], 'cpu_percent': round(sum(r['cpu']*dt for r, dt in rows)/sum(dt for _, dt in rows), 3)})
    gpu = [n for s in samples for n in s['whole_device_gpu'] if n is not None]
    result = {'seconds': last-started, 'processes': summary, 'total_cpu_percent': round(sum(r['cpu_percent'] for r in summary), 3), 'gpu_whole_device_mean_not_page': statistics.mean(gpu) if gpu else None, 'db_before': initial, 'db_after': database_state(args.data)}
    (output/'samples.json').write_text(json.dumps(samples, indent=2))
    (output/'summary.json').write_text(json.dumps(result, indent=2))
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
