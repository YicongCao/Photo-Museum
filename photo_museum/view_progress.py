"""Bounded, ephemeral progress of on-demand originals; never stored in the index."""
from collections import OrderedDict
import threading
import time


class ViewProgress:
    def __init__(self):
        self.items = OrderedDict()
        self.lock = threading.Lock()

    def report(self, key, stage, done=0, total=None):
        with self.lock:
            now = time.monotonic()
            self.items[key] = (now, {'stage': stage, 'done': done, 'total': total})
            self.items.move_to_end(key)
            while self.items and (len(self.items) > 64 or next(iter(self.items.values()))[0] < now-600):
                self.items.popitem(last=False)

    def read(self, key):
        with self.lock:
            value = self.items.get(key)
            return dict(value[1]) if value and value[0] >= time.monotonic()-600 else None
