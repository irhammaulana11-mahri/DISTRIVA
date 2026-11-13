#!/usr/bin/env python3
"""Extract the BOM sheets of the seven main groups from 'MASTER RAB & KKF.xlsx' as REVIEWABLE JSON (read-only; stdlib only;
formulas are read as text and never executed).

For each group one file OUT_DIR/bom_<GROUP>.json:
  {group, source, inputs:[{cell,group,label,kind:PSG|BKR}], lines:[{sequence,khs_code,description,H,I,J,K,source}],
   input_values:{cell:number}}
* sequence = the worksheet row number, so own-sheet references (I11, I13:I18, B13) keep their meaning inside DISTRIVA.
* H..K hold the formula text exactly as in the workbook (without '='); a constant (no formula) is written as its number.
* `params` declares GAMBAR cells that are NOT construction quantities but inputs from the drawing page (the commissioning-test
  volume, owner answer 2026-11-06): the formula is kept and the server turns the cell into {PARAM:<name>}. Any other such cell
  is dropped from the line and listed in `review` for a human decision, never guessed.
* inputs maps every GAMBAR quantity cell (Psg / Bkr of a labelled construction) to (group,label,kind); the server turns
  such references into {PSG:<code>} / {BKR:<code>} variables. Any other GAMBAR reference is reported and rejected there.
* input_values (numbers stored in GAMBAR) and each line's `expected` (results stored by Excel) are for golden tests only; the server ignores them.
Scope (owner decision 2026-11-06): SUTM, MVTIC, SUTR, SKTM, KUBIKEL, GTT_UMUM, GTT_KHUSUS (not PBPD, SKTR, SKSR, GD PSG DLM).

Usage: python3 -I tools/extract_bom_json.py "MASTER RAB & KKF.xlsx" OUT_DIR [GOLDEN.json.gz]
With GOLDEN.json.gz the seven documents are also written as one gzip file used by the backend end-to-end golden test
(backend/tests/fixtures/golden_bom_import.json.gz).
"""
import gzip, json, os, re, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "analysis"))
from wb import WB

GROUPS = {
    "SUTM": ("SUTM", "T", ("U", "V"), 6, 53), "MVTIC": ("MVTIC", "W", ("X", "Y"), 6, 34), "SUTR": ("SUTR", "W", ("X", "Y"), 36, 53),
    "SKTM": ("SKTM", "T", ("U", "V"), 55, 56), "KUBIKEL": ("KUBIKEL", "W", ("X", "Y"), 55, 56),
    "GTT_UMUM": ("GTT UMUM", "Z", ("AA", "AB"), 6, 23), "GTT_KHUSUS": ("GTT KHUSUS", "Z", ("AA", "AB"), 25, 39),
}

def num(v):
    try:
        f = float(v); return int(f) if f == int(f) else f
    except (TypeError, ValueError): return None

PBPD_SHEETS = {"PBPD_6_41": "APP LANGSUNG", "PBPD_53_197": "APP TAK LANGSUNG"}   # sheets renamed in the 2026-11-09 revision of the workbook (were "6,6-41,5 KVA" and "53-197 KVA")
CODE_IF = re.compile(r'^IF\(.*,\s*\d+\s*,\s*""\s*\)+$', re.S)
CODE_NUM = re.compile(r',\s*(\d+)\s*,\s*(?:IF\(|"")')

def cellval(g, ref):
    return (g.get(int(re.sub(r"\D", "", ref)), {}).get(re.sub(r"\d", "", ref)) or (None,))[0]

def pbpd_doc(wb, g, grp, sheet):
    """PBPD sheets (owner answers 2026-11-07): GAMBAR!Z50 = jenis pekerjaan, Z51:Z56 = range labels, AA/AB51:56 = counts, S55 = TUNAI/PLN
    become declared parameters (text or number); the fixed lists AD3:AD15 / AM6:AM10 become string constants. Column B of a row may be a
    formula IF(<range condition>, <KHS code>, "") -> kept as formula B plus the constant code. Anything else is reported, never guessed."""
    gref = re.compile(r"GAMBAR!\$?([A-Z]{1,3})\$?(\d+)")
    ranges = [cellval(g, f"AD{r}") for r in range(3, 15 + 1)]
    ranges = [" ".join(x.split()) for x in ranges if x]
    jenis = [" ".join(cellval(g, f"AM{r}").split()) for r in range(6, 11)]
    pay = [" ".join(str(cellval(g, f"AN{r}")).split()) for r in (6, 7)]
    params, consts = [], {}
    def txt(ref):
        v = cellval(g, ref); return " ".join(v.split()) if isinstance(v, str) else ""
    params.append({"cell": "Z50", "name": "PBPD:JENIS", "type": "text", "options": jenis, "default": txt("Z50"), "description": "Jenis pekerjaan (GAMBAR!Z50)"})
    params.append({"cell": "S55", "name": "PBPD:PEMBAYARAN", "type": "text", "options": pay, "default": txt("S55") or pay[0], "description": "TUNAI = material dibeli vendor pelaksana; PLN (GAMBAR!S55)"})
    for n, r in enumerate(range(51, 57), 1):
        params.append({"cell": f"Z{r}", "name": f"PBPD:RENTANG_{n}", "type": "text", "options": ranges, "default": txt(f"Z{r}"), "description": f"Rentang daya baris {n} (GAMBAR!Z{r})"})
        for col, kind in (("AA", "PSG"), ("AB", "BKR")):
            v = num(cellval(g, f"{col}{r}"))
            params.append({"cell": f"{col}{r}", "name": f"PBPD:{kind}_{n}", "type": "number", "default": v if v is not None else 0, "description": f"Jumlah {'pasang baru' if kind == 'PSG' else 'bongkar/perubahan'} baris {n} (GAMBAR!{col}{r})"})
    for r in range(3, 16):
        if cellval(g, f"AD{r}"): consts[f"AD{r}"] = " ".join(cellval(g, f"AD{r}").split())
    for r in range(6, 11): consts[f"AM{r}"] = " ".join(cellval(g, f"AM{r}").split())
    known = {p["cell"] for p in params} | set(consts)
    lines, review = [], []
    for r, cells in sorted(wb.load(sheet).items()):
        if r < 9: continue
        f, expected, bad = {}, {}, []
        for col in "BHIJK":
            c = cells.get(col)
            if c is None: continue
            if col != "B" and num(c[0]) is not None: expected[col] = num(c[0])
            if c[1]:
                text = c[1].strip().lstrip("=").lstrip("+")
                stray = [f"{a}{b}" for a, b in gref.findall(text) if f"{a}{b}" not in known]
                other = re.search(r"(?<!GAMBAR)!", text)
                if stray or other: bad.append({"column": col, "formula": text, "stray_cells": stray or ["sheet lain"]}); continue
                f[col] = text
            elif col != "B" and num(c[0]) is not None: f[col] = str(num(c[0]))
        if bad:
            review.append({"sequence": r, **{"items": bad}}); continue
        code = None
        if "B" in f:
            codes = [int(x) for x in CODE_NUM.findall(f["B"])]
            if not CODE_IF.match(f["B"]) or not codes: review.append({"sequence": r, "items": [{"column": "B", "formula": f["B"], "stray_cells": ["bentuk B tidak dikenal"]}]}); continue
            code = codes[0] if len(codes) == 1 else None
        else:
            b = (cells.get("B") or (None,))[0]
            code = int(b) if b and str(b).strip().isdigit() else None
        hik = {k: v for k, v in f.items() if k != "B"}
        if not hik and code is None: continue
        desc = " ".join(((cells.get("C") or (None,))[0] or "").split())
        line = {"sequence": r, "khs_code": code, "description": desc, **hik, "source": f"{sheet}!B{r}", "expected": expected}
        if "B" in f: line["B"] = f["B"]; line["khs_codes"] = codes
        lines.append(line)
    return {"group": grp, "source": f"MASTER RAB & KKF.xlsx / sheet {sheet}", "inputs": [], "lines": lines, "input_values": {}, "params": params, "constants": consts, "review": review}

def main(src, out, golden=None):
    wb = WB(src); g = wb.load("GAMBAR"); os.makedirs(out, exist_ok=True)
    all_docs = {}
    for grp, (sheet, lc, qcols, r0, r1) in GROUPS.items():
        inputs, values = [], {}
        for r in range(r0, r1 + 1):
            label = (g.get(r, {}).get(lc) or (None,))[0]
            if not label: continue
            label = " ".join(label.split())
            for q, kind in zip(qcols, ("PSG", "BKR")):
                inputs.append({"cell": f"{q}{r}", "group": grp, "label": label, "kind": kind})
                v = num((g.get(r, {}).get(q) or (None,))[0])
                values[f"{q}{r}"] = v if v is not None else 0
        known = {i["cell"] for i in inputs}
        gref = re.compile(r"GAMBAR!\$?([A-Z]{1,3})\$?(\d+)")
        lines, skipped, review, params = [], 0, [], {}
        for r, cells in sorted(wb.load(sheet).items()):
            if r < 9: continue
            f, expected = {}, {}
            for col in "HIJK":
                c = cells.get(col)
                if c is None: continue
                if num(c[0]) is not None: expected[col] = num(c[0])
                if c[1]:
                    text = c[1].strip().lstrip("=")
                    stray = [f"{a}{b}" for a, b in gref.findall(text) if f"{a}{b}" not in known]
                    if stray:
                        desc0 = " ".join(((cells.get("C") or (None,))[0] or "").split())
                        if "commis" in desc0.lower() and len(set(stray)) == 1:
                            # owner answer 2026-11-06: the commissioning-test volume is an INPUT read from the drawing page (GAMBAR);
                            # declared as a named parameter (default = the value stored in GAMBAR, 0 when empty)
                            cell0 = stray[0]
                            gv = num((g.get(int(re.sub(r"\D", "", cell0)), {}).get(re.sub(r"\d", "", cell0)) or (None,))[0])
                            params.setdefault(cell0, {"cell": cell0, "name": f"COMMISSIONING:{grp}", "default": gv if gv is not None else 0,
                                                      "description": f"Volume {desc0} (GAMBAR!{cell0}); diisi dari halaman gambar"})
                        else:   # refers to a GAMBAR cell that is not a construction quantity: reported for review, never guessed
                            review.append({"sequence": r, "column": col, "formula": text, "stored_value": num(c[0]), "stray_cells": stray,
                                           "gambar_values": {x: (g.get(int(re.sub(r"\D", "", x)), {}).get(re.sub(r"\d", "", x)) or (None,))[0] for x in stray}})
                            continue
                    f[col] = text
                elif num(c[0]) is not None: f[col] = str(num(c[0]))
            b = (cells.get("B") or (None,))[0]
            code = int(b) if b and str(b).strip().isdigit() else None
            if not f and code is None: skipped += 1; continue
            desc = " ".join(((cells.get("C") or (None,))[0] or "").split())
            lines.append({"sequence": r, "khs_code": code, "description": desc, **f, "source": f"{sheet}!B{r}", "expected": expected})
        doc = {"group": grp, "source": f"MASTER RAB & KKF.xlsx / sheet {sheet}", "inputs": inputs, "lines": lines, "input_values": values, "params": list(params.values()), "review": review}
        all_docs[grp] = doc
        with open(os.path.join(out, f"bom_{grp}.json"), "w", encoding="utf-8") as fh: json.dump(doc, fh, ensure_ascii=False, indent=1)
        print(f"{grp}: lines={len(lines)} (with KHS code {sum(1 for l in lines if l['khs_code'])}), formula cells={sum(1 for l in lines for c in 'HIJK' if c in l)}, inputs={len(inputs)}, skipped empty rows={skipped}, params={len(params)} ({", ".join(p["name"] + "=GAMBAR!" + p["cell"] for p in params.values())}), REVIEW (dropped)={len(review)}")
        for x in review: print("   review:", grp, x["sequence"], x["column"], x["formula"], "-> stored", x["stored_value"], "GAMBAR", x["gambar_values"])
    for grp, sheet in PBPD_SHEETS.items():
        doc = pbpd_doc(wb, g, grp, sheet); all_docs[grp] = doc
        with open(os.path.join(out, f"bom_{grp}.json"), "w", encoding="utf-8") as fh: json.dump(doc, fh, ensure_ascii=False, indent=1)
        print(f"{grp}: lines={len(doc['lines'])} dynamicB={sum(1 for l in doc['lines'] if 'B' in l)} params={len(doc['params'])} REVIEW (dropped)={len(doc['review'])}")
        for x in doc["review"]: print("   review:", grp, x["sequence"], json.dumps(x["items"], ensure_ascii=False)[:300])
    if golden:
        with gzip.open(golden, "wt", encoding="utf-8") as fh: json.dump(all_docs, fh, ensure_ascii=False, separators=(",", ":"))
        print("golden:", golden, os.path.getsize(golden), "bytes")

if __name__ == "__main__": main(*sys.argv[1:4])
