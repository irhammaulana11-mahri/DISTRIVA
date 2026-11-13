"""DIL (daftar induk langganan) -> DISTRIVA master pelanggan (docs/81).

Reads the DIL (an Access .mdb through `mdb-export` of mdbtools, or a CSV export), keeps ONLY the columns the master needs and sends them in chunks to
POST /api/master-data/customer-connections/batches/{id}/items (idempotent by IDPEL). NIK, NPWP, phone, e-mail, address and coordinates are never read into a row; a name that is not already masked is masked here.
"""
import csv
import io
import os
import re
import subprocess
import sys

import requests

csv.field_size_limit(10 ** 8)

COLUMNS = {  # DIL column -> field of the API item (the ONLY columns that are read)
    "IDPEL": "idpel", "UNITUP": "unit_code", "NAMA": "name", "TARIF": "tariff_code", "DAYA": "power_va", "JENISLAYANAN": "service_type", "KODE_FASA": "phase_code",
    "NOMOR_METER_KWH": "meter_number", "NOMOR_METER_PREPAID": "meter_prepaid", "NAMA_KELURAHAN": "kelurahan", "NAMA_KECAMATAN": "kecamatan", "NAMA_KABUPATEN": "kabupaten",
    "TGLNYALA_PB": "energized_on", "NOMOR_GARDU": "gardu_ref", "NAMA_GARDU": "gardu_name", "STATUS_DIL": "status", "V_BULAN_REKAP": "snapshot_month",
}
REQUIRED = ("IDPEL", "UNITUP", "NOMOR_GARDU", "STATUS_DIL")


def mask_name(value):
    v = (value or "").strip()
    if not v or "*" in v:
        return v or None
    return v[:3] + "*" * max(3, len(v) - 3)


def _date(value):
    """mdb-export -D '%Y-%m-%d' gives 2020-05-01 00:00:00; CSV exports may give dd/mm/yyyy."""
    v = (value or "").strip()
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", v)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})", v)
    return f"{m.group(3)}-{int(m.group(2)):02d}-{int(m.group(1)):02d}" if m else None


def to_item(row):
    """One DIL row -> API item (only the allowed fields)."""
    g = lambda k: (row.get(k) or "").strip()
    try:
        va = float(g("DAYA"))
    except ValueError:
        va = None
    return {"idpel": g("IDPEL"), "unit_code": g("UNITUP"), "name": mask_name(row.get("NAMA")), "tariff_code": g("TARIF") or None, "power_va": va if va and va > 0 else None,
            "service_type": g("JENISLAYANAN") or None, "phase_code": g("KODE_FASA") or None, "meter_number": g("NOMOR_METER_KWH") or g("NOMOR_METER_PREPAID") or None,
            "kelurahan": g("NAMA_KELURAHAN") or None, "kecamatan": g("NAMA_KECAMATAN") or None, "kabupaten": g("NAMA_KABUPATEN") or None, "energized_on": _date(row.get("TGLNYALA_PB")),
            "gardu_ref": g("NOMOR_GARDU") or None, "gardu_name": g("NAMA_GARDU") or None, "status": g("STATUS_DIL") or "AKTIF"}


def read_rows(source, mdb_table=None, mdb_export="mdb-export"):
    """Yield dict rows with only COLUMNS. `source` is a .csv path or a .mdb path (needs mdb-export and the table name)."""
    if str(source).lower().endswith(".mdb"):
        if not mdb_table:
            raise SystemExit("Berkas .mdb perlu --table (nama tabel); lihat `python main.py inspect`.")
        proc = subprocess.Popen([mdb_export, "-D", "%Y-%m-%d", str(source), mdb_table], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, encoding="utf-8", errors="replace")
        stream = proc.stdout
    else:
        proc = None
        stream = open(source, newline="", encoding="utf-8", errors="replace")
    try:
        reader = csv.DictReader(stream)
        missing = [c for c in REQUIRED if c not in (reader.fieldnames or [])]
        if missing:
            raise SystemExit(f"Kolom wajib tidak ada di sumber: {', '.join(missing)}")
        for row in reader:
            yield {k: row.get(k, "") for k in COLUMNS}
    finally:
        stream.close()
        if proc is not None:
            proc.wait()


def chunks(items, size):
    buf = []
    for it in items:
        buf.append(it)
        if len(buf) >= size:
            yield buf
            buf = []
    if buf:
        yield buf


class Client:
    def __init__(self, base_url, email, password, timeout=180, session=None):
        self.base = base_url.rstrip("/")
        self.email, self.password, self.timeout = email, password, timeout
        self.http = session or requests.Session()
        self.token = None

    def _h(self):
        h = {"Accept": "application/json"}
        if self.token:
            h["Authorization"] = f"Bearer {self.token}"
        return h

    def _check(self, res, what):
        if res.status_code >= 400:
            try:
                msg = res.json().get("message") or res.text[:300]
            except ValueError:
                msg = res.text[:300]
            raise RuntimeError(f"{what} gagal (HTTP {res.status_code}): {msg}")
        return res.json()

    def login(self):
        body = self._check(self.http.post(f"{self.base}/api/auth/login", json={"email": self.email, "password": self.password, "device_name": "dil-sync"}, headers={"Accept": "application/json"}, timeout=self.timeout), "Login")
        mfa = body.get("mfa") or {}
        if mfa.get("required") and not mfa.get("verified"):
            raise RuntimeError("Akun ini memerlukan MFA; pakai akun Niaga Retail UP3 atau Perencanaan/Enjiniring untuk muat otomatis.")
        self.token = body["token"]

    def start(self, file_name, month):
        return self._check(self.http.post(f"{self.base}/api/master-data/customer-connections/batches", json={"file_name": file_name, "snapshot_month": month}, headers=self._h(), timeout=self.timeout), "Memulai batch")["data"]

    def send(self, batch_id, items):
        return self._check(self.http.post(f"{self.base}/api/master-data/customer-connections/batches/{batch_id}/items", json={"items": items}, headers=self._h(), timeout=self.timeout), "Kirim potongan")["data"]

    def complete(self, batch_id):
        return self._check(self.http.post(f"{self.base}/api/master-data/customer-connections/batches/{batch_id}/complete", headers=self._h(), timeout=self.timeout), "Menutup batch")["data"]


def load(source, client, mdb_table=None, chunk=1000, limit=None, units=None, dry_run=False, out=sys.stdout, mdb_export="mdb-export"):
    """Send the DIL. `units` limits to some ULP codes (UNITUP); `limit` stops after n rows; dry_run only counts. Returns the totals."""
    month = None
    sent = 0
    seen = 0
    totals = {}

    def rows():
        nonlocal month, seen
        for r in read_rows(source, mdb_table, mdb_export):
            if units and r["UNITUP"].strip() not in units:
                continue
            month = month or (r["V_BULAN_REKAP"].strip() or None)
            seen += 1
            if limit and seen > limit:
                return
            yield to_item(r)

    batch = None
    for ch in chunks(rows(), chunk):
        if dry_run:
            sent += len(ch)
            continue
        if batch is None:
            batch = client.start(os.path.basename(str(source)), month)["id"]
        res = client.send(batch, ch)
        sent += len(ch)
        for k, v in res["counts"].items():
            totals[k] = totals.get(k, 0) + v
        print(f"  {sent:>8} baris terkirim | {res['counts']}", file=out)
        for p in res.get("problems", [])[:3]:
            print(f"    ! {p['idpel'] or '-'}: {p['problem']}", file=out)
    if batch is not None:
        client.complete(batch)
    return {"rows": sent, "snapshot_month": month, "counts": totals, "dry_run": dry_run}
