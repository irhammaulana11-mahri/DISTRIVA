#!/usr/bin/env python3
"""Extract the sheet 'MASTER TARIF & JN' of 'MASTER TARIF & JAM NYALA.xlsx' as the tariff-book CSV (read-only; stdlib only; cached values, no formula executed).
Columns: tarif, daya_va (empty = tariff without power steps), harga_rata2 (Rp/kWh = column D 'TTL'), jam_nyala (column C), ujl (column E), ulp (optional).
The jam nyala come from the sales report of ONE ULP (sheet '309': ULP Jombang for the sample file), so pass --ulp <ULP unit code> to scope the rows to that ULP;
without --ulp the rows apply to every ULP. Rows with a zero/empty price or jam nyala are NOT guessed: they are listed on stderr and left out.
Usage: python3 -I tools/extract_tariff_csv.py "MASTER TARIF & JAM NYALA.xlsx" OUT.csv [--ulp CODE]
"""
import csv, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "analysis"))
from wb import WB


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def fmt(x):
    return ("%.4f" % x).rstrip("0").rstrip(".")


def main(argv):
    if len(argv) < 3:
        print(__doc__, file=sys.stderr)
        return 2
    ulp = argv[argv.index("--ulp") + 1] if "--ulp" in argv else ""
    rows = WB(argv[1]).load("MASTER TARIF & JN")
    out, skipped = [], []
    for r in sorted(rows):
        if r == 1:
            continue
        c = {k: v[0] for k, v in rows[r].items()}
        tarif = (c.get("A") or "").strip()
        if not tarif:
            continue
        power, price, jam, ujl = num(c.get("B")), num(c.get("D")), num(c.get("C")), num(c.get("E"))
        if not price or price <= 0 or not jam or jam <= 0:
            skipped.append((r, tarif, c.get("B"), c.get("C"), c.get("D")))
            continue
        out.append([tarif, "" if power is None else str(int(power)), fmt(price), fmt(jam), "" if ujl is None else fmt(ujl), ulp])
    with open(argv[2], "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["tarif", "daya_va", "harga_rata2", "jam_nyala", "ujl", "ulp"])
        w.writerows(out)
    print(f"{len(out)} baris ditulis; {len(skipped)} dilewati (harga atau jam nyala kosong/nol):", file=sys.stderr)
    for s in skipped:
        print("  baris", s, file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
