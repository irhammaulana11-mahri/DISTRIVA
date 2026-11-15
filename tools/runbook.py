#!/usr/bin/env python3
"""Skrip bantu runbook DISTRIVA (docs/85-RUNBOOK-PENYIAPAN-DAN-PERUBAHAN-RUMUS.md).

Hanya pustaka standar Python. Skrip ini TIDAK menulis ke database, TIDAK menjalankan tools/rebuild/rebuild_clean.php (yang menghapus data), dan tidak mengirim apa pun ke luar.
Yang ditulisnya hanya ke tools/output/regen/<waktu>/ (hasil ekstraksi sementara), fixture tes golden, dan venv forecast bila diminta.

  python3 tools/runbook.py check                 periksa lingkungan dan berkas sumber
  python3 tools/runbook.py extract [--ulp KODE]  ekstrak Excel master -> terjemahkan kode lama ke kode baru -> bandingkan dengan data yang berlaku
  python3 tools/runbook.py golden                bangun ulang fixture golden BOM, lalu jalankan tes rumus PHP
  python3 tools/runbook.py forecast-venv [--install]   periksa (atau buat) venv forecast: torch, numpy, lightgbm
  python3 tools/runbook.py preflight             php artisan distriva:preflight (kesiapan produksi)
  python3 tools/runbook.py tests [--full]        tes Python forecast + tes PHP untuk rumus (--full: seluruh tes backend, lama)
"""
import argparse
import csv
import datetime
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TOOLS = ROOT / "tools"
BACKEND = ROOT / "backend"
OUTPUT = TOOLS / "output"
REBUILD = OUTPUT / "rebuild"
VENV_PY = TOOLS / "forecast" / ".venv" / "bin" / "python"
WORKBOOKS = {"rab": "MASTER RAB & KKF.xlsx", "tarif": "MASTER TARIF & JAM NYALA.xlsx"}

csv.field_size_limit(10 ** 8)
FAILS = 0


def say(level, text):
    global FAILS
    FAILS += level == "GAGAL"
    print(f"[{level:<5}] {text}")


def run(cmd, cwd=None, quiet=False):
    """Menjalankan perintah (daftar argumen, tanpa shell). Mengembalikan (kode, keluaran)."""
    try:
        p = subprocess.run([str(c) for c in cmd], cwd=cwd, capture_output=True, text=True, timeout=1800)
    except (OSError, subprocess.TimeoutExpired) as e:
        return 127, str(e)
    out = (p.stdout or "") + (p.stderr or "")
    if not quiet and out.strip():
        print(out.rstrip())
    return p.returncode, out


def candidates(key, first="samples"):
    """Salinan Excel master yang ada. Ada dua salinan dengan lembar berbeda: tools/samples (lebih baru; ada lembar APP untuk SR 1 fasa) dan akar proyek (ada lembar PBPD '6,6-41,5 KVA' dan '53-197 KVA' untuk tes golden)."""
    order = [TOOLS / "samples", ROOT] if first == "samples" else [ROOT, TOOLS / "samples"]
    return [b / WORKBOOKS[key] for b in order if (b / WORKBOOKS[key]).is_file()]


def sheet_names(path):
    import re
    import zipfile
    with zipfile.ZipFile(path) as z:
        return set(re.findall(r'<sheet [^>]*name="([^"]+)"', z.read("xl/workbook.xml").decode("utf-8")))


# ---------------------------------------------------------------- check
def cmd_check(_a):
    py = sys.version_info
    say("OK" if py >= (3, 10) else "GAGAL", f"Python {py.major}.{py.minor} (perlu 3.10+)")
    for exe, need, why in (("php", True, "backend"), ("composer", True, "dependensi backend"), ("node", True, "frontend"), ("npm", True, "frontend"),
                           ("mdb-export", False, "membaca DIL .mdb (apt install mdbtools)"), ("chromium", False, "PDF dokumen (atau google-chrome)")):
        found = shutil.which(exe) or (shutil.which("google-chrome") if exe == "chromium" else None)
        say("OK" if found else ("GAGAL" if need else "PERINGATAN"), f"{exe}: {found or 'tidak ditemukan'} ({why})")
    if VENV_PY.exists():
        code, out = run([VENV_PY, "-c", "import torch, numpy, lightgbm; print(torch.__version__, numpy.__version__, lightgbm.__version__)"], quiet=True)
        say("OK" if code == 0 else "GAGAL", f"venv forecast: {out.strip().splitlines()[-1] if out.strip() else 'tidak dapat dijalankan'}" if code == 0 else "venv forecast ada tapi pustaka kurang (jalankan: forecast-venv --install)")
    else:
        say("PERINGATAN", "venv forecast belum ada (forecast tidak bisa jalan): jalankan 'forecast-venv --install'")
    for key, name in WORKBOOKS.items():
        copies = candidates(key)
        if not copies:
            say("GAGAL", f"{name} tidak ditemukan (tools/samples atau akar proyek)")
            continue
        say("OK", f"{name}: " + ", ".join(str(c.relative_to(ROOT)) for c in copies))
        if len(copies) == 2:
            only0, only1 = sheet_names(copies[0]) - sheet_names(copies[1]), sheet_names(copies[1]) - sheet_names(copies[0])
            if only0 or only1:
                say("PERINGATAN", f"dua salinan {name} memuat lembar berbeda: hanya di {copies[0].parent.name}: {sorted(only0)}; hanya di {copies[1].parent.name}: {sorted(only1)}. Ekstraksi memakai tools/samples dulu, tes golden akar proyek dulu; sebaiknya digabung (docs/85 bagian C)")
    for rel in ("tools/output/rebuild/peta_kode_lama_baru.csv", "tools/output/rebuild/khs_new.csv", "tools/output/rebuild/price_book_new.csv", "tools/output/rebuild/mappings_new.csv"):
        say("OK" if (ROOT / rel).is_file() else "GAGAL", f"{rel}")
    say("OK" if (BACKEND / ".env").is_file() else "GAGAL", "backend/.env (salin dari .env.example lalu isi; jangan di-commit)")
    if (BACKEND / "vendor").is_dir():
        code, out = run(["php", "artisan", "--version"], cwd=BACKEND, quiet=True)
        say("OK" if code == 0 else "GAGAL", f"artisan: {out.strip()}")
    else:
        say("GAGAL", "backend/vendor tidak ada (jalankan: composer install)")
    say("OK" if (ROOT / "frontend" / "node_modules").is_dir() else "PERINGATAN", "frontend/node_modules (npm install bila belum)")
    print("\nSiap." if FAILS == 0 else f"\n{FAILS} hal harus dibereskan dulu.")
    return 1 if FAILS else 0


# ---------------------------------------------------------------- extract + translate + compare
def read_csv(path):
    with open(path, newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def cmd_extract(a):
    rabs, tarifs = candidates("rab"), candidates("tarif")
    if not rabs:
        say("GAGAL", f"{WORKBOOKS['rab']} tidak ditemukan")
        return 1
    out = OUTPUT / "regen" / datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    out.mkdir(parents=True, exist_ok=True)
    steps = [("KHS", "extract_khs_csv.py", rabs, lambda w: [w, out / "khs.csv"]), ("Buku harga", "extract_price_csv.py", rabs, lambda w: [w, out / "price.csv"]),
             ("Jenis konstruksi", "extract_construction_csv.py", rabs, lambda w: [w, out]), ("BOM", "extract_bom_json.py", rabs, lambda w: [w, out])]
    if tarifs:
        steps.append(("Tarif", "extract_tariff_csv.py", tarifs, lambda w: [w, out / "tariff.csv"] + (["--ulp", a.ulp] if a.ulp else [])))
    for label, script, wbs, args in steps:
        for w in wbs:                                           # the first copy that the extractor can read completely is used
            code, text = run(["python3", "-I", TOOLS / script] + args(w), quiet=True)
            if code == 0:
                say("OK", f"ekstrak {label} dari {w.parent.name}/{w.name}")
                break
        else:
            say("GAGAL", f"ekstrak {label}: {text.strip().splitlines()[-1][:160] if text.strip() else 'gagal'} (lembar yang dibutuhkan tidak ada di salinan mana pun)")
            return 1
    report = compare(out)
    (out / "laporan.txt").write_text("\n".join(report) + "\n", encoding="utf-8")
    print("\n".join(report))
    print(f"\nHasil mentah (kode LAMA) dan laporan: {out.relative_to(ROOT)}/  — tidak ada yang diubah di database.")
    return 0


def compare(out):
    """Bandingkan hasil ekstraksi dengan data yang berlaku (tools/output/rebuild/*_new.csv dan bom_*.json). Kode di Excel masih kode lama; diterjemahkan lewat peta_kode_lama_baru.csv."""
    cmap = {r["kode_lama"]: r["kode_baru"] for r in read_csv(REBUILD / "peta_kode_lama_baru.csv")}
    lines = ["== Perbandingan dengan data yang berlaku =="]

    def untranslated(codes, what):
        miss = sorted({c for c in codes if c and c not in cmap}, key=lambda x: (len(x), x))
        if miss:
            lines.append(f"  ! {len(miss)} kode {what} di Excel belum punya kode baru (perlu keputusan pemilik, lihat runbook bagian B): {', '.join(miss[:15])}{' …' if len(miss) > 15 else ''}")

    # KHS
    cur = {r["code"]: r for r in read_csv(REBUILD / "khs_new.csv")}
    new = read_csv(out / "khs.csv")
    untranslated([r["code"] for r in new], "KHS")
    tidy = lambda v: " ".join((v or "").split())  # noqa: E731  (spasi ganda tidak dihitung sebagai perubahan)
    changed = [(cmap[r["code"]], cur[cmap[r["code"]]]["name"], r["name"]) for r in new if r["code"] in cmap and cmap[r["code"]] in cur and (tidy(cur[cmap[r["code"]]]["name"]), tidy(cur[cmap[r["code"]]]["unit"])) != (tidy(r["name"]), tidy(r["unit"]))]
    gone = sorted(set(cur) - {cmap.get(r["code"]) for r in new})
    lines.append(f"KHS: Excel {len(new)} baris, berlaku {len(cur)}; nama/satuan berubah {len(changed)}; ada di sistem tapi tidak di Excel {len(gone)}")
    lines += [f"    {c}: '{o[:50]}' -> '{n[:50]}'" for c, o, n in changed[:8]]
    # Buku harga
    cur = {r["kode"]: r for r in read_csv(REBUILD / "price_book_new.csv")}
    new = read_csv(out / "price.csv")
    untranslated([r["kode"] for r in new], "harga")
    price_cols = [c for c in new[0] if c in cur[next(iter(cur))]] if new and cur else []
    diff = []
    for r in new:
        code = cmap.get(r["kode"])
        if code in cur:
            d = [c for c in price_cols if c.endswith(("_pasang", "_bongkar")) or c == "harga_material" if _num(cur[code].get(c)) != _num(r.get(c))]       # status dan nilai MDU ditetapkan pemilik pada bangun ulang, tidak dibandingkan
            d and diff.append((code, d))
    lines.append(f"Buku harga: Excel {len(new)} baris; harga berubah di {len(diff)} baris (catatan: perbaikan sesudah bangun ulang, mis. tiang beton JTMR934 dan nilai MDU, hanya ada di database dan akan tampak sebagai selisih)")
    lines += [f"    {c}: {', '.join(d[:4])}" for c, d in diff[:8]]
    # Pemetaan konstruksi
    cur = {(r["group"], r["label"], r["khs_code"]) for r in read_csv(REBUILD / "mappings_new.csv")}
    new_rows = read_csv(out / "construction_mappings.csv")
    untranslated([r["khs_code"] for r in new_rows], "pemetaan konstruksi")
    new = {(r["group"], r["label"], cmap.get(r["khs_code"], r["khs_code"])) for r in new_rows}
    lines.append(f"Pemetaan konstruksi: Excel {len(new)}, berlaku {len(cur)}; baru di Excel {len(new - cur)}, hilang dari Excel {len(cur - new)}")
    lines += [f"    + {g} | {lab} | {k}" for g, lab, k in sorted(new - cur)[:6]] + [f"    - {g} | {lab} | {k}" for g, lab, k in sorted(cur - new)[:6]]
    # BOM (kode lama di kedua sisi)
    for f in sorted(out.glob("bom_*.json")):
        old_f = OUTPUT / f.name
        if not old_f.is_file():
            lines.append(f"BOM {f.stem[4:]}: baru (belum ada di tools/output)")
            continue
        key = lambda d: {l["sequence"]: (l.get("khs_code"), l.get("H"), l.get("I"), l.get("J"), l.get("K")) for l in d["lines"]}  # noqa: E731
        a_, b_ = key(json.load(open(old_f, encoding="utf-8"))), key(json.load(open(f, encoding="utf-8")))
        ch = [s for s in a_ if s in b_ and a_[s] != b_[s]]
        lines.append(f"BOM {f.stem[4:]}: baris {len(a_)} -> {len(b_)}; rumus/kode berubah {len(ch)}; baru {len(set(b_) - set(a_))}; hilang {len(set(a_) - set(b_))}")
    lines.append("\nLangkah berikut bila ada perubahan: lihat docs/85 bagian B (impor lewat layar/API oleh akun berbeda, lalu `golden`).")
    return lines


def _num(v):
    try:
        return round(float(v), 4)
    except (TypeError, ValueError):
        return (v or "").strip()


# ---------------------------------------------------------------- golden / venv / preflight / tests
def cmd_golden(_a):
    fixture = BACKEND / "tests" / "fixtures" / "golden_bom.json.gz"
    for rab in candidates("rab", first="root"):
        code, text = run(["python3", "-I", TOOLS / "golden_vectors.py", rab, fixture], quiet=True)
        if code == 0:
            say("OK", f"vektor golden dari {rab.parent.name}/{rab.name}")
            break
    else:
        say("GAGAL", "golden_vectors.py tidak dapat membaca salinan Excel mana pun (butuh lembar '6,6-41,5 KVA' dan '53-197 KVA')")
        return 1
    say("OK", f"fixture ditulis: {fixture.relative_to(ROOT)}")
    code, _ = run(["php", "artisan", "test", "--compact", "tests/Unit/FormulaGoldenWorkbookTest.php"], cwd=BACKEND)
    return code


def cmd_venv(a):
    if not VENV_PY.exists():
        if not a.install:
            say("PERINGATAN", "venv forecast belum ada. Tambahkan --install untuk membuatnya.")
            return 1
        code, _ = run(["python3", "-m", "venv", VENV_PY.parents[1]])
        if code != 0:
            return 1
    if a.install:
        req = TOOLS / "forecast" / "requirements.txt"
        code, _ = run([VENV_PY, "-m", "pip", "install", "-r", req, "--index-url", "https://download.pytorch.org/whl/cpu", "--extra-index-url", "https://pypi.org/simple"])
        if code != 0:
            return 1
    code, out = run([VENV_PY, "-c", "import torch, numpy, lightgbm; print('torch', torch.__version__, '| numpy', numpy.__version__, '| lightgbm', lightgbm.__version__)"], quiet=True)
    say("OK" if code == 0 else "GAGAL", out.strip().splitlines()[-1] if out.strip() else "pustaka belum lengkap")
    return code


def cmd_preflight(_a):
    return run(["php", "artisan", "distriva:preflight"], cwd=BACKEND)[0]


def cmd_tests(a):
    codes = []
    if VENV_PY.exists():
        codes.append(run([VENV_PY, "-m", "unittest", "discover", "-s", TOOLS / "forecast" / "tests", "-p", "test_*.py"], cwd=TOOLS / "forecast")[0])
    codes.append(run(["php", "artisan", "test", "--compact"] + ([] if a.full else ["tests/Unit/FormulaGoldenWorkbookTest.php", "tests/Feature/MasterDataBomTest.php", "tests/Feature/Sr1phBomTest.php"]), cwd=BACKEND)[0])
    return 1 if any(codes) else 0


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("check")
    e = sub.add_parser("extract")
    e.add_argument("--ulp", help="kode ULP untuk tarif (jam nyala berasal dari satu ULP), mis. 51453")
    sub.add_parser("golden")
    v = sub.add_parser("forecast-venv")
    v.add_argument("--install", action="store_true")
    sub.add_parser("preflight")
    t = sub.add_parser("tests")
    t.add_argument("--full", action="store_true")
    a = p.parse_args()
    return {"check": cmd_check, "extract": cmd_extract, "golden": cmd_golden, "forecast-venv": cmd_venv, "preflight": cmd_preflight, "tests": cmd_tests}[a.cmd](a)


if __name__ == "__main__":
    sys.exit(main())
