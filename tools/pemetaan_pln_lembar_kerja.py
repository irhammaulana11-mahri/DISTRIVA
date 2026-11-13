#!/usr/bin/env python3
"""Lembar kerja pemetaan KHS <-> SKU ERP untuk material berstatus PLN (read-only; stdlib only).

Bahan masukan (diekspor dari database, lihat docs/62 §45):
  KHS_CSV       kolom: code,name,unit,mapped            (KHS berstatus PLN yang dipakai BOM)
  MATERIALS_CSV kolom: code,name,unit,spec,mapped       (katalog ERP: tabel materials)
Keluaran: lembar kerja CSV (UTF-8 BOM, mudah dibuka di Excel) dengan tiga kandidat teratas per KHS dan kolom kosong `no_material` untuk diisi teknisi.
Satu KHS boleh punya beberapa SKU (isi satu baris per SKU saat mengimpor); satu SKU hanya boleh menunjuk satu KHS. Hanya SARAN: tidak ada yang diimpor. Kecocokan spesifikasi (kVA, mm2, kV, A, grup vektor) harus diperiksa orang; pemetaan yang salah menaruh stok pada KHS yang salah.
Pemakaian: python3 -I tools/pemetaan_pln_lembar_kerja.py KHS_CSV MATERIALS_CSV OUT.csv
"""
import csv
import re
import sys

# Aturan istilah: regex pada nama KHS -> regex yang harus dipenuhi nama material ERP (singkatan katalog ERP: TRF DIS, CUB, LA, MTR;kWH, LVSB, ...)
PHRASES = [
    (r"trafo distribusi", r"^TRF DIS;"),
    (r"kubikel", r"^CUB;"),
    (r"arrester", r"^LA;"),
    (r"cut ?out", r"^CUT OUT;"),
    (r"kwh meter", r"^MTR;kWH"),
    (r"lvsb", r"^LVSB;"),
    (r"nyy", r"NYY"),
    (r"na2xsey", r"NA2XSEYBY"),
    (r"nfa2x", r"NFA2X"),
    (r"preformed (side|top)", r"TIE"),
    (r"steel wire", r"STEEL WIRE"),
    (r"cover silicon", r"^UNIV ACC;COVER|^CUT OUT ACC;COVER|COVER"),
    (r"termination", r"^TERM;"),
    (r"insulator", r"ISOLATOR|INSULATOR"),
    (r"disconnecting", r"SWITCH"),
    (r"current transformer|\(ct\)", r"^CT;"),
    (r"^aco\b", r"SWITCH TRANSFER AUTOMATIC"),
    (r"segel", r"SEGEL|SEAL"),
    (r"clamp", r"CLAMP|CONN;"),
    (r"gembok", r"LOCK|GEMBOK"),
]
# kata penting tambahan yang dicocokkan persis (grup vektor trafo, bahan, jenis kubikel)
KEYWORDS = ["yzn5", "dyn5", "polymer", "porcelain", "lbs", "metering", "motorized", "motorize", "amr", "cws", "ug", "tm", "tr"]


# Keputusan pemilik 8 Nov 2026: kubikel paket (KHS 187 dan 189: LBS incoming + metering + out going) sengaja TIDAK dipetakan; barang diminta baru setelah pelanggan membayar,
# jadi tidak dialokasikan dari stok gudang. Alokasi hanya memeriksa baris yang dipilih petugas, jadi kebutuhan kubikel pada MTO cukup tidak dialokasikan.
EXCLUDED = {"187", "189"}


def norm(text):
    t = text.lower().replace(",", ".")
    t = re.sub(r"(\d)\s*x\s*(\d)", r"\1x\2", t)           # 3 x 150 -> 3x150
    t = re.sub(r"(\d)\s*(mm2|sqmm|mm|kva|kv|va|ka|a)\b", r"\1", t)
    return t


def numbers(text):
    return set(re.findall(r"\d+(?:\.\d+)?(?:x\d+(?:\.\d+)?)*", norm(text)))


def words(text):
    return set(re.findall(r"[a-z][a-z0-9]+", norm(text)))


def score(khs_name, mat_name):
    k, m = khs_name.lower(), mat_name
    phrase = 0.0
    for pat, need in PHRASES:
        if re.search(pat, k) and re.search(need, m, re.I):
            phrase = 0.45
            break
    kn, mn = numbers(khs_name), numbers(mat_name)
    num = (len(kn & mn) / len(kn)) if kn else 0.0
    kw = words(khs_name) & words(mat_name) & set(KEYWORDS)
    jac = len(words(khs_name) & words(mat_name)) / max(1, len(words(khs_name) | words(mat_name)))
    # bahan/ukuran yang jelas berbeda menurunkan nilai: angka KHS tak ditemukan sama sekali pada material
    s = phrase + 0.35 * num + 0.1 * min(1.0, len(kw)) + 0.1 * jac
    return round(min(s, 1.0), 2), phrase > 0, kn <= mn if kn else False


def main(argv):
    if len(argv) != 4:
        print(__doc__, file=sys.stderr)
        return 2
    khs = list(csv.DictReader(open(argv[1], encoding="utf-8")))
    mats = list(csv.DictReader(open(argv[2], encoding="utf-8")))
    header = ["kode_khs", "nama_khs", "satuan_khs", "sudah_dipetakan"]
    for i in (1, 2, 3):
        header += [f"kandidat{i}_sku", f"kandidat{i}_nama", f"kandidat{i}_satuan", f"kandidat{i}_skor"]
    header += ["keyakinan", "no_material", "catatan"]
    out = []
    for k in khs:
        if k["mapped"] == "1" or k["code"] in EXCLUDED:      # sudah dipetakan atau sengaja dikecualikan: tidak masuk lembar kerja
            continue
        ranked = sorted(((score(k["name"], m["name"]), m) for m in mats), key=lambda x: (-x[0][0], x[1]["code"]))
        top = [(s, m) for s, m in ranked[:3] if s[0] >= 0.3]
        row = [k["code"], k["name"], k["unit"], "ya" if k["mapped"] == "1" else ""]
        for s, m in top:
            row += [m["code"], m["name"], m["unit"], s[0]]
        row += ["", "", "", ""] * (3 - len(top))
        best = top[0][0] if top else None
        gap = (top[0][0][0] - top[1][0][0]) if len(top) > 1 else 1.0
        if not top:
            label = "TIDAK ADA KANDIDAT"
        elif best[1] and best[2] and best[0] >= 0.7 and gap >= 0.05:
            label = "TINGGI"                     # satu kandidat jelas unggul dan semua angka spesifikasi cocok
        elif best[1] and best[2] and best[0] >= 0.7:
            label = "VARIAN SERUPA"              # beberapa SKU hampir identik: pilih/isi lebih dari satu baris bila semuanya sah
        else:
            label = "PERIKSA"
        row += [label, "", ""]
        out.append(row)
    with open(argv[3], "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(out)
    from collections import Counter
    print(len(out), "baris;", dict(Counter(r[-3] for r in out)))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
