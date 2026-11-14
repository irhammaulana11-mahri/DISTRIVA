#!/usr/bin/env python3
"""Substation-load forecast: readings.csv + substations.csv -> result.json (see README.md)."""
import argparse
import sys

from distriva_forecast import pipeline


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument('--readings', required=True)
    p.add_argument('--substations', required=True)
    p.add_argument('--out', required=True)
    p.add_argument('--seeds', type=int, default=3)
    p.add_argument('--epochs', type=int, default=40)
    p.add_argument('--threads', type=int, default=None)
    p.add_argument('--fast', action='store_true', help='one seed, few epochs (smoke test)')
    a = p.parse_args()
    seeds, epochs = (1, 3) if a.fast else (a.seeds, a.epochs)
    try:
        result = pipeline.run(a.readings, a.substations, seeds=seeds, epochs=epochs, threads=a.threads, log=lambda m: print(m, flush=True))
    except ValueError as e:
        print(f'ERROR: {e}', file=sys.stderr)
        return 2
    pipeline.write(result, a.out)
    print(f"done in {result['seconds']} s: {result['counts']}", flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
