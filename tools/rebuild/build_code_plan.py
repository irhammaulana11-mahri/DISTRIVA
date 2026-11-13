#!/usr/bin/env python3
"""Builds the KHS code plan of the clean rebuild (docs/62 §52, owner decisions 2026-11-09). Needs openpyxl (not stdlib). Reads only; writes
tools/output/rebuild/code_plan.csv (one row per existing KHS) and tools/output/rebuild/sr1_khs_baru.csv (new KHS items of the APP 1 PHASA sheet).

Code rule (all KHS):
  1. the KHS has a counterpart row in the 'Master Material' sheet of kkfsetuju_PABRIKBITINGMARJONO.xlsx (same normalised name, or a close name with the same
     specification numbers; a counterpart is used by ONE KHS only, an exact name wins) -> that row's 'Kode Material' (JTMR..., A..., or an ERP number it already carries);
  2. otherwise a NEW code: 'A' + next number when the material belongs to the categories Peralatan Kerja (CAT-08), Catu Daya & Sumber Energi (CAT-09) or
     APD & Keselamatan Kerja di Luar ERP (CAT-11) of Master-Material-Subkategori-PLN-ERP-Rev2.xlsx, else 'JTMR' + next number. Never an ERP material number (owner).
Name / MDU value: a PLN material that has a counterpart of type MDU takes the workbook's name and value (0 = still empty); everything else keeps the DISTRIVA data.
Owner exceptions: KHS 215 and 508 are never matched (look-alike is wrong). New numbers continue after the highest code of the workbook (JTMR 735, A 630).
Usage: python tools/rebuild/build_code_plan.py   (paths are fixed to the project)
"""
import csv, difflib, json, os, re
import openpyxl

ROOT = "/media/data/PROJECT/DISTRIVA"
OUT = f"{ROOT}/tools/output/rebuild"
REJECT = {"215", "508"}
A_CATEGORIES = {"CAT-08", "CAT-09", "CAT-11"}
A_WORDS = re.compile(r"safety|k3l?\b|\bapd\b|helm|sarung tangan|baterai|accu|\baki\b|genset|generator|charger", re.I)


def tidy(s): return " ".join(str(s or "").split())
def norm(s): return tidy(s).lower().replace("sqmm", "mm2").replace("mm²", "mm2").replace("phs", "phasa")
def key(s): return re.sub(r"[^a-z0-9]", "", norm(s))
def spec(s): return sorted(re.findall(r"(\d+(?:[.,]\d+)?)\s*(kva|mm2|mm|ka|kv|a|v|x)\b", norm(s)))
def num(v):
    try: return float(v)
    except (TypeError, ValueError): return None


def main():
    x = json.load(open(f"{OUT}/export.json", encoding="utf-8"))
    khs = x["khs"]; items = x["price_book"]["items"]
    mm = openpyxl.load_workbook(f"{ROOT}/tools/samples/kkfsetuju_PABRIKBITINGMARJONO.xlsx", read_only=True, data_only=True)["Master Material"]
    rows = [r for i, r in enumerate(mm.iter_rows(min_row=1, max_row=700, max_col=9, values_only=True), 1) if i >= 4 and r[2] and r[1] not in (None, "")]
    idx = {key(r[2]): r for r in rows}; keys = list(idx)
    max_j = max(int(m.group(1)) for r in rows for m in [re.fullmatch(r"JTMR(\d+)", str(r[1]))] if m)
    max_a = max(int(m.group(1)) for r in rows for m in [re.fullmatch(r"A(\d+)", str(r[1]))] if m)
    erp = [r for r in openpyxl.load_workbook(f"{ROOT}/tools/samples/Master-Material-Subkategori-PLN-ERP-Rev2.xlsx", read_only=True, data_only=True)["TEMPLATE IMPORT ERP"].iter_rows(min_row=4, values_only=True) if r[0]]
    erp_key = {key(r[1]): r for r in erp}; erp_keys = list(erp_key)

    # 1. counterparts (one KHS per workbook row; exact names first)
    match = {}
    for old, k in sorted(khs.items(), key=lambda kv: int(kv[0])):
        if old in REJECT: continue
        r = idx.get(key(k["name"]))
        if r is not None: match[old] = (r, "NAMA SAMA")
    taken = {str(v[0][1]) for v in match.values()}
    for old, k in sorted(khs.items(), key=lambda kv: int(kv[0])):
        if old in REJECT or old in match: continue
        for c in difflib.get_close_matches(key(k["name"]), keys, n=3, cutoff=0.8):
            r = idx[c]
            if str(r[1]) in taken: continue
            if spec(k["name"]) == spec(r[2]): match[old] = (r, "NAMA MIRIP, SPESIFIKASI SAMA"); taken.add(str(r[1])); break

    # 2. new codes for the rest
    nj, na = max_j, max_a
    plan = []
    for old, k in sorted(khs.items(), key=lambda kv: int(kv[0])):
        p = items.get(old) or {}
        status, insured = p.get("status"), p.get("insured")
        cat = ""
        if old in match:
            r, how = match[old]
            code = str(r[1]); name = tidy(k["name"]); mdu = insured
            if status == "PLN" and str(r[3]).strip().upper() == "MDU":
                name = tidy(r[2]); mdu = num(r[4]) or ""
                asal = "MARJONO"
            elif status == "PLN":
                asal = "DISTRIVA (di Marjono bukan MDU)"
            else:
                asal = "KODE MARJONO, DATA DISTRIVA"
        else:
            how = "KODE BARU"
            e = erp_key.get(key(k["name"]))
            if e is None:
                c = difflib.get_close_matches(key(k["name"]), erp_keys, n=1, cutoff=0.62)
                e = erp_key[c[0]] if c else None
            cat = e[4] if e else ""
            if cat in A_CATEGORIES or A_WORDS.search(k["name"]): na += 1; code = f"A{na}"
            else: nj += 1; code = f"JTMR{nj}"
            name = tidy(k["name"]); mdu = insured; asal = "DISTRIVA (kode baru)"
        plan.append([old, code, name, status or "", mdu if mdu is not None else "", asal, how, cat])
    # PLN materials of the APP 1 PHASA sheet that exist in KHS but have no MDU value: the sheet's value fills the gap (owner: KHS data first, the sheet where KHS has none)
    sheet_mdu = {"212": 20000, "213": 20000, "507": 4120}
    for row in plan:
        if row[0] in sheet_mdu and row[4] == "":
            row[4] = sheet_mdu[row[0]]; row[5] += " + MDU dari lembar APP 1 PHASA"
    os.makedirs(OUT, exist_ok=True)
    with open(f"{OUT}/code_plan.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f); w.writerow(["kode_lama", "kode_baru", "nama_baru", "status_material", "mdu", "asal", "cara", "kategori_erp"]); w.writerows(plan)

    # 3. new KHS items of the APP 1 PHASA sheet (existing KHS are reused: 374, 396, 212, 507, 183, 213)
    # APP 1 PHASA after the owner's restructure (2026-11-09 20:05): only SDES-1 and SDES-2; MCB and kWh meter stay ONE item each (the rating is chosen at allocation: one KHS may map to several ERP SKUs);
    # price column of the sheet decides the status: G = PLN (MDU value), H = TUNAI (vendor); 'Angkutan Material' and the other eight activities are dropped (owner).
    new = [("Strainhook / ekor babi", "B", "HARGA", 11000, "", ""),
           ("Conn. press AL/AL type 10-16 mm2 / 50-70 mm2  + Scoot + Cover", "B", "PLN", "", 20000, ""),
           ("Conn. press AL/AL type 10-16 mm2 / 10-16 mm2  +  Scoot + Cover", "B", "HARGA", 9650, "", ""),
           ("Bundl.Cond.3x50 + 1x35 mm - 50 cm ( kumis )", "B", "HARGA", 7000, "", ""),
           ("Segel Plastik", "B", "HARGA", 770, "", ""),
           ("Paku Beton", "B", "HARGA", 165, "", ""),
           ("kWh Meter Electronic 1 Phs (Pasca/Prabayar)", "S", "PLN", "", 262394, ""),
           ("Jasa Kegiatan Pasang Baru SDES - 1 ( SR 1 Phasa, tarikan Tiang ke Plgg )", "B", "HARGA", 0, "", 110000),
           ("Jasa Kegiatan Pasang Baru SDES - 2 ( SR 1 Phasa, tarikan Plgg ke Plgg )", "B", "HARGA", 0, "", 98500)]
    with open(f"{OUT}/sr1_khs_baru.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f); w.writerow(["kode_baru", "nama", "satuan", "status_material", "harga_material", "mdu", "harga_jasa_pasang"])
        for n, u, s, hm, mdu, jp in new:
            nj += 1
            w.writerow([f"JTMR{nj}", n, u, s, hm, mdu, jp])
    from collections import Counter
    print("kode lama -> baru:", dict(Counter(p[6] for p in plan)))
    print("asal:", dict(Counter(p[5] for p in plan)))
    print(f"kode baru JTMR {max_j + 1}..{nj} (termasuk {len(new)} butir SR 1), A {max_a + 1}..{na}")
    print("kategori A:", [(p[1], p[2][:40], p[7]) for p in plan if p[1].startswith("A") and p[6] == "KODE BARU"][:20])


if __name__ == "__main__":
    main()
