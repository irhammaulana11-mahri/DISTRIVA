"""Maximo Work Order Tracking (T&D) -> pengukuran gardu (tools/maximo_sync/README.md).

Membaca respons laporan cetak WO inspeksi gardu (`plusdwoprint_trk_U.rptdesign`, jawaban SOAP BIRT `GetUpdatedObjects` yang isinya HTML) atau HTML-nya saja,
lalu menghasilkan satu catatan per WO: kepala WO (nomor, gardu, status, nilai HI, tanggal), pengukuran tingkat gardu (pembebanan trafo, ketidakseimbangan, arus netral)
dan pengukuran per jurusan (tegangan pangkal R/S/T, beban puncak dan normal R/S/T/N, rating NH fuse). Tidak ada akses jaringan di sini.
"""
import csv
import html
import re
from datetime import datetime

from bs4 import BeautifulSoup

MONTHS_ID = {"januari": 1, "februari": 2, "maret": 3, "april": 4, "mei": 5, "juni": 6, "juli": 7, "agustus": 8, "september": 9, "oktober": 10, "november": 11, "desember": 12, "des": 12, "agu": 8, "okt": 10}
LABELS = ["Asset:", "Location:", "HI Value:", "HI Numeric Value:", "HI Total Value:", "Sched Start:", "Site:", "Job Plan:", "Sched Finish:", "Priority:", "Supervisor:", "Target Start:", "Work Type:",
          "Lead:", "Target Finish:", "Status:", "Vendor:", "Actual Start:", "Parent:", "Owner:", "Actual Finish:", "Failure Class:", "Report Date:", "Problem Code:", "Reported By:", "kMs:", "Task IDs"]
JURUSAN = "abcdefghijklmnop"
PHASES = "nrst"
_LABEL_RE = re.compile("(" + "|".join(re.escape(label) for label in LABELS) + ")")


def num(v):
    """'229' | '2.44' | '1,5' -> float, anything else -> None."""
    try:
        return float(str(v).strip().replace(",", ".")) if str(v).strip() != "" else None
    except ValueError:
        return None


def date_id(v):
    """'3 Agustus 2026' -> '2026-08-03' (None when it is not a date)."""
    m = re.match(r"^\s*(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\s*$", v or "")
    mo = MONTHS_ID.get(m.group(2).lower()) if m else None
    return f"{int(m.group(3)):04d}-{mo:02d}-{int(m.group(1)):02d}" if m and mo else None


def stamp(v):
    """'Aug 12, 2026 13:09:16' -> datetime (None when it is not a timestamp)."""
    for fmt in ("%b %d, %Y %H:%M:%S", "%b %d, %Y %H:%M"):
        try:
            return datetime.strptime((v or "").strip(), fmt)
        except ValueError:
            continue
    return None


def contents(raw):
    """HTML of the report: the <Content> of every update of a SOAP answer, or the text itself when it is already HTML."""
    parts = re.findall(r"<Content>(.*?)</Content>", raw, re.S)
    return "\n".join(html.unescape(p) for p in parts) if parts else raw


def header(text):
    """Label -> value of the WO header (text of the first block), each value runs to the next known label."""
    pieces = _LABEL_RE.split(text)
    out = {}
    for i in range(1, len(pieces) - 1, 2):
        out.setdefault(pieces[i].rstrip(":"), re.sub(r"\s+", " ", pieces[i + 1]).strip())
    m = re.search(r"Work Order Details\s+(\d+):\s*(.*?)\s+Asset:", text, re.S)
    out["wonum"], out["description"] = (m.group(1), re.sub(r"\s+", " ", m.group(2)).strip()) if m else ("", "")
    return out


def gardu_code(description, location):
    """The gardu code of a work order. The location (`GD01.05028596 GD HC0086 PENYULANG ...`) is reliable; the description may run words together (`HC0086GD`) and the asset prefix `GD01` itself looks like a code."""
    m = re.search(r"\bGD\s+([A-Z]{2}\d{1,4})\b", location)
    if m:
        return m.group(1)
    for text in (description, location):
        for m in re.finditer(r"(?<![A-Z0-9])([A-Z]{2}\d{1,4})(?![0-9])", text):
            if not re.fullmatch(r"GD\d{2}", m.group(1)):
                return m.group(1)
    return ""


def parse(raw):
    """One record (dict) per WO found in `raw`; [] when there is no work order in it."""
    soup = BeautifulSoup(contents(raw), "html.parser")
    rows = [[re.sub(r"\s+", " ", td.get_text(" ", strip=True)) for td in tr.find_all(["td", "th"], recursive=False)] for tr in soup.find_all("tr")]
    head = next((r[0] for r in rows if len(r) == 1 and "Work Order Details" in r[0]), None)
    if head is None:
        return []
    h = header(head)
    rec = {"wonum": h["wonum"], "description": h["description"], "gardu": "", "location": h.get("Location", ""), "status": h.get("Status", ""), "work_type": h.get("Work Type", ""), "owner": h.get("Owner", ""),
           "hi_value": h.get("HI Value", ""), "hi_numeric": h.get("HI Numeric Value", ""), "hi_total": h.get("HI Total Value", ""),
           "actual_start": date_id(h.get("Actual Start", "")), "actual_finish": date_id(h.get("Actual Finish", "")), "report_date": date_id(h.get("Report Date", ""))}
    rec["gardu"] = gardu_code(h["description"], rec["location"])
    rec["jurusan"] = {}
    rec["gardu_level"] = {}
    times = []
    task = None
    for cells in rows:
        if len(cells) != 9 or cells[0] in ("Sequence", ""):
            continue
        if not cells[0].isdigit() or cells[1] == "":
            if all(c == "" for c in cells[1:]):                       # a task header: "91153677 HANTARAN TR ..., LVCABLE JURUSAN A"
                j = re.search(r"JURUSAN\s+([A-Za-z])\b", cells[0])
                task = j.group(1).lower() if j else None
            continue
        meter, value, unit, obs, at = cells[1].upper(), num(cells[4]), cells[5], cells[7], stamp(cells[3])
        if task is not None:
            slot = rec["jurusan"].setdefault(task, {})
            v = re.fullmatch(r"([RST])-0", meter)
            b = re.fullmatch(r"BEBAN-([RSTN])(-NORMAL)?", meter)
            f = re.fullmatch(r"RATINGNHFUSE([RST])", meter)
            if v and value is not None:
                slot["v" + v.group(1).lower()] = value
                at and times.append(at)
            elif b and value is not None:
                slot[("normal_" if b.group(2) else "peak_") + b.group(1).lower()] = value
                at and not b.group(2) and times.append(at)
            elif f:
                slot["nhf_" + f.group(1).lower()] = (unit or obs or "").strip()
        else:
            rec["gardu_level"][meter] = {"value": value, "unit": unit, "obs": obs, "hi": cells[8], "at": at.isoformat(sep=" ") if at else None}
    rec["measured_at"] = min(times).strftime("%Y-%m-%d %H:%M:%S") if times else None
    g = rec["gardu_level"]
    rec["pembebanan_trafo_pct"] = (g.get("PEMBEBANANTRAFO") or {}).get("value")
    rec["imbalance_pct"] = (g.get("KETIDAKSEIMBANGANPHASA") or {}).get("value")
    rec["neutral_pct"] = (g.get("BESARARUSNETRALTR") or {}).get("value")
    rec["grounding_ohm"] = (g.get("PENTANAHAN") or {}).get("value")
    return [rec]


def fieldnames():
    cols = ["wonum", "description", "gardu", "location", "status", "work_type", "owner", "hi_value", "hi_numeric", "hi_total", "actual_start", "actual_finish", "report_date", "measured_at",
            "pembebanan_trafo_pct", "imbalance_pct", "neutral_pct", "grounding_ohm", "vrn", "vsn", "vtn"]
    return cols + [f"i{j}{p}" for j in JURUSAN for p in PHASES] + [f"nhf_i{j}{p}" for j in JURUSAN for p in "rst"]


def flatten(rec):
    """A record -> one CSV row. The gardu base voltage per phase is the LOWEST of the jurusan values (conservative: the base-voltage flag looks at the minimum);
    the load per jurusan is the peak load (BEBAN-*), named like the OMT columns (iar = jurusan A, phase R)."""
    row = {k: ("" if rec.get(k) is None else rec[k]) for k in fieldnames() if k in rec}
    for ph in "rst":
        vals = [s["v" + ph] for s in rec["jurusan"].values() if "v" + ph in s]
        row["v" + ph + "n"] = min(vals) if vals else ""
    for j, s in rec["jurusan"].items():
        if j not in JURUSAN:
            continue
        for p in PHASES:
            row[f"i{j}{p}"] = s.get("peak_" + p, "")
        for p in "rst":
            row[f"nhf_i{j}{p}"] = s.get("nhf_" + p, "")
    return row


def write_csv(records, path):
    with open(path, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=fieldnames(), restval="")
        w.writeheader()
        for r in records:
            w.writerow(flatten(r))
