"""omt_sync: periksa dan perbaiki unduhan pengukuran gardu (OMT) — lihat omt.py dan docs/83."""
import argparse
import glob
import os
import sys

import omt


def _paths(args):
    out = []
    for p in args.files:
        out += sorted(glob.glob(p)) or [p]
    return [p for p in out if os.path.basename(p).startswith("omt-pengukuran") or args.any_name]


def report(rows, per_file, dups, unit):
    lines = [f"Unit: {unit or 'semua'} | baris bersih: {len(rows)} | duplikat dibuang: {dups}"]
    for p, st in per_file.items():
        lines.append(f"\n{os.path.basename(p)}: judul {st['header_columns']} kolom, {st['rows']} baris dibaca")
        lines.append(f"  kosong dibuang {st['blank']} | unit lain dilewati {st['other_unit']} | dipertahankan {st['kept']} (tata letak lama {st['layout_lama']}, baru {st['layout_baru']})")
        lines.append(f"  baris bergeser/tanpa judul diperbaiki {st['shifted']} (unit ini) | lebar tak dikenal {st['bad_width']} | tanggal rusak {st['bad_date']} | waktu hilang {st['time_missing']} | tanggal≠waktu {st['date_vs_time_differ']}")
        lines.append(f"  format tanggal: ISO {st['fmt_iso']}, bulan/hari/tahun {st['fmt_us']} | duplikat {st['duplicate']}")
    by, low = omt.coverage(rows)
    months = omt.month_range(rows[0]["Waktu Pengukuran"][:7], rows[-1]["Waktu Pengukuran"][:7]) if rows else []
    lines.append("\nCakupan per ULP per bulan (jumlah pengukuran):")
    lines.append("ULP".ljust(16) + " ".join(m[2:] for m in months))
    for ulp in sorted(by):
        lines.append(ulp[:15].ljust(16) + " ".join(str(by[ulp].get(m, 0)).rjust(5) for m in months))
    if low:
        lines.append("\nBulan yang tampak belum lengkap (kosong atau < 50 % dari bulan biasa ULP itu; bulan terakhir = bulan berjalan, tidak dinilai):")
        for ulp, items in sorted(low.items()):
            lines.append(f"  {ulp}: " + ", ".join(f"{m} ({n} dari biasanya {med})" for m, n, med in items))
    else:
        lines.append("\nSemua bulan tampak lengkap.")
    return "\n".join(lines)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("command", choices=["check", "fix"])
    ap.add_argument("files", nargs="+", help="omt-pengukuran*.csv (boleh pola)")
    ap.add_argument("--unit", default="MOJOKERTO", help="Nama Unit (UP3); kosongkan dengan '' untuk semua")
    ap.add_argument("--out", default="out", help="folder keluaran untuk `fix`")
    ap.add_argument("--any-name", action="store_true")
    args = ap.parse_args(argv)
    rows, per_file, dups = omt.clean(_paths(args), args.unit or None)
    text = report(rows, per_file, dups, args.unit)
    print(text)
    if args.command == "fix":
        os.makedirs(args.out, exist_ok=True)
        name = f"omt-pengukuran-bersih-{(args.unit or 'semua').lower()}.csv"
        omt.write_csv(rows, os.path.join(args.out, name))
        with open(os.path.join(args.out, "laporan.txt"), "w", encoding="utf-8") as fh:
            fh.write(text + "\n")
        print(f"\nDitulis: {os.path.join(args.out, name)} ({len(rows)} baris) dan laporan.txt")
    return 0


if __name__ == "__main__":
    sys.exit(main())
