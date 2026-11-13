#!/usr/bin/env python3
"""Extract construction types and their KHS mappings from 'MASTER RAB & KKF.xlsx' as REVIEWABLE CSV proposals.

Standard library only; read-only; formulas are read as text and never executed. Scope (owner decision 2026-11-06): the
seven main groups SUTM, MVTIC, SUTR, SKTM, KUBIKEL, GTT_UMUM, GTT_KHUSUS. NOT included: PBPD (separate iteration) and the
broken legacy sheets SKTR, SKSR, GD PSG DLM (and the "Estetika" block that belongs to them).

How a mapping is derived: every BOM row (numeric KHS code in column B) of a group's sheet is traced through its volume
formulas (columns I and J, following references to other rows) to the cells of sheet GAMBAR it depends on; each such cell
belongs to one labelled construction. Relation: DIRECT = depends on exactly one construction, SHARED = several (e.g. an
aggregate such as total poles), FIXED = none (group-level items such as K3L, commissioning, insurance: written to
fixed_items.csv, they belong to the group's BOM, not to a construction).

Mappings that repeat a KHS code inside one construction are merged into one row (note says so).

Usage: python3 -I tools/extract_construction_csv.py "MASTER RAB & KKF.xlsx" OUT_DIR
Writes OUT_DIR/construction_types.csv, construction_mappings.csv, fixed_items.csv.
"""
import collections, csv, os, re, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "analysis"))
from wb import WB, n2col  # noqa: E402

# group -> (BOM sheet, label column, quantity columns, first GAMBAR row, last GAMBAR row)
GROUPS = {
    "SUTM": ("SUTM", "T", ("U", "V"), 6, 53),
    "MVTIC": ("MVTIC", "W", ("X", "Y"), 6, 34),
    "SUTR": ("SUTR", "W", ("X", "Y"), 36, 53),
    "SKTM": ("SKTM", "T", ("U", "V"), 55, 56),
    "KUBIKEL": ("KUBIKEL", "W", ("X", "Y"), 55, 56),
    "GTT_UMUM": ("GTT UMUM", "Z", ("AA", "AB"), 6, 23),
    "GTT_KHUSUS": ("GTT KHUSUS", "Z", ("AA", "AB"), 25, 39),
}
G_REF = re.compile(r"GAMBAR!\$?([A-Z]{1,2})\$?(\d+)")
OWN_RANGE = re.compile(r"(?<![A-Za-z0-9_!.])\$?([A-Z]{1,2})\$?(\d+):\$?([A-Z]{1,2})\$?(\d+)")
OWN_REF = re.compile(r"(?<![A-Za-z0-9_!.:])\$?([A-Z]{1,2})\$?(\d+)(?![A-Za-z0-9_(:])")


def main(src, out):
    wb, g = WB(src), None
    g = wb.load("GAMBAR")
    os.makedirs(out, exist_ok=True)
    types, maps, fixed = [], [], []
    khs = {int(c["B"][0]) for r, c in wb.load("KHS").items() if r >= 6 and (c.get("B") or (None,))[0] and c["B"][0].strip().isdigit()}

    # which GAMBAR cell belongs to which construction: (quantity column, row) -> (group, label, label cell)
    owner = {}
    for grp, (_, lc, qcols, r0, r1) in GROUPS.items():
        for r in range(r0, r1 + 1):
            label = (g.get(r, {}).get(lc) or (None,))[0]
            if not label:
                continue
            label = " ".join(label.split())
            types.append([grp, label, f"GAMBAR!{lc}{r}"])
            for q in qcols:
                owner[(q, r)] = (grp, label)

    for grp, (sheet, _, _, _, _) in GROUPS.items():
        rows = wb.load(sheet)
        memo = {}

        def deps(r, col, stack=()):
            k = (r, col)
            if k in memo:
                return memo[k]
            if k in stack:
                return set()
            cell, out = rows.get(r, {}).get(col), set()
            if cell and cell[1]:
                f = cell[1]
                out |= {("G", c, int(rr)) for c, rr in G_REF.findall(f)}
                body = G_REF.sub("", f)
                for c1, r1, c2, r2 in OWN_RANGE.findall(body):
                    if c1 == c2 and int(r2) - int(r1) < 400:
                        for rr in range(int(r1), int(r2) + 1):
                            out |= deps(rr, c1, stack + (k,))
                for c, rr in OWN_REF.findall(OWN_RANGE.sub("", body)):
                    if len(c) == 1 and c in "HIJK":
                        out |= deps(int(rr), c, stack + (k,))
            memo[k] = out
            return out

        for r, cells in sorted(rows.items()):
            if r < 9 or "B" not in cells or not (cells["B"][0] or "").strip().isdigit():
                continue
            code = int(cells["B"][0])
            cons = sorted({owner[(d[1], d[2])] for col in "IJ" for d in deps(r, col) if (d[1], d[2]) in owner})
            foreign = [c for c in cons if c[0] != grp]
            src_ref = f"{sheet}!B{r}"
            desc = " ".join(((cells.get("C") or (None,))[0] or "").split())
            if not cons:
                fixed.append([grp, code, src_ref, desc])
                continue
            rel = "DIRECT" if len(cons) == 1 else "SHARED"
            for (cg, label) in cons:
                maps.append([cg, label, code, rel, src_ref, "OK" if code in khs else "KHS_CODE_MISSING", "WRONG_GROUP" if foreign else ""])

    # A mapping is unique per (construction, KHS code): rows that repeat a code inside one construction's block are merged
    # (sources joined, SHARED wins) and the merge is stated in the note so a reviewer can see it.
    merged = {}
    for m in maps:
        k = (m[0], m[1], m[2])
        if k not in merged:
            merged[k] = {"rel": m[3], "src": [m[4]], "chk": m[5], "wrong": m[6]}
        else:
            merged[k]["src"].append(m[4])
            merged[k]["rel"] = "SHARED" if "SHARED" in (merged[k]["rel"], m[3]) else "DIRECT"
    maps = [[k[0], k[1], k[2], v["rel"], " ; ".join(v["src"]), v["chk"], (f"muncul {len(v['src'])} kali pada sheet (digabung)" if len(v["src"]) > 1 else v["wrong"])] for k, v in merged.items()]

    # Owner decision (2026-11-06): types with no KHS mapping at all cannot be approved and are excluded.
    mapped = {(m[0], m[1]) for m in maps}
    excluded = [t for t in types if (t[0], t[1]) not in mapped]
    types = [t for t in types if (t[0], t[1]) in mapped]
    for t in excluded:
        print(f"DIKECUALIKAN (tanpa pemetaan KHS): {t[0]} / {t[1]} ({t[2]})", file=sys.stderr)

    with open(os.path.join(out, "construction_types.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f); w.writerow(["group", "label", "source_reference"]); w.writerows(types)
    with open(os.path.join(out, "construction_mappings.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f); w.writerow(["group", "label", "khs_code", "relation", "source_reference", "khs_check", "note"]); w.writerows(maps)
    with open(os.path.join(out, "fixed_items.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f); w.writerow(["group", "khs_code", "source_reference", "description"]); w.writerows(fixed)

    print(f"construction types: {len(types)}  ->  " + ", ".join(f"{k}={v}" for k, v in collections.Counter(t[0] for t in types).items()))
    print(f"mapping rows: {len(maps)}  (DIRECT {sum(1 for m in maps if m[3]=='DIRECT')}, SHARED {sum(1 for m in maps if m[3]=='SHARED')});  fixed items: {len(fixed)}")
    print(f"pairs merged because the code repeats inside one construction: {sum(1 for m in maps if 'digabung' in m[6])}")
    print(f"mapping rows with a KHS code missing from the catalogue: {sum(1 for m in maps if m[5] != 'OK')};  rows crossing into another group: {sum(1 for m in maps if m[6] == 'WRONG_GROUP')}")
    lab = collections.Counter((t[0], t[1]) for t in types)
    print(f"labels repeated inside one group: {[k for k, v in lab.items() if v > 1]}")
    reached = {(m[0], m[1]) for m in maps}
    print("constructions with no mapped KHS code:", [f"{t[0]}:{t[1]}" for t in types if (t[0], t[1]) not in reached])


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
