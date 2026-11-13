#!/usr/bin/env python3
"""Extract the KHS sheet of 'MASTER RAB & KKF.xlsx' to CSV (code,name,unit,category) for the KHS import endpoint.

Standard library only; read-only. Values are the workbook's cached results: no formula is evaluated and no macro
runs. Prices (columns G-I) are deliberately NOT exported: they belong to the price master (docs/23 section 4), not to
the KHS catalogue. Units are exported exactly as written (B, S, M, M3, Ls, Loks): do not expand abbreviations.

Usage: python3 -I tools/extract_khs_csv.py "MASTER RAB & KKF.xlsx" khs.csv
"""
import csv, re, sys, zipfile, xml.etree.ElementTree as ET

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main", "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships"}


def main(src: str, dest: str) -> int:
    z = zipfile.ZipFile(src)
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    rels = {r.get("Id"): r.get("Target") for r in ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))}
    sheet = next((s for s in wb.find("m:sheets", NS) if s.get("name") == "KHS"), None)
    if sheet is None:
        print("Sheet 'KHS' not found", file=sys.stderr)
        return 1
    target = rels[sheet.get("{%s}id" % NS["r"])].lstrip("/")
    target = target if target.startswith("xl/") else "xl/" + target
    shared = ["".join(t.text or "" for t in si.iter("{%s}t" % NS["m"])) for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", NS)]

    rows = []
    for _, el in ET.iterparse(z.open(target), events=("end",)):
        if el.tag != "{%s}row" % NS["m"]:
            continue
        cells = {}
        for c in el.findall("m:c", NS):
            v = c.find("m:v", NS)
            if v is not None:
                cells[re.match(r"[A-Z]+", c.get("r")).group(0)] = shared[int(v.text)] if c.get("t") == "s" else v.text
        if int(el.get("r")) >= 6 and (cells.get("B") or "").strip():  # data starts at row 6 (rows 1-5 are headers)
            rows.append([cells["B"].strip(), (cells.get("C") or "").strip(), (cells.get("D") or "").strip(), (cells.get("F") or "").strip()])
        el.clear()

    with open(dest, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["code", "name", "unit", "category"])
        w.writerows(rows)
    print(f"{len(rows)} KHS rows written to {dest}")
    return 0


if __name__ == "__main__":
    sys.exit(main(*sys.argv[1:3]) if len(sys.argv) == 3 else print(__doc__) or 2)
