"""Isolated on-demand converter, terminated as a group when a viewer leaves."""
import sys
from pathlib import Path
from .media import metadata, still, MediaUnsupported


def main():
    source, outputs = map(Path, sys.argv[1:3])
    try:
        still(source, outputs, metadata(source), compatible=True)
    except MediaUnsupported:
        return 2
    return 0


if __name__ == '__main__':
    sys.exit(main())
