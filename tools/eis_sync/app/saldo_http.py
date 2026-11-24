"""Laporan saldo piutang EIS (per golongan, per lembar, kogol) per ULP per bulan lewat HTTP, lalu diunggah ke impor laporan EIS DISTRIVA (docs/88).

Tiga laporan (menu EIS "Saldo Akhir Bulan" dan "Saldo Akhir Periode"):
  GOLONGAN  mycube.aspx?jenis=saldo_lalu_eis&parameter='<ULP>';'<YYYYMM>';'PERGOLONGAN'       jenis impor AKHIRBULAN_EIS
  LEMBAR    mycube.aspx?jenis=saldo_lalu_eis_lbr&parameter='<ULP>';'<YYYYMM>';'PERLEMBAR'      jenis impor UMURPIUTANG
  KOGOL     saldo_pal_20.aspx (tanpa parameter alamat; unit dan bulan mengikuti bilah atas)    jenis impor AKHIEPERIODE_EIS

Halaman mycube: GET halaman, lalu POST seluruh isian halaman dengan listExportFormatx=Excel dan btnSave=Save. Halaman KOGOL: pilih bulan (setTahun, setBulan) dan unit (finalUP) di bilah atas
seperti kotaknya, GET halaman, POST btnLoad, cek judul laporan (unit dan bulan harus sama dengan yang diminta), lalu POST btnExport. Hasil satu bulan menjadi satu ZIP berfolder `ULP/BULAN/<LAPORAN>.xls`
yang diunggah ke POST /api/eis-reports/import; jenis laporan dikenali DISTRIVA dari isi berkas.
"""
from __future__ import annotations

import io
import json
import re
import time
import zipfile
from pathlib import Path
from urllib.parse import quote

import requests
from bs4 import BeautifulSoup

from app import permohonan_http as eis
from app.config import LOGIN_URL

LAPORAN = ("GOLONGAN", "LEMBAR", "KOGOL")
MYCUBE = {"GOLONGAN": ("saldo_lalu_eis", "PERGOLONGAN"), "LEMBAR": ("saldo_lalu_eis_lbr", "PERLEMBAR")}
NAMA_BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"]
MIN_BYTES = 2000                    # Excel yang lebih kecil dianggap kosong (EIS membuat berkas kosong bila sesi tidak sah)
PAUSE = 1.0                         # jeda antar permintaan supaya tidak membebani EIS
_HEAD = re.compile(r"UP\s*:\s*(\d+)\s*\(\s*MUTASI\s*:\s*(\d{2})/(\d{4})", re.I)


class SaldoError(RuntimeError):
    pass


def base() -> str:
    return LOGIN_URL.rstrip("/")


def parse_month(text: str) -> str:
    m = re.fullmatch(r"(\d{4})-(\d{2})", text.strip())
    if not m or not 1 <= int(m.group(2)) <= 12:
        raise SystemExit(f"Bulan harus berbentuk YYYY-MM: {text!r}")
    return text.strip()


def months_between(first: str, last: str) -> list[str]:
    y, m = map(int, first.split("-"))
    ty, tm = map(int, last.split("-"))
    out = []
    while (y, m) <= (ty, tm):
        out.append(f"{y}-{m:02d}")
        m += 1
        if m > 12:
            m, y = 1, y + 1
    return out


def excel_kind(data: bytes) -> str | None:
    if data[:4] == b"\xd0\xcf\x11\xe0":
        return "xls"
    if data[:2] == b"PK":
        return "xlsx"
    return None


def check_excel(data: bytes, content_type: str, status: int) -> str:
    """The extension of an Excel answer; anything else (an HTML page, a file too small to hold data) is an error with the start of the answer."""
    kind = excel_kind(data)
    if status >= 400 or kind is None:
        raise SaldoError(f"hasil bukan Excel (HTTP {status}, {content_type}): {re.sub(r'\s+', ' ', data[:200].decode('utf-8', 'replace'))}")
    if len(data) < MIN_BYTES:
        raise SaldoError(f"berkas hanya {len(data)} byte (kemungkinan kosong): sesi EIS mungkin tidak sah")
    return kind


def page_form(session: requests.Session, url: str, step: str):
    response = session.get(url, timeout=(20, 90))
    eis._check_response(response, step)
    payload = eis.form_payload(response.text)
    if not payload.get("__VIEWSTATE"):
        raise SaldoError(f"{step}: halaman tidak memuat __VIEWSTATE (HTTP {response.status_code}): {re.sub(r'\s+', ' ', response.text[:200])}")
    return response, payload


def fetch_mycube(session: requests.Session, report: str, ulp: str, month: str) -> tuple[bytes, str]:
    jenis, tipe = MYCUBE[report]
    parameter = f"'{ulp}';'{month.replace('-', '')}';'{tipe}'"
    url = f"{base()}/mycube.aspx?jenis={jenis}&parameter={quote(parameter, safe='')}"
    _response, payload = page_form(session, url, f"GET {report}")
    payload.update({"__EVENTTARGET": "", "__EVENTARGUMENT": "", "listExportFormatx": "Excel", "ASPxPopupControl1$DropDownList2": "Excel", "btnSave": "Save"})
    answer = session.post(url, data=payload, timeout=(20, 180), headers={"Referer": url})
    eis._check_response(answer, f"Export {report}")
    return answer.content, check_excel(answer.content, answer.headers.get("Content-Type", ""), answer.status_code)


# ---- bilah atas: bulan dan unit untuk halaman KOGOL ------------------------------------------------------------------------------------------------------------------
def _ajax_top(session: requests.Session, method: str, value: str, override: dict[str, str]) -> None:
    _response, payload = page_form(session, eis.main_url(), "GET halaman utama EIS")
    payload.update(override)
    payload.update({"submitAjaxEventConfig": json.dumps({"config": {"extraParams": {"xxx": value}}}, separators=(",", ":")), "__EVENTTARGET": "ScriptManager1", "__EVENTARGUMENT": f"-|public|{method}"})
    answer = session.post(eis.main_url(), data=payload, timeout=(20, 90), headers={"Referer": eis.main_url(), "X-Requested-With": "XMLHttpRequest", "X-Coolite": "delta=true"})
    eis._check_response(answer, f"Pilih {method}")
    if re.search(r"window\.location\s*=\s*\\?[\"']?/?eis/login\.aspx", answer.text, re.I):
        raise eis.EISSessionExpired(f"Pilih {method}: EIS mengarahkan ke halaman login (sesi tidak berlaku lagi).")


def select_month(session: requests.Session, month: str) -> None:
    year, mm = month.split("-")
    _ajax_top(session, "setTahun", year, {"cboTahun_Value": year, "cboTahun": year, "cboTahun_SelIndex": "-1"})
    _ajax_top(session, "setBulan", mm, {"cboBLN_Value": mm, "cboBLN": NAMA_BULAN[int(mm) - 1], "cboBLN_SelIndex": str(int(mm) - 1), "cboTahun_Value": year, "cboTahun": year})


def fetch_kogol(session: requests.Session, ulp: str, month: str) -> tuple[bytes, str]:
    year, mm = month.split("-")
    url = f"{base()}/saldo_pal_20.aspx"
    _response, payload = page_form(session, url, "GET Saldo PAL tanggal 20")
    payload.update({"__EVENTTARGET": "btnLoad", "__EVENTARGUMENT": "", "cbojenis_Value": "KOGOL", "cbojenis": "KOGOL", "cbojenis_SelIndex": "0"})
    loaded = session.post(url, data=payload, timeout=(20, 180), headers={"Referer": url})
    eis._check_response(loaded, "Load Data KOGOL")
    head = _HEAD.search(BeautifulSoup(loaded.text, "html.parser").get_text(" ", strip=True))
    if not head:
        raise SaldoError(f"judul laporan KOGOL tidak ditemukan setelah Load Data (sesi habis?): {re.sub(r'\s+', ' ', loaded.text[:200])}")
    if (head.group(1), head.group(2), head.group(3)) != (ulp, mm, year):
        raise SaldoError(f"EIS menampilkan unit {head.group(1)} bulan {head.group(2)}/{head.group(3)}, bukan {ulp} {mm}/{year} (akun mungkin tidak boleh berpindah unit atau bulan)")
    payload = eis.form_payload(loaded.text)
    payload.update({"__EVENTTARGET": "btnExport", "__EVENTARGUMENT": "", "cbojenis_Value": "KOGOL", "cbojenis": "KOGOL", "cbojenis_SelIndex": "0"})
    answer = session.post(url, data=payload, timeout=(20, 180), headers={"Referer": url})
    eis._check_response(answer, "Export KOGOL")
    return answer.content, check_excel(answer.content, answer.headers.get("Content-Type", ""), answer.status_code)


# ---- satu putaran ------------------------------------------------------------------------------------------------------------------------------------------------------------
def build_zip(files: list[tuple[str, bytes]]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_STORED) as archive:
        for name, data in files:
            archive.writestr(name, data)
    return buffer.getvalue()


def run(client, units: list[tuple[str, str]], months: list[str], reports: list[str], keep_dir: str | None = None, pause: float = PAUSE) -> int:
    """Bulan demi bulan: unduh semua unit dan laporan, satukan menjadi satu ZIP, unggah. Satu berkas yang gagal dicatat dan putaran dilanjutkan; kode keluar 1 bila ada yang gagal."""
    session = eis.http_session()
    failed: list[str] = []
    uploaded = 0

    def attempt(label: str, action):
        nonlocal session
        for retry in (0, 1):
            try:
                return action()
            except eis.EISSessionExpired as e:
                if retry:
                    raise
                print(f"Sesi EIS berakhir ({e}); login ulang ...", flush=True)
                session = eis.http_session(fresh=True)
        return None

    for month in months:
        files: list[tuple[str, bytes]] = []
        print(f"=== Bulan {month} ===", flush=True)
        try:
            if "KOGOL" in reports:
                attempt("bulan", lambda: select_month(session, month))
        except Exception as e:
            print(f"GAGAL  pilih bulan {month}: {e}", flush=True)
            failed.extend(f"{r} {code} {month}" for code, _ in units for r in reports if r == "KOGOL")
            reports_now = [r for r in reports if r != "KOGOL"]
        else:
            reports_now = list(reports)
        for code, name in units:
            for report in reports_now:
                label = f"{report} {name} {month}"
                try:
                    if report == "KOGOL":
                        attempt(label, lambda: eis.select_unit(session, code))
                        data, ext = attempt(label, lambda: fetch_kogol(session, code, month))
                    else:
                        data, ext = attempt(label, lambda: fetch_mycube(session, report, code, month))
                    files.append((f"{code}/{month}/{report}.{ext}", data))
                    print(f"OK     {label} ({len(data)} byte)", flush=True)
                except Exception as e:
                    failed.append(label)
                    print(f"GAGAL  {label}: {e}", flush=True)
                time.sleep(pause)
        if not files:
            continue
        archive = build_zip(files)
        if keep_dir:
            Path(keep_dir).mkdir(parents=True, exist_ok=True)
            (Path(keep_dir) / f"eis-piutang-{month}.zip").write_bytes(archive)
        client.login()                                 # token segar: satu bulan bisa lebih lama dari batas diam token
        result = client.import_eis_reports(f"eis-piutang-{month}.zip", archive)
        for row in result.get("results", []):
            if row.get("ok"):
                print(f"  {row.get('name')}: {row.get('status')} {row.get('family')} {row.get('unit')} {row.get('period')} ({row.get('lines')} baris)", flush=True)
                uploaded += 1
            else:
                failed.append(str(row.get("name")))
                print(f"  {row.get('name')}: DITOLAK {row.get('message')}", flush=True)
    try:
        if "KOGOL" in reports:
            eis.select_unit(session, eis.ALL_UNITS)    # kembalikan pilihan unit ke SEMUA UP supaya sinkron lain tidak terfilter unit terakhir
    except Exception as e:
        print(f"PERINGATAN: pilihan unit EIS tidak dapat dikembalikan ke SEMUA UP ({e}).", flush=True)
    print(f"Ringkasan: {uploaded} berkas masuk DISTRIVA; {len(failed)} gagal{(' (' + ', '.join(failed[:20]) + ('...' if len(failed) > 20 else '') + ')') if failed else ''}.", flush=True)
    return 1 if failed else 0
