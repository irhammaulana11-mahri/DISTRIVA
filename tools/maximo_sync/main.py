"""maximo_sync: ubah respons laporan WO inspeksi gardu Maximo menjadi CSV bersih (tools/maximo_sync/README.md).

    python3 main.py parse "../samples/wo/*.json" --out out     # satu baris per WO -> out/maximo-wo-pengukuran.csv
    python3 main.py cek [--baris N]                            # login + buka daftar + jalankan laporan baris ke-N, tampilkan ringkasan (BELUM DIUJI ke server; lihat client.py)

Kredensial: MAXIMO_URL (mis. http://10.99.10.41), MAXIMO_USERNAME, MAXIMO_PASSWORD di lingkungan atau berkas .env (tidak di-commit).
"""
import argparse
import glob
import os
import sys

import wo


def _env():
    try:
        from dotenv import load_dotenv
        load_dotenv()
    except ImportError:
        pass
    miss = [k for k in ("MAXIMO_URL", "MAXIMO_USERNAME", "MAXIMO_PASSWORD") if not os.environ.get(k)]
    if miss:
        print("Isi dulu di lingkungan atau .env:", ", ".join(miss))
        return None
    return os.environ["MAXIMO_URL"], os.environ["MAXIMO_USERNAME"], os.environ["MAXIMO_PASSWORD"]


def cek(a):
    cfg = _env()
    if cfg is None:
        return 2
    import client
    m = client.MaximoClient(*cfg)
    steps = [("login", m.login), ("buka aplikasi", m.open_app)]
    try:
        for name, fn in steps:
            fn()
            print("OK  ", name)
        print("OK   id tabel daftar:", m.table or "(tidak ditemukan)")
        raw = m.report_of_row(a.baris)
        print("OK   laporan baris", a.baris, "diterima:", len(raw), "karakter")
    except (client.MaximoError, __import__("report").ReportError) as e:
        print("GAGAL", e)
        return 1
    found = wo.parse(raw)
    if not found:
        print("Laporan tidak memuat WO.")
        return 1
    os.makedirs(a.out, exist_ok=True)
    path = os.path.join(a.out, f"wo-{found[0]['wonum']}.xml")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(raw)
    r = found[0]
    print(f"WO {r['wonum']} gardu {r['gardu']} status {r['status']} jurusan {sorted(r['jurusan'])} diukur {r['measured_at']}; mentah: {path}")
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("parse", help="baca berkas respons (SOAP BIRT atau HTML) dan tulis CSV")
    p.add_argument("pattern", help='pola berkas, mis. "../samples/wo/*.json"')
    p.add_argument("--out", default="out")
    c = sub.add_parser("cek", help="uji satu WO dari daftar: login, klik baris, Run report, baca laporan")
    c.add_argument("--baris", type=int, default=0, help="baris daftar (0 = paling atas)")
    c.add_argument("--out", default="out")
    a = ap.parse_args(argv)
    if a.cmd == "cek":
        return cek(a)
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
