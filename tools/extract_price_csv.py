#!/usr/bin/env python3
"""Extract the JASA sheet of 'MASTER RAB & KKF.xlsx' as the price-book CSV (read-only; stdlib only; no formula is executed).
Per row: kode (KHS code found by the SAME exact name the workbook's VLOOKUP uses: KHS!C -> KHS!B), nama, status_material (PLN when the
material price cell says PLN, else HARGA), harga_material, and z<N>_pasang / z<N>_bongkar for the zones present (workbook: 1, 2, 3, 5).
Rows whose name is not found in the KHS sheet are NOT guessed: they are listed on stderr and left out.
Usage: python3 -I tools/extract_price_csv.py "MASTER RAB & KKF.xlsx" OUT.csv
"""
import csv, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "analysis"))
from wb import WB

ZONES = {1: ("F", "G"), 2: ("H", "I"), 3: ("J", "K"), 5: ("L", "M")}

def num(v):
    try:
        f = float(v); return int(f) if f == int(f) else f
    except (TypeError, ValueError): return None

def tidy(s): return " ".join(str(s or "").split())

def main(src, out):
    wb = WB(src); khs = wb.load("KHS"); jasa = wb.load("JASA"); mdu = wb.load("MDU")
    by_name = {}
    for r, c in khs.items():
        code, name = (c.get("B") or (None,))[0], (c.get("C") or (None,))[0]
        if name and code and str(code).strip().isdigit(): by_name.setdefault(tidy(name), []).append(str(int(float(code))))
    insured = {}   # MDU: insured value = TOTAL (HS + transport) as stored by Excel, found by the same exact name (owner 2026-11-07: asuransi material PLN)
    for r, c in mdu.items():
        if r < 6: continue
        nm, g = tidy((c.get("C") or (None,))[0]), num((c.get("G") or (None,))[0])
        if nm and g and g > 0 and len(by_name.get(nm, [])) == 1: insured[by_name[nm][0]] = g
    rows, skipped = [], []
    for r, c in sorted(jasa.items()):
        if r < 7: continue
        name = tidy((c.get("C") or (None,))[0])
        if not name: continue
        codes = by_name.get(name, [])
        if len(codes) != 1: skipped.append((r, name, codes)); continue
        e = (c.get("E") or (None,))[0]
        pln = isinstance(e, str) and e.strip().upper() == "PLN"
        price = None if pln else num(e)
        if not pln and price is None: skipped.append((r, name, ["harga material bukan angka/PLN: %r" % e])); continue
        row = {"kode": codes[0], "nama": name, "status_material": "PLN" if pln else "HARGA", "harga_material": "" if pln else price, "nilai_asuransi": insured.get(codes[0], "")}
        for z, (ci, cb) in ZONES.items():
            i, b = num((c.get(ci) or (None,))[0]), num((c.get(cb) or (None,))[0])
            row[f"z{z}_pasang"] = "" if i is None else i
            row[f"z{z}_bongkar"] = "" if b is None else b
        rows.append(row)
    cols = ["kode", "nama", "status_material", "harga_material", "nilai_asuransi"] + [f"z{z}_{k}" for z in ZONES for k in ("pasang", "bongkar")]
    with open(out, "w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=cols); w.writeheader(); w.writerows(rows)
    print(f"{len(rows)} baris ditulis ke {out}; {len(skipped)} baris dilewati (tidak dapat dipetakan ke satu kode KHS)", file=sys.stderr)
    for s in skipped[:30]: print("  dilewati:", s, file=sys.stderr)

if __name__ == "__main__": main(*sys.argv[1:3])
