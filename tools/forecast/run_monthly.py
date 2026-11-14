#!/usr/bin/env python3
"""Monthly demand forecast (customers, VA, material): series.csv + cutoff -> result.json (see README.md)."""
import argparse
import json
import sys

from distriva_forecast import monthly


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument('--series', required=True)
    p.add_argument('--cutoff', required=True, help='last complete month, YYYY-MM')
    p.add_argument('--out', required=True)
    p.add_argument('--seeds', type=int, default=3)
    p.add_argument('--epochs', type=int, default=120)
    p.add_argument('--threads', type=int, default=None)
    a = p.parse_args()
    result = monthly.run(a.series, a.cutoff, seeds=a.seeds, epochs=a.epochs, threads=a.threads, log=lambda m: print(m, flush=True))
    with open(a.out, 'w', encoding='utf-8') as fh:
        json.dump(result, fh, ensure_ascii=False)
    print(f"{result['status']} in {result['seconds']} s: {result['counts']}", flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
