#!/usr/bin/env python3
"""Pasangan kode gardu - nomor GADIS dari DIL (.mdb), tanpa data pelanggan.

Hanya kolom UNITUP, NOMOR_GARDU, NAMA_GARDU yang dibaca (lewat mdb-export), lalu diringkas per gardu. Nomor GADIS = NOMOR_GARDU berpola GD514 + 6 angka; kode gardu (mis. HD0106)
dibaca dari NAMA_GARDU ("GAYAM-HA124", "BETEK HA070"). Pasangan yang tidak tegas (satu kode dengan dua nomor, atau satu nomor untuk dua kode) dibuang dan dilaporkan.

    python3 gadis_pairs.py ../samples/DIL_SALDO_MASK_UP_*.mdb --out pasangan-gadis.csv
Muat ke DISTRIVA: php artisan substations:load-gadis pasangan-gadis.csv [--dry-run]
"""
import argparse
import collections
import csv
import re
import subprocess
import sys

GADIS = re.compile(r'GD514\d{6}')
CODE = re.compile(r'\b(H[A-Z])\s?0*(\d{1,4})\b')


def pairs_of(mdb):
    table = subprocess.run(['mdb-tables', '-1', mdb], capture_output=True, text=True, check=True).stdout.split()[0]
    proc = subprocess.Popen(['mdb-export', mdb, table], stdout=subprocess.PIPE, text=True, encoding='utf-8', errors='replace')
    reader = csv.reader(proc.stdout)
    head = next(reader)
    ix = [head.index(k) for k in ('UNITUP', 'NOMOR_GARDU', 'NAMA_GARDU')]
    found = collections.defaultdict(collections.Counter)
    for row in reader:
        try:
            unit, no, name = (row[i].strip() for i in ix)
        except IndexError:
            continue
        m = CODE.search(name.upper())
        if GADIS.fullmatch(no) and m:
            found[(unit, m.group(1) + m.group(2).zfill(4))][no] += 1
    proc.wait()
    return found


def main():
    p = argparse.ArgumentParser()
    p.add_argument('mdb', nargs='+')
    p.add_argument('--out', required=True)
    a = p.parse_args()
    found = collections.defaultdict(collections.Counter)
    for f in a.mdb:
        for k, c in pairs_of(f).items():
            found[k].update(c)
    ambiguous = [k for k, c in found.items() if len(c) > 1]
    owner = collections.defaultdict(list)
    for k, c in found.items():
        if len(c) == 1:
            owner[next(iter(c))].append(k)
    shared = {no for no, ks in owner.items() if len(ks) > 1}
    kept = [(k, next(iter(c))) for k, c in found.items() if len(c) == 1 and next(iter(c)) not in shared]
    with open(a.out, 'w', newline='', encoding='utf-8') as fh:
        w = csv.writer(fh)
        w.writerow(['ulp_code', 'code', 'gadis_number'])
        for (unit, code), no in sorted(kept):
            w.writerow([unit, code, no])
    print(f'{len(kept)} pasangan ditulis; dibuang: {len(ambiguous)} kode dengan lebih dari satu nomor, {len(shared)} nomor untuk lebih dari satu kode', file=sys.stderr)
    for k in ambiguous:
        print('  ambigu', k, dict(found[k]), file=sys.stderr)
    return 0


if __name__ == '__main__':
    sys.exit(main())
