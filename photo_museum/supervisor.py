"""Keep independent workers from taking the HTTP service down on exit."""
import subprocess
import time


def supervise(commands, env, stopping, *, popen=subprocess.Popen,
              clock=time.monotonic, sleep=time.sleep, log=print):
    processes = []
    deadlines = [0] * len(commands)
    failures = [0] * len(commands)
    started = [clock()] * len(commands)
    try:
        for command in commands:
            processes.append(popen(command, env=env))
        while not stopping():
            # A failed listener is fatal (for example, an occupied port).
            result = processes[0].poll()
            if result is not None:
                return result or 1
            now = clock()
            for index in range(1, len(commands)):
                child = processes[index]
                if child is not None and child.poll() is not None:
                    if now - started[index] >= 60:
                        failures[index] = 0
                    delay = min(30, 2 ** min(failures[index], 5))
                    failures[index] += 1
                    deadlines[index] = now + delay
                    processes[index] = None
                    # Only known module labels; never echo arguments or credentials.
                    log(f'Worker {index} exited; restart in {delay}s', flush=True)
                elif child is None and now >= deadlines[index] and not stopping():
                    processes[index] = popen(commands[index], env=env)
                    started[index] = now
            sleep(.25)
        return 0
    finally:
        for child in processes:
            if child is not None and child.poll() is None:
                child.terminate()
        for child in processes:
            if child is not None:
                try:
                    child.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait()
