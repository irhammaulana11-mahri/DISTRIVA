"""Builds the golden vectors for the PHP formula engine from MASTER RAB & KKF.xlsx (read-only; no formula is executed here).

Writes backend/tests/fixtures/golden_bom.json.gz: for the nine BOM sheets, every volume formula (columns H-K) with its
stored result, plus the cells those formulas read (own sheet and other sheets) with their stored values/formulas.
The PHP test re-evaluates every formula with the production engine and must reproduce the stored results
(docs/59 §3: 5,891 of 5,900; the 9 known differences are in '53-197 KVA' and are pinned by the test).

  python3 -I tools/golden_vectors.py "MASTER RAB & KKF.xlsx" backend/tests/fixtures/golden_bom.json.gz
"""
import gzip, json, os, re, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "analysis"))
from wb import WB

SHEETS = ["SUTM", "MVTIC", "SKTM", "KUBIKEL", "GTT KHUSUS", "GTT UMUM", "SUTR", "APP LANGSUNG", "APP TAK LANGSUNG"]   # = the former "6,6-41,5 KVA" and "53-197 KVA" (renamed in the 2026-11-09 revision of the workbook, see extract_bom_json.py)
REF = re.compile(r"(?:(?P<sh>'[^']+'|[A-Za-z_][A-Za-z0-9_.]*)!)?\$?(?P<c1>[A-Z]{1,3})\$?(?P<r1>\d+)(?::\$?(?P<c2>[A-Z]{1,3})\$?(?P<r2>\d+))?")

def c2n(c):
    n = 0
    for ch in c: n = n * 26 + ord(ch) - 64
    return n
def n2c(n):
    s = ""
    while n: n, r = divmod(n - 1, 26); s = chr(65 + r) + s
    return s

def main(src, out):
    wb = WB(src)
    cache = {}
    def sheet(name):
        if name not in cache: cache[name] = wb.load(name)
        return cache[name]
    result = {"source": os.path.basename(src), "sheets": {}, "formulas": []}
    need = {}     # (sheet) -> set of (col,row)
    def want(sh, col, row): need.setdefault(sh, set()).add((col, row))
    todo = []
    for name in SHEETS:
        rows = sheet(name)
        for r, cells in rows.items():
            for col in "HIJK":
                c = cells.get(col)
                if c and c[1]:
                    result["formulas"].append([name, f"{col}{r}"]); want(name, col, r); todo.append((name, col, r))
    seen = set()
    while todo:
        name, col, row = todo.pop()
        if (name, col, row) in seen: continue
        seen.add((name, col, row))
        c = sheet(name).get(row, {}).get(col)
        if not c or not c[1] or col not in "HIJK": continue      # only H-K formulas are evaluated (as in docs/59)
        for m in REF.finditer(re.sub(r'"(?:[^"]|"")*"', '""', c[1])):
            sh = (m.group("sh") or name).strip("'")
            a, b = (m.group("c1"), int(m.group("r1"))), (m.group("c2") or m.group("c1"), int(m.group("r2") or m.group("r1")))
            for rr in range(a[1], b[1] + 1):
                for cc in range(c2n(a[0]), c2n(b[0]) + 1):
                    want(sh, n2c(cc), rr); todo.append((sh, n2c(cc), rr))
    for sh, cells in need.items():
        rows = sheet(sh); d = {}
        for col, row in sorted(cells, key=lambda x: (x[1], c2n(x[0]))):
            c = rows.get(row, {}).get(col)
            if c is None: continue
            d[f"{col}{row}"] = [c[0], c[1] if col in "HIJK" and sh in SHEETS else None]
        result["sheets"][sh] = d
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with gzip.open(out, "wt", encoding="utf-8") as f: json.dump(result, f, ensure_ascii=False, separators=(",", ":"))
    print(f"formulas: {len(result['formulas'])}; cells: {sum(len(v) for v in result['sheets'].values())}; bytes: {os.path.getsize(out)}")

if __name__ == "__main__": main(sys.argv[1], sys.argv[2])
