"""maximo_sync: ubah respons laporan WO inspeksi gardu Maximo menjadi CSV bersih (tools/maximo_sync/README.md).

    python3 main.py parse "../samples/wo/*.json" --out out     # satu baris per WO -> out/maximo-wo-pengukuran.csv
"""
import argparse
import glob
import os
import sys

import wo


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("parse", help="baca berkas respons (SOAP BIRT atau HTML) dan tulis CSV")
    p.add_argument("pattern", help='pola berkas, mis. "../samples/wo/*.json"')
    p.add_argument("--out", default="out")
    a = ap.parse_args(argv)
    files = sorted(glob.glob(a.pattern))
    if not files:
        print("Tidak ada berkas cocok:", a.pattern)
        return 1
    records, skipped, seen = [], [], set()
    for f in files:
        with open(f, encoding="utf-8", errors="replace") as fh:
            found = wo.parse(fh.read())
        if not found:
            skipped.append(os.path.basename(f))
        for r in found:
            if r["wonum"] in seen:
                continue                                               # the same WO saved twice
            seen.add(r["wonum"])
            records.append(r)
    os.makedirs(a.out, exist_ok=True)
    path = os.path.join(a.out, "maximo-wo-pengukuran.csv")
    wo.write_csv(records, path)
    usable = [r for r in records if r["gardu"] and r["measured_at"] and r["jurusan"]]
    print(f"{len(files)} berkas, {len(records)} WO ({len(usable)} memuat pengukuran per jurusan), dilewati (bukan WO): {len(skipped)} {skipped[:5]}")
    print("Ditulis:", path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
