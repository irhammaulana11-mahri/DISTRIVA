"""ANALYSIS TOOL (not the production evaluator): read-only workbook reader (stdlib). See docs/59."""
import re, zipfile, xml.etree.ElementTree as ET
NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main", "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships"}
M = "{%s}" % NS["m"]

def col2n(c):
    n = 0
    for ch in c: n = n * 26 + ord(ch) - 64
    return n
def n2col(n):
    s = ""
    while n: n, r = divmod(n - 1, 26); s = chr(65 + r) + s
    return s
REF = re.compile(r"(?<![A-Za-z0-9_.])(\$?)([A-Z]{1,3})(\$?)(\d+)(?![A-Za-z0-9_(])")
def shift(formula, dr, dc):
    def f(m):
        ca, c, ra, r = m.groups()
        c2 = c if ca else n2col(col2n(c) + dc)
        r2 = r if ra else str(int(r) + dr)
        return f"{ca}{c2}{ra}{r2}"
    return REF.sub(f, formula)

class WB:
    def __init__(self, path):
        self.z = zipfile.ZipFile(path)
        wb = ET.fromstring(self.z.read("xl/workbook.xml"))
        rels = {r.get("Id"): r.get("Target") for r in ET.fromstring(self.z.read("xl/_rels/workbook.xml.rels"))}
        self.sheets = []
        for s in wb.find("m:sheets", NS):
            t = rels[s.get("{%s}id" % NS["r"])].lstrip("/"); t = t if t.startswith("xl/") else "xl/" + t
            self.sheets.append((s.get("name"), s.get("state") or "visible", t))
        self.shared = ["".join(t.text or "" for t in si.iter(M + "t")) for si in ET.fromstring(self.z.read("xl/sharedStrings.xml")).findall("m:si", NS)]
    def part(self, name): return next(t for n, _, t in self.sheets if n == name)
    def load(self, name):
        """rows[r][col] = (value, formula or None)"""
        rows, masters = {}, {}
        for _, el in ET.iterparse(self.z.open(self.part(name)), events=("end",)):
            if el.tag != M + "row": continue
            r = int(el.get("r")); cells = {}
            for c in el.findall("m:c", NS):
                ref = c.get("r"); col = re.match(r"[A-Z]+", ref).group(0)
                v = c.find("m:v", NS); f = c.find("m:f", NS)
                val = None if v is None else (self.shared[int(v.text)] if c.get("t") == "s" else v.text)
                form = None
                if f is not None:
                    if f.get("t") == "shared":
                        si = f.get("si")
                        if f.text: masters[si] = (f.text, r, col2n(col)); form = f.text
                        elif si in masters:
                            txt, mr, mc = masters[si]; form = shift(txt, r - mr, col2n(col) - mc)
                    else: form = f.text
                if val is not None or form is not None: cells[col] = (val, form)
            rows[r] = cells; el.clear()
        return rows
