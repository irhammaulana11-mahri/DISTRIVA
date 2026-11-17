"""maximo_sync: ubah respons laporan WO inspeksi gardu Maximo menjadi CSV bersih (tools/maximo_sync/README.md).

    python3 main.py parse "../samples/wo/*.json" --out out     # satu baris per WO -> out/maximo-wo-pengukuran.csv
    python3 main.py cek [--baris N]                            # login + buka daftar + jalankan laporan baris ke-N, tampilkan ringkasan (BELUM DIUJI ke server; lihat client.py)

Kredensial: MAXIMO_URL (mis. http://10.99.10.41), MAXIMO_USERNAME, MAXIMO_PASSWORD di lingkungan atau berkas .env (tidak di-commit).
"""
import argparse
import csv
import glob
import os
import re
import sys
import threading
import time
from datetime import datetime, timedelta

import wo


def _load_env(path=".env"):
    """KEY=VALUE per baris dari .env di folder alat ini (tanpa pustaka tambahan); nilai di lingkungan yang sudah ada tidak ditimpa, tanda kutip luar dibuang."""
    here = os.path.join(os.path.dirname(os.path.abspath(__file__)), path)
    if not os.path.isfile(here):
        return
    with open(here, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            v = v.strip()
            if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
                v = v[1:-1]
            os.environ.setdefault(k.strip(), v)


def _env():
    _load_env()
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
        cols = {2: a.filter, **({8: a.status} if a.status else {})}
        rows = len(set(re.findall(r"_tdrow_\[C:1\]_ttxt-lb\[R:(\d+)\]", m.filter_rows(cols))))
        print(f"OK   filter Description '{a.filter}' Status '{a.status}': {rows} baris pada halaman pertama")
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


def _list_all(m, a):
    """Seluruh baris daftar yang cocok dengan filter, halaman demi halaman."""
    since = a.sejak or (datetime.now() - timedelta(days=365)).strftime("%d/%m/%Y")
    cols = {2: a.filter, **({8: a.status} if a.status else {}), 15: f">={since}"}
    answer = m.filter_rows(cols)
    info = m.page_info(answer)
    total = info[2] if info else 0
    rows = m.rows_of(answer)
    print(f"Daftar: {total} WO cocok (Description '{a.filter}', Status '{a.status}', tanggal status >= {since})")
    while info and info[1] < info[2]:
        answer = m.next_page()
        new = m.rows_of(answer)
        info = m.page_info(answer)
        if not new:
            break
        rows += new
        if len(rows) % 1000 < 20:
            print(f"  ... {len(rows)}/{total}")
    return rows




def ambil(a):
    import client
    import plan
    from concurrent.futures import ThreadPoolExecutor
    cfg = _env()
    if cfg is None:
        return 2
    os.makedirs(a.raw, exist_ok=True)
    os.makedirs(a.out, exist_ok=True)

    def session():
        m = client.MaximoClient(*cfg)
        m.login()
        m.open_app()
        return m

    try:
        m0 = session()
        rows = _list_all(m0, a)
    except client.MaximoError as e:
        print("GAGAL", e)
        return 1
    with open(os.path.join(a.out, "daftar-wo.csv"), "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=["row", "wonum", "description", "work_type", "location", "owner", "unit", "status", "reported", "status_date"])
        w.writeheader()
        w.writerows(rows)
    done = {f[3:-4] for f in os.listdir(a.raw) if f.startswith("wo-") and f.endswith(".xml")}
    todo = plan.choose(rows, latest_per_gardu=not a.semua, done=done)
    if a.maks:
        todo = todo[:a.maks]
    print(f"{len(rows)} baris daftar, {len(todo)} WO diambil ({'semua' if a.semua else 'terbaru per gardu'}), {len(done)} sudah ada di {a.raw}/")
    failed, counter = [], {"n": 0}
    lock = threading.Lock()
    chunks = [todo[i::max(1, a.pekerja)] for i in range(max(1, a.pekerja))]

    def work(chunk, first):
        m = m0 if first else None
        for r in chunk:
            for attempt in (1, 2, 3):
                try:
                    m = m or session()
                    raw = m.report_of_wonum(r["wonum"])
                    with open(os.path.join(a.raw, f"wo-{r['wonum']}.xml"), "w", encoding="utf-8") as fh:
                        fh.write(raw)
                    break
                except (client.MaximoError, __import__("report").ReportError, __import__("requests").RequestException) as e:
                    m = None                                                   # new login on the next attempt
                    if attempt == 3:
                        with lock:
                            failed.append((r["wonum"], str(e)))
            with lock:
                counter["n"] += 1
                if counter["n"] % 25 == 0 or counter["n"] == len(todo):
                    print(f"  {counter['n']}/{len(todo)} WO, gagal {len(failed)}", flush=True)
            a.jeda and time.sleep(a.jeda)

    t0 = time.time()
    with ThreadPoolExecutor(max_workers=max(1, a.pekerja)) as ex:
        list(ex.map(lambda ic: work(ic[1], ic[0] == 0), enumerate(chunks)))
    print(f"Selesai {time.time() - t0:.0f} detik; gagal {len(failed)}")
    if failed:
        with open(os.path.join(a.out, "gagal.txt"), "w", encoding="utf-8") as fh:
            fh.writelines(f"{w}\t{e}\n" for w, e in failed)
        print("Daftar gagal:", os.path.join(a.out, "gagal.txt"), "- jalankan lagi untuk mengulang (yang sudah ada dilewati)")
    return main(["parse", os.path.join(a.raw, "*.xml"), "--out", a.out]) if todo or done else 0


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("parse", help="baca berkas respons (SOAP BIRT atau HTML) dan tulis CSV")
    p.add_argument("pattern", help='pola berkas, mis. "../samples/wo/*.json"')
    p.add_argument("--out", default="out")
    g = sub.add_parser("ambil", help="ambil laporan banyak WO (daftar terfilter -> terbaru per gardu -> simpan mentah ke raw/ -> CSV)")
    g.add_argument("--sejak", help="tanggal status paling awal, dd/mm/yyyy (bawaan: 365 hari lalu)")
    g.add_argument("--filter", default="INSPEKSI GARDU")
    g.add_argument("--status", default="COMP")
    g.add_argument("--semua", action="store_true", help="semua WO, bukan hanya yang terbaru per gardu")
    g.add_argument("--maks", type=int, default=0, help="batasi jumlah WO yang diambil (0 = semua)")
    g.add_argument("--pekerja", type=int, default=1, help="jumlah sesi login paralel (bawaan 1)")
    g.add_argument("--jeda", type=float, default=0.0, help="jeda detik antar WO per sesi")
    g.add_argument("--raw", default="raw")
    g.add_argument("--out", default="out")
    c = sub.add_parser("cek", help="uji satu WO dari daftar: login, klik baris, Run report, baca laporan")
    c.add_argument("--baris", type=int, default=0, help="baris daftar (0 = paling atas)")
    c.add_argument("--filter", default="INSPEKSI GARDU", help="teks kolom Description pada filter daftar")
    c.add_argument("--status", default="COMP", help="teks kolom Status pada filter daftar (COMP = selesai; kosongkan dengan '')")
    c.add_argument("--out", default="out")
    a = ap.parse_args(argv)
    if a.cmd == "cek":
        return cek(a)
    if a.cmd == "ambil":
        return ambil(a)
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
