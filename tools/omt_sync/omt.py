"""Pengukuran gardu (OMT, unduhan Maximo) -> berkas bersih yang siap dimuat ke DISTRIVA (docs/80, docs/83).

Masalah yang ditemukan pada unduhan 2022-2026 dan diperbaiki di sini (tanpa mengubah berkas asli):
1. **Kolom bergeser / tanpa judul.** Berkas 2022-1 s.d. 2023-1 berjudul 60 kolom (jurusan a-d dan u), tetapi sebagian barisnya memuat 108 isian (jurusan a-p dan u): 48 isian lebih banyak daripada judul,
   sehingga `nhf_idt` (judul terakhir) berisi data kolom lain dan sisanya tanpa judul. Tiap baris dibaca menurut lebarnya sendiri (60 = tata letak lama, 108 = tata letak baru) dan ditulis ke 108 kolom baku.
2. **Format tanggal campuran.** Sebagian berkas memakai `2024-06-30 05:54:38`, sebagian `6/29/2024 22:56` (bulan/hari/tahun hasil simpan Excel). Semuanya dijadikan `YYYY-MM-DD` dan `YYYY-MM-DD HH:MM:SS`.
3. **Baris kosong** (2023-2 berisi ~965 ribu baris kosong sisa Excel) dibuang.
4. **Duplikat** antar berkas (mis. 30 Juni muncul di dua berkas) dibuang: kunci = nama aset + waktu pengukuran.
5. **Tata letak lama di dalam 108 kolom.** Sebagian baris 2023-2 (Juli-Desember 2023) berlebar 108 tetapi isinya tata letak lama 60 kolom yang tidak digeser: tegangan (vrn..vtr) jatuh ke kolom jurusan f/g,
   nilai NH fuse ke jurusan g/h/i, dan 48 kolom terakhir kosong. Dikenali dari isinya (lihat `_padded_old_layout`) dan dibaca sebagai tata letak lama, sehingga arus per jurusan dan tegangan pangkal benar.
6. **Cakupan**: laporan per ULP per bulan menandai bulan yang jauh di bawah biasanya (data belum lengkap).
"""
import csv
import re
from collections import Counter, defaultdict
from datetime import datetime

csv.field_size_limit(10 ** 9)

BASE = ["Nama Unit", "Nama ULP", "Nama Penyulang", "Nama Aset", "Latitude Aset", "Longitude Aset", "Konstruksi Aset", "Kapasitas Aset", "Tanggal Pengukuran", "Waktu Pengukuran",
        "Underload", "Overload", "Critical Load", "Undervoltage", "Overvoltage", "Unbalance", "Over Arus Netral", "Beban Trafo", "Pembebanan Trafo", "Delta Arus",
        "Jumlah Temuan NHFuse", "Rating NHFuse Seharusnya"]
CUR_OLD = [f"i{j}{p}" for j in "abcd" for p in "nrst"]
CUR_NEW = [f"i{j}{p}" for j in "abcdefghijklmnop" for p in "nrst"]
CUR_U = [f"iu{p}" for p in "nrst"]
VOLT = ["vrn", "vrs", "vsn", "vst", "vtn", "vtr"]
NHF = [f"nhf_i{j}{p}" for j in "abcd" for p in "rst"]
OLD = BASE + CUR_OLD + CUR_U + VOLT + NHF          # 60 kolom
NEW = BASE + CUR_NEW + CUR_U + VOLT + NHF          # 108 kolom
assert len(OLD) == 60 and len(NEW) == 108
CANONICAL = NEW
_US = re.compile(r"^(\d{1,2})/(\d{1,2})/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$")
_ISO = re.compile(r"^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?")


def parse_dt(value):
    """'2024-06-30 05:54:38' | '6/29/2024 22:56' | '2024-06-30' -> (datetime, kind) or (None, None). kind: iso | us. Bulan/hari/tahun untuk format bergaris miring (Excel AS)."""
    v = (value or "").strip()
    m = _ISO.match(v)
    if m:
        y, mo, d, h, mi, s = m.groups()
        kind = "iso"
    else:
        m = _US.match(v)
        if not m:
            return None, None
        mo, d, y, h, mi, s = m.groups()
        kind = "us"
    try:
        return datetime(int(y), int(mo), int(d), int(h or 0), int(mi or 0), int(s or 0)), kind
    except ValueError:
        return None, None


def _num(v):
    try:
        float(v)
        return True
    except (TypeError, ValueError):
        return False


def _padded_old_layout(row):
    """A 108-wide row that really holds the old 60-column layout (Excel padded it without shifting): the last 48 cells are empty while the cells that the new layout calls jurusan f/g (positions 42-47)
    hold the base voltages (phase-neutral ~180-260 V at 42/44/46, phase-phase ~310-450 V at 43/45/47)."""
    if len(row) != len(NEW) or any(c.strip() for c in row[len(OLD):]):
        return False
    def v(i):
        try:
            return float(row[i])
        except (TypeError, ValueError):
            return None
    pn, pp = [v(i) for i in (42, 44, 46)], [v(i) for i in (43, 45, 47)]
    return sum(1 for x in pn if x is not None and 150 <= x <= 300) >= 2 and sum(1 for x in pp if x is not None and 250 <= x <= 480) >= 2


def read_file(path, unit=None, stats=None):
    """Yields canonical dict rows (CANONICAL keys + `_source`, `_layout`, `_time_missing`) of one file; counts what it repaired into `stats` (Counter-like dict)."""
    st = stats if stats is not None else Counter()
    with open(path, newline="", encoding="utf-8-sig", errors="replace") as fh:
        reader = csv.reader(fh)
        header = next(reader)
        st["header_columns"] = len(header)
        for row in reader:
            st["rows"] += 1
            if not any(c.strip() for c in row):
                st["blank"] += 1
                continue
            width = len(row)
            padded = False
            if width == len(OLD):
                names, layout = OLD, "lama"
            elif width == len(NEW):
                if _padded_old_layout(row):
                    names, layout = OLD, "lama"
                    row = row[:len(OLD)]
                    padded = True
                else:
                    names, layout = NEW, "baru"
            else:
                st["bad_width"] += 1
                continue
            d = {c: "" for c in CANONICAL}
            d.update({k: v.strip() for k, v in zip(names, row)})
            if unit and d["Nama Unit"].upper() != unit.upper():
                st["other_unit"] += 1
                continue
            if padded:
                st["padded_old"] += 1                                  # (unit yang dipilih)
            if width != len(header):
                st["shifted"] += 1                                    # baris lebih lebar/sempit daripada judulnya: data bergeser / tanpa judul (dihitung untuk unit yang dipilih)
            at, kind_t = parse_dt(d["Waktu Pengukuran"])
            day, kind_d = parse_dt(d["Tanggal Pengukuran"])
            d["_time_missing"] = False
            if at is None and day is not None:
                at, d["_time_missing"] = day, True
                st["time_missing"] += 1
            if at is None:
                st["bad_date"] += 1
                continue
            if day is not None and day.date() != at.date():
                st["date_vs_time_differ"] += 1
            st["fmt_" + (kind_t or kind_d or "none")] += 1
            d["Tanggal Pengukuran"] = at.strftime("%Y-%m-%d")
            d["Waktu Pengukuran"] = at.strftime("%Y-%m-%d %H:%M:%S")
            for c in ("Kapasitas Aset", "Beban Trafo", "vrn", "vsn", "vtn"):
                if d[c] != "" and not _num(d[c]):
                    st["non_numeric_" + c] += 1
            d["_source"], d["_layout"] = path, layout
            st["kept"] += 1
            st["layout_" + layout] += 1
            yield d


def clean(paths, unit=None):
    """Reads all files, repairs, de-duplicates by (asset, time) (the later file wins). Returns (rows sorted by time, per-file stats, duplicates)."""
    per_file, seen, dups = {}, {}, 0
    for p in paths:
        st = Counter()
        per_file[p] = st
        for d in read_file(p, unit, st):
            key = (d["Nama ULP"].upper(), d["Nama Aset"].upper(), d["Waktu Pengukuran"])
            if key in seen:
                dups += 1
                st["duplicate"] += 1
            seen[key] = d
    rows = sorted(seen.values(), key=lambda d: (d["Waktu Pengukuran"], d["Nama Aset"]))
    return rows, per_file, dups


def month_range(first, last):
    y, m = int(first[:4]), int(first[5:7])
    out = []
    while (y, m) <= (int(last[:4]), int(last[5:7])):
        out.append(f"{y:04d}-{m:02d}")
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def coverage(rows):
    """{ulp: {YYYY-MM: count}} and the months that look incomplete: no data at all, or < 50 % of that ULP's median month. The last month of the data is the running month and is not judged."""
    by = defaultdict(Counter)
    for d in rows:
        by[d["Nama ULP"]][d["Waktu Pengukuran"][:7]] += 1
    low = defaultdict(list)
    if not rows:
        return by, low
    months = month_range(rows[0]["Waktu Pengukuran"][:7], rows[-1]["Waktu Pengukuran"][:7])
    for ulp, counts in by.items():
        vals = sorted(counts.values())
        med = vals[len(vals) // 2]
        for m in months[:-1]:
            n = counts.get(m, 0)
            if n < 0.5 * med:
                low[ulp].append((m, n, med))
    return by, low


def write_csv(rows, path):
    with open(path, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(CANONICAL)
        for d in rows:
            w.writerow([d[c] for c in CANONICAL])
