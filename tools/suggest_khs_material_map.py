#!/usr/bin/env python3
"""CANDIDATES for the KHS <-> ERP material number mapping (read-only; stdlib only). Compares the names of the KHS items (tools/output/khs.csv) with the 'Nama Material' of the ERP
'Monitoring Stock' workbook by shared words and unit. The result is only a SUGGESTION to be reviewed by a person: nothing is imported by this tool, and a wrong mapping would put
the wrong stock under a KHS item. Output columns: kode_khs, no_material, skor, keyakinan (TINGGI >= 0.7, SEDANG >= 0.5, RENDAH), nama_khs, nama_material, satuan_khs, satuan_erp (delete wrong rows, keep kode_khs and no_material, import).
Usage: python3 -I tools/suggest_khs_material_map.py tools/output/khs.csv "tools/samples/Monitoring_Stock_07-11-2026.xlsx" OUT.csv [MIN_SCORE=0.6]
"""
import csv, os, re, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "analysis"))
from wb import WB

STOP = {"dan", "atau", "the", "of", "untuk", "pada", "dengan", "type", "tipe", "mm2", "mm", "sqmm", "kv", "a", "hdg", "komplit", "set", "tm", "tr"}
# Indonesian / PLN-standard words of the KHS list -> the English words used in the ERP material names
TRANSLATE = {"kabel": "cable", "cabel": "cable", "tiang": "pole", "trafo": "transformer", "klem": "clamp", "konektor": "connector", "pipa": "pipe", "isolator": "insulator", "pondasi": "foundation", "begel": "band",
             "baut": "bolt", "mur": "nut", "kawat": "wire", "penghalang": "barrier", "gembok": "padlock", "arde": "earthing", "arding": "earthing", "kotak": "box", "lemari": "cubicle", "sepatu": "lug",
             "sambungan": "joint", "ujung": "end", "pelindung": "cover", "tutup": "cap", "penangkal": "arrester", "petir": "lightning", "pengaman": "fuse", "sekring": "fuse", "meter": "meter", "alumunium": "al", "aluminium": "al", "tembaga": "cu"}
UNITS = {"bh": "bh", "buah": "bh", "pcs": "bh", "m": "m", "mtr": "m", "meter": "m", "set": "set", "bt": "btg", "btg": "btg", "batang": "btg", "u": "u", "unit": "u", "ls": "ls", "kg": "kg", "ltr": "l", "l": "l"}


def tokens(text):
    t = re.sub(r"[^a-z0-9.]+", " ", text.lower().replace(",", "."))
    t = re.sub(r"(\d)(mm2|mm|sqmm|kv|va|kva|a|m)\b", r"\1", t)          # 10mm2 -> 10, 20A -> 20
    return {TRANSLATE.get(w, w) for w in t.split() if w not in STOP and len(w) > 1}


def numbers(tok):
    return {w for w in tok if re.fullmatch(r"\d+(\.\d+)?", w)}


def unit(u):
    return UNITS.get(re.sub(r"[^a-z]", "", (u or "").lower()), (u or "").lower())


def main(argv):
    if len(argv) < 4:
        print(__doc__, file=sys.stderr)
        return 2
    min_score = float(argv[4]) if len(argv) > 4 else 0.6
    khs = list(csv.DictReader(open(argv[1], encoding="utf-8")))
    w = WB(argv[2])
    rows = w.load("Monitoring Stock")
    hdr = {k: v[0] for k, v in rows[1].items()}
    inv = {v: k for k, v in hdr.items()}
    mats = []
    for r in sorted(rows)[1:]:
        c = {k: v[0] for k, v in rows[r].items()}
        if c.get(inv["No Material"]):
            mats.append((c[inv["No Material"]], c.get(inv["Nama Material"], ""), c.get(inv["Satuan"], "")))
    mt = [(sku, name, u, tokens(name)) for sku, name, u in mats]
    out = []
    for k in khs:
        kt = tokens(k["name"])
        if not kt:
            continue
        best = None
        for sku, name, u, t in mt:
            if not t:
                continue
            score = len(kt & t) / len(kt | t)
            kn, tn = numbers(kt), numbers(t)
            if kn and tn:
                score += 0.2 if kn <= tn else -0.15                      # the specification numbers must agree
            if unit(k["unit"]) and unit(k["unit"]) == unit(u):
                score += 0.1
            if best is None or score > best[0]:
                best = (score, sku, name, u)
        if best and best[0] >= min_score:
            tier = "TINGGI" if best[0] >= 0.7 else ("SEDANG" if best[0] >= 0.5 else "RENDAH")
            out.append([k["code"], best[1], round(best[0], 3), tier, k["name"], best[2], k["unit"], best[3]])
    with open(argv[3], "w", newline="", encoding="utf-8") as f:
        wr = csv.writer(f)
        wr.writerow(["kode_khs", "no_material", "skor", "keyakinan", "nama_khs", "nama_material", "satuan_khs", "satuan_erp"])
        wr.writerows(out)
    print(f"{len(out)} kandidat dari {len(khs)} item KHS dan {len(mats)} material ERP (skor >= {min_score}); periksa manual sebelum diimpor.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
