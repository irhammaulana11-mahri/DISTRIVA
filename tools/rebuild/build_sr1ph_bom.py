#!/usr/bin/env python3
"""Builds tools/output/bom_SR1PH.json: the BOM group SR1PH (SR-APP 1 fasa) from sheet 'APP 1 PHASA' of tools/samples/MASTER RAB & KKF.xlsx, after the owner's
restructure of 2026-11-09 (docs/62 §52). The sheet is a price summary, so the BOM keeps only its QUANTITY logic; prices come from the price book.
Owner decisions: only SDES-1 and SDES-2; every material is counted ONCE (the SDES-1 block); the SDES-2 block only carries its own 'Jasa Kegiatan';
'Angkutan Material' is dropped; MCB and kWh meter stay one item each (the rating is chosen at allocation: one KHS may map to several ERP SKUs);
SDES-1 customers come from the drawing (GAMBAR!AA51 = psg of the row labelled 450-5500 VA); SDES-2 customers are typed in the MTO (parameter SR1:SDES2).
Sheet quantities -> BOM columns: material (H) for materials, installation (I) for the 'Jasa Kegiatan' lines (the labour price of the sheet is that KHS's install price).
Needs only the standard library; reads tools/output/rebuild/{code_plan.csv,sr1_khs_baru.csv} and tools/output/bom_PBPD_6_41.json (its drawing parameters are reused).
"""
import csv, json, re

ROOT = "/media/data/PROJECT/DISTRIVA"
OUT = f"{ROOT}/tools/output"
RB = f"{OUT}/rebuild"


def read(path):
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def main():
    plan = {r["kode_lama"]: r["kode_baru"] for r in read(f"{RB}/code_plan.csv")}
    new = {" ".join(r["nama"].split()): r["kode_baru"] for r in read(f"{RB}/sr1_khs_baru.csv")}
    def code(old=None, name=None):
        return plan[old] if old is not None else new[" ".join(name.split())]

    c = {
        "jasa1": code(name="Jasa Kegiatan Pasang Baru SDES - 1 ( SR 1 Phasa, tarikan Tiang ke Plgg )"),
        "jasa2": code(name="Jasa Kegiatan Pasang Baru SDES - 2 ( SR 1 Phasa, tarikan Plgg ke Plgg )"),
        "bracket": code("374"), "wedge": code("396"), "strain": code(name="Strainhook / ekor babi"), "suport": code("183"),
        "conn_a": code(name="Conn. press AL/AL type 10-16 mm2 / 50-70 mm2  + Scoot + Cover"), "kumis": code(name="Bundl.Cond.3x50 + 1x35 mm - 50 cm ( kumis )"),
        "tap_a": code("212"), "tap_b": code("213"), "meter": code(name="kWh Meter Electronic 1 Phs (Pasca/Prabayar)"), "mcb": code("232"), "twisted": code("507"),
        "segel": code(name="Segel Plastik"), "paku": code(name="Paku Beton"),
    }
    pbpd = json.load(open(f"{OUT}/bom_PBPD_6_41.json", encoding="utf-8"))
    keep = [p for p in pbpd["params"] if re.fullmatch(r"PBPD:(RENTANG|PSG)_[1-6]", p["name"])]
    assert len(keep) == 12, len(keep)
    params = keep + [{"cell": "AC51", "name": "SR1:SDES2", "type": "number", "default": 0, "description": "Jumlah pelanggan SDES-2 (SR 1 fasa tarikan pelanggan ke pelanggan); diisi petugas pada MTO (APP 1 PHASA!G12)"}]
    sdes1 = "+".join(f'(IF(GAMBAR!Z{r}=GAMBAR!$AD$3,GAMBAR!AA{r},"0"))' for r in range(51, 57))   # the rows labelled 450-5500 VA (the template row is AA51)
    lines = [
        {"sequence": 11, "khs_code": None, "description": "Pelanggan SDES-1 (dari gambar, rentang 450-5500 VA)", "H": sdes1, "source": "APP 1 PHASA!G11"},
        {"sequence": 12, "khs_code": None, "description": "Pelanggan SDES-2 (diisi pada MTO)", "H": "GAMBAR!AC51", "source": "APP 1 PHASA!G12"},
        {"sequence": 13, "khs_code": None, "description": "Total pelanggan SR 1 fasa (SDES-1 + SDES-2)", "H": "H11+H12", "source": "APP 1 PHASA!SUM(G11:G12)"},
    ]
    def mat(seq, key, desc, factor, src):
        lines.append({"sequence": seq, "khs_code": c[key], "description": desc, "H": "H13" if factor == 1 else f"H13*{factor}", "source": f"APP 1 PHASA!B{src}"})
    lines.append({"sequence": 19, "khs_code": c["jasa1"], "description": "Jasa Kegiatan SDES-1", "I": "H11", "source": "APP 1 PHASA!B19"})
    mat(20, "bracket", "Pole Bracket 3-6\"", 1, 20); mat(21, "wedge", "Service wedge clamp 2/4 x 6/10 mm", 2, 21); mat(22, "strain", "Strainhook / ekor babi", 1, 22)
    mat(23, "suport", "Cable suport (508/U/2009)", 3, 23); mat(24, "conn_a", "Conn. press AL/AL 10-16 / 50-70 mm2 + Scoot + Cover", 2, 24)
    mat(26, "kumis", "Bundl.Cond.3x50 + 1x35 mm - 50 cm (kumis)", 2, 26); mat(27, "tap_a", "Line Tap Connector (press) 35-70 / 35-70 mm + scoth", 2, 27)
    mat(28, "tap_b", "Line Tap Connector (press) 16-25 / 35-70 mm + heatshrink", 2, 28)
    lines.append({"sequence": 30, "khs_code": c["jasa2"], "description": "Jasa Kegiatan SDES-2", "I": "H12", "source": "APP 1 PHASA!B30"})
    mat(37, "meter", "kWh Meter Electronic 1 Phs (Pasca/Prabayar)", 1, 37); mat(38, "mcb", "MCB 230 V - 2 A s/d 35 A - 1 Phasa", 1, 38); mat(39, "twisted", "Twisted Cable 2 x 10 mm2 - Al", 30, 39)
    mat(42, "segel", "Segel Plastik", 1, 42); mat(43, "paku", "Paku Beton", 2, 43)
    doc = {"group": "SR1PH", "source": "MASTER RAB & KKF.xlsx / sheet APP 1 PHASA (restrukturisasi pemilik 2026-11-09)", "inputs": [], "lines": lines, "input_values": {}, "params": params,
           "constants": {"AD3": pbpd["constants"]["AD3"]}, "review": []}
    json.dump(doc, open(f"{OUT}/bom_SR1PH.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("bom_SR1PH.json:", len(lines), "baris,", len(params), "parameter; AD3 =", doc["constants"]["AD3"])
    print({k: v for k, v in c.items()})


if __name__ == "__main__":
    main()
