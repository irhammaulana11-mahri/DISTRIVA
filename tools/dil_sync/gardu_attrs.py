#!/usr/bin/env python3
"""Atribut gardu dari DIL (.mdb) tanpa data pelanggan: ULP, nomor gardu, nama gardu, kapasitas trafo, penyulang, jenis, merek, dan nomor trafo, diringkas per kombinasi.

Hanya kolom UNITUP, NOMOR_GARDU, NAMA_GARDU, KAPASITAS_TRAFO, NAMA_PENYULANG, JENIS_TYPE_GARDU, BUATAN_TRAFO_GARDU, dan NO_TRAFO_GARDU yang dibaca (lewat mdb-export); setiap baris pelanggan
hanya menambah hitungan. Dipakai untuk membandingkan kapasitas trafo dan penyulang gardu di DISTRIVA dengan DIL (docs/85).

    python3 gardu_attrs.py ../samples/DIL_SALDO_MASK_UP_202609_*.mdb --out out/gardu-attrs-202609.csv
"""
import argparse
import collections
import csv
import subprocess
import sys

csv.field_size_limit(10 ** 8)
COLS = ('UNITUP', 'NOMOR_GARDU', 'NAMA_GARDU', 'KAPASITAS_TRAFO', 'NAMA_PENYULANG', 'JENIS_TYPE_GARDU', 'BUATAN_TRAFO_GARDU', 'NO_TRAFO_GARDU')


def read(mdb):
    table = subprocess.run(['mdb-tables', '-1', mdb], capture_output=True, text=True, check=True).stdout.split()[0]
    proc = subprocess.Popen(['mdb-export', mdb, table], stdout=subprocess.PIPE, text=True, encoding='utf-8', errors='replace')
    reader = csv.reader(proc.stdout)
    head = next(reader)
    ix = [head.index(c) for c in COLS]
    found = collections.Counter()
    for row in reader:
        found[tuple((row[i] if i < len(row) else '').strip() for i in ix)] += 1
    proc.wait()
    return found


def main():
    p = argparse.ArgumentParser()
    p.add_argument('mdb', nargs='+')
    p.add_argument('--out', required=True)
    a = p.parse_args()
    total = collections.Counter()
    for f in a.mdb:
        total.update(read(f))
    with open(a.out, 'w', newline='', encoding='utf-8') as fh:
        w = csv.writer(fh)
        w.writerow([c.lower() for c in COLS] + ['pelanggan'])
        for k, n in sorted(total.items()):
            w.writerow(list(k) + [n])
    print(f'{len(total)} kombinasi gardu ditulis ke {a.out}', file=sys.stderr)


if __name__ == '__main__':
    sys.exit(main())
