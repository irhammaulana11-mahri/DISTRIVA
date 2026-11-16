"""Monitoring Permohonan (Detil) over plain HTTP.

EIS is an ASP.NET WebForms application. Every Load Data / Export Excel
operation must start with a fresh GET so that __VIEWSTATE,
__EVENTVALIDATION and the other hidden fields belong to the current page.
A failed POST is therefore never blindly replayed: the complete transaction
(GET form -> POST Load Data -> POST Export Excel) is restarted.
"""

from __future__ import annotations

import os
import json
import re
import time
from datetime import date, timedelta
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Callable

import requests
from bs4 import BeautifulSoup

from app import permohonan as pm
from app.config import (
    EIS_DAYA_MAX,
    EIS_DAYA_MIN,
    EIS_DOWNLOAD_DIR,
    EIS_HEADLESS,
    EIS_MAX_FILE_BYTES,
    EIS_MAX_ROWS_PER_FILE,
    LOGIN_URL,
)
from app.session import COOKIE_FILE, is_session_valid, load_cookies

DEBUG_DIR = Path("debug")

# EIS ExtJS config stores dates as new Date(year, month_zero_based, day).
_DATE_JS = re.compile(
    r'id:"(?P<field>tgl1|tgl2)"[^}]*?value:new Date\((\d+),(\d+),(\d+)\)'
)

# A retry is appropriate only for a transport failure, a temporary server
# response, or an expired ASP.NET session. Validation/configuration errors
# should fail clearly instead of causing repeated browser logins.
RETRYABLE_HTTP_STATUS = {408, 425, 429, 500, 502, 503, 504}
RETRYABLE_EXCEPTIONS = (
    requests.ConnectionError,
    requests.Timeout,
    requests.exceptions.ChunkedEncodingError,
)


class EISRequestError(RuntimeError):
    """Base exception for an EIS request/response problem."""


class EISSessionExpired(EISRequestError):
    """EIS redirected to login or returned an expired-session page."""


class EISTransientError(EISRequestError):
    """EIS temporarily failed; the transaction can be retried from GET."""


class EISRetryExhausted(EISRequestError):
    """All retries for one date window failed with a transient error."""


class EISExportError(EISRequestError):
    """Export did not return an Excel file."""


def form_url() -> str:
    return os.getenv("EIS_MOHON_URL") or f"{LOGIN_URL}/mohondetil.aspx"


def _looks_like_login(response: requests.Response) -> bool:
    final_url = (getattr(response, "url", "") or "").lower()
    body = (getattr(response, "text", "") or "").lower()
    return (
        "login.aspx" in final_url
        or 'id="txtuserid"' in body
        or "id='txtuserid'" in body
        or "name=\"txtuserid\"" in body
    )


def _looks_like_expired_session(response: requests.Response) -> bool:
    body = (getattr(response, "text", "") or "").lower()
    markers = (
        "session data tidak ditemukan",
        "session expired",
        "your session has expired",
        "sesi anda telah berakhir",
        "sesi telah berakhir",
    )
    return _looks_like_login(response) or any(marker in body for marker in markers)


def _check_response(response: requests.Response, step: str) -> None:
    """Check status and detect login/session pages before parsing their HTML.

    Do not decode a successful Excel response as text just to check for a
    login marker; exports can be large and are binary content.
    """
    status = response.status_code

    if status in (401, 403):
        raise EISSessionExpired(
            f"{step}: sesi EIS berakhir/ditolak (HTTP {status}; URL {response.url})."
        )

    if status in RETRYABLE_HTTP_STATUS:
        retry_after = response.headers.get("Retry-After")
        suffix = f", Retry-After={retry_after}" if retry_after else ""
        raise EISTransientError(f"{step}: EIS sementara menjawab HTTP {status}{suffix}.")

    if status >= 400:
        raise EISRequestError(
            f"{step}: EIS menjawab HTTP {status} ({response.url})."
        )

    content_type = (response.headers.get("Content-Type") or "").lower()
    content_disposition = (response.headers.get("Content-Disposition") or "").lower()
    if (
        "attachment" in content_disposition
        or "excel" in content_type
        or "octet-stream" in content_type
        or "spreadsheet" in content_type
    ):
        return

    if _looks_like_expired_session(response):
        raise EISSessionExpired(
            f"{step}: EIS mengembalikan halaman login/sesi habis (HTTP {status}; URL {response.url})."
        )


def form_payload(html: str) -> dict[str, str]:
    """Collect successful HTML input controls, including ASP.NET hidden fields."""
    soup = BeautifulSoup(html, "html.parser")
    payload: dict[str, str] = {}

    for inp in soup.find_all("input"):
        name = inp.get("name")
        if not name or inp.has_attr("disabled"):
            continue
        input_type = (inp.get("type") or "").lower()
        if input_type in ("checkbox", "radio") and not inp.has_attr("checked"):
            continue
        payload[name] = inp.get("value", "")

    # WebForms pages can contain named selects/textareas too. Preserve their
    # selected/current values instead of dropping them from the postback.
    for select in soup.find_all("select"):
        name = select.get("name")
        if not name or select.has_attr("disabled"):
            continue
        option = select.find("option", selected=True) or select.find("option")
        if option is not None:
            payload[name] = option.get("value", option.get_text(strip=True))

    for textarea in soup.find_all("textarea"):
        name = textarea.get("name")
        if name and not textarea.has_attr("disabled"):
            payload[name] = textarea.get_text()

    return payload


def filter_fields(
    d_from: date,
    d_to: date,
    jenis: str,
    daya_min: str = EIS_DAYA_MIN,
    daya_max: str = EIS_DAYA_MAX,
) -> dict[str, str]:
    """Return the EIS form values for the requested filters."""
    value = pm.jenis_value(jenis)
    return {
        "tgl1": pm.fmt(d_from),
        "tgl2": pm.fmt(d_to),
        "cboJenis_Value": value,
        "cboJenis": "PB/PD/PS" if value == "SEMUA" else value,
        "TxtDaya1": str(daya_min),
        "TxtDaya2": str(daya_max),
    }


def applied_dates(html: str) -> tuple[date, date] | None:
    """Extract the server-applied date fields from the ExtJS configuration."""
    found: dict[str, date] = {}
    for match in _DATE_JS.finditer(html):
        field = match.group("field")
        year, month_zero_based, day = map(int, match.groups()[1:])
        found[field] = date(year, month_zero_based + 1, day)
    if "tgl1" not in found or "tgl2" not in found:
        return None
    return found["tgl1"], found["tgl2"]


def pager(html: str) -> tuple[int, int, int] | None:
    """Return (page, pages, items), or None if the grid pager is absent."""
    text = BeautifulSoup(html, "html.parser").get_text(" ", strip=True)
    return pm.parse_summary(text)


def is_file_answer(headers, content: bytes) -> bool:
    """Accept only a non-empty attachment/Excel response, not an HTML page."""
    content_type = (headers.get("Content-Type") or "").lower()
    disposition = (headers.get("Content-Disposition") or "").lower()
    marked_as_file = (
        "attachment" in disposition
        or "excel" in content_type
        or "octet-stream" in content_type
        or "spreadsheet" in content_type
    )
    return marked_as_file and bool(content)


def http_session(headless: bool = EIS_HEADLESS, fresh: bool = False) -> requests.Session:
    """Create a Requests session from saved EIS cookies.

    `fresh=True` forces an interactive login. It is used after connection
    resets/session errors; merely re-reading the cookie file is insufficient.
    """
    cookies = None if fresh else load_cookies()
    if not (cookies and is_session_valid(cookies)):
        from playwright.sync_api import sync_playwright
        from app.session import login_page

        with sync_playwright() as playwright:
            browser, _context, _page = login_page(
                playwright, headless=headless, force_login=fresh
            )
            try:
                # login_page saves cookies after a successful login.
                pass
            finally:
                browser.close()

        cookies = load_cookies()
        if not (cookies and is_session_valid(cookies)):
            raise EISSessionExpired(
                f"Login EIS tidak menghasilkan sesi valid ({COOKIE_FILE})."
            )

    session = requests.Session()
    session.headers.update(
        {
            "User-Agent": "Mozilla/5.0",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Connection": "keep-alive",
        }
    )
    for cookie in cookies:
        session.cookies.set(
            cookie["name"],
            cookie["value"],
            domain=cookie.get("domain") or None,
            path=cookie.get("path") or "/",
            secure=bool(cookie.get("secure", False)),
        )
    return session


def _debug(name: str, content: bytes | str) -> None:
    DEBUG_DIR.mkdir(parents=True, exist_ok=True)
    data = content if isinstance(content, bytes) else content.encode("utf-8", "replace")
    (DEBUG_DIR / name).write_bytes(data)


# ---- unit (UP) selection ---------------------------------------------------------------------------------------------------------------------------------------------------
# The top bar of EIS has three combos (UPI, AP, UP). Choosing a UP runs `Coolite.AjaxMethods.finalUP(<code>)`: a POST to default.aspx with
#   submitAjaxEventConfig={"config":{"extraParams":{"xxx":"<code>"}}}, __EVENTTARGET=ScriptManager1, __EVENTARGUMENT=-|public|finalUP, __VIEWSTATE
# which the server keeps in the ASP.NET session; the data pages then follow it. "-SEMUA UP-" is the combo's value for all units.
ALL_UNITS = "-SEMUA UP-"
_UNIT: dict = {"code": None, "known": []}


def set_unit(code: str | None, known: list[str] | None = None) -> None:
    """The unit every `load()` selects first (None = leave the session as it is). `known` = the unit codes of the combo, used to check the table afterwards."""
    _UNIT["code"] = code
    if known is not None:
        _UNIT["known"] = list(known)


def main_url() -> str:
    return f"{LOGIN_URL.rstrip('/')}/default.aspx"


def _unit_rows(html: str) -> list[tuple[str, str]]:
    """Every entry of the UP combo's store as (text, value), "-SEMUA UP-" first (index 0), exactly as the page lists them."""
    m = re.search(r"storeUP_Data\s*=\s*(\[\[.*?\]\])\s*;", html, re.S)
    if not m:
        return []
    try:
        rows = json.loads(m.group(1))
    except ValueError:
        return []
    return [(str(text).strip(), str(value).strip()) for text, value in rows]


def parse_units(html: str) -> list[tuple[str, str]]:
    """The units of the UP combo, as (code, text), without "-SEMUA UP-"."""
    return [(value, text) for text, value in _unit_rows(html) if value and value != ALL_UNITS]


def list_units(session: requests.Session, timeout=(20, 60)) -> list[tuple[str, str]]:
    response = session.get(main_url(), timeout=timeout)
    _check_response(response, "GET halaman utama EIS")
    units = parse_units(response.text)
    if not units:
        raise EISRequestError("Daftar unit (kotak UP di bilah atas EIS) tidak terbaca dari halaman utama; akun mungkin tidak punya pilihan unit.")
    return units


def info_unit(session: requests.Session) -> str | None:
    """The unit EIS keeps in the `Info` cookie (field UP): "SEMUA" for all units, otherwise "<code> - <name>"; None when there is no such cookie."""
    from urllib.parse import parse_qs
    for cookie in session.cookies:
        if cookie.name == "Info":
            values = parse_qs(cookie.value or "", keep_blank_values=True).get("UP")
            return values[0] if values else None
    return None


def select_unit(session: requests.Session, code: str, timeout=(20, 60)) -> None:
    """Choose the unit in the top bar exactly as the combo does. The browser posts the WHOLE form of default.aspx (with the combo fields cboUP_Value / cboUP / cboUP_SelIndex set to the chosen
    unit) as a Coolite AJAX event (header X-Coolite: delta=true, __EVENTARGUMENT=-|public|finalUP). EIS then writes the choice into its `Info` cookie (field UP), and the data pages follow that cookie.
    The AJAX answer itself is an error JSON on the server's side (a return-value conversion) even when it worked, so success is judged by the cookie, never by the answer."""
    response = session.get(main_url(), timeout=timeout)
    _check_response(response, "GET halaman utama EIS")
    html = response.text
    rows = _unit_rows(html)
    entry = next(((i, text) for i, (text, value) in enumerate(rows) if value == code), None)
    if entry is None:
        raise EISRequestError(f"Unit {code} tidak ada di kotak UP halaman utama EIS.")
    index, text = entry
    payload = form_payload(html)
    if not payload.get("__VIEWSTATE"):
        raise EISRequestError("Halaman utama EIS tidak memuat __VIEWSTATE; pilihan unit tidak dapat dikirim.")
    payload.update({
        "submitAjaxEventConfig": json.dumps({"config": {"extraParams": {"xxx": code}}}, separators=(",", ":")),
        "__EVENTTARGET": "ScriptManager1",
        "__EVENTARGUMENT": "-|public|finalUP",
        "cboUP_Value": code,
        "cboUP": text,
        "cboUP_SelIndex": str(index),
    })
    answer = session.post(
        main_url(), data=payload, timeout=timeout,
        headers={"Referer": main_url(), "X-Requested-With": "XMLHttpRequest", "X-Coolite": "delta=true"},
    )
    _check_response(answer, f"Pilih unit {code}")
    if re.search(r"window\.location\s*=\s*\\?[\"']?/?eis/login\.aspx", answer.text, re.I):
        # The page GET above still worked, but the AJAX event answers with a script that sends the browser to the login page: the login in the saved cookies has lapsed (EIS keeps an expiry in
        # its own `Info` cookie, and only one session per account is allowed). This is a session problem, so the run logs in again and repeats, instead of failing the unit.
        raise EISSessionExpired(f"Pilih unit {code}: EIS menjawab perintah menuju halaman login (sesi tidak berlaku lagi).")
    got = info_unit(session)
    expected_all = code == ALL_UNITS
    if not got or (("SEMUA" not in got.upper()) if expected_all else (not got.startswith(code))):
        raise EISRequestError(f"EIS tidak menyimpan pilihan unit {code} (cookie Info.UP = {got!r}); jawaban: {re.sub(chr(10), ' ', answer.text[:120])!r}.")


def unit_check(html: str, code: str, known: list[str]) -> str:
    """After a unit was chosen, judge the unit column (UNITTUJUAN) of the first page of the table:
    'ok' when at least half of the rows that name a known unit name the chosen one, 'mismatch' when fewer do, 'unknown' when there is too little to say (the column is missing, the layout is not
    understood, or fewer than 4 rows name a known unit). A few rows of another unit are NORMAL: EIS filters by the unit of entry, and an application can be addressed to another unit
    (seen in a real run: window 1 of unit 51450 was all 51450, window 2 had some others). A table that was not filtered shows every unit, so the chosen one is a small minority."""
    if code == ALL_UNITS or not known:
        return "unknown"
    soup = BeautifulSoup(html, "html.parser")
    head = soup.find("tr", id=re.compile(r"DXHeadersRow$"))
    if head is None:
        return "unknown"
    cells = [c.get_text(" ", strip=True) for c in head.find_all("td", recursive=False)]
    at = next((i for i, t in enumerate(cells) if re.sub(r"[^A-Z]", "", t.upper()) == "UNITTUJUAN"), None)
    if at is None:
        return "unknown"
    own = other = 0
    for row in soup.find_all("tr", id=re.compile(r"DXDataRow\d+$")):
        data = row.find_all("td", recursive=False)
        if len(data) != len(cells):
            return "unknown"                                   # a layout this check does not understand: no conclusion
        text = data[at].get_text(" ", strip=True)
        if code in text:
            own += 1
        elif any(k in text for k in known):
            other += 1
    if own + other < 4:
        return "unknown"
    return "ok" if own * 2 >= own + other else "mismatch"


def load(
    session: requests.Session,
    d_from: date,
    d_to: date,
    jenis: str,
    timeout=(20, 300),
):
    """GET the form and POST Load Data using that GET's ViewState values."""
    url = form_url()
    if _UNIT["code"] is not None:
        select_unit(session, _UNIT["code"])                    # the choice lives in the EIS session, so it is repeated whenever a session (or a retry) starts over
    response = session.get(url, timeout=timeout)
    _check_response(response, "GET form permohonan")

    html = response.text
    if 'id:"tgl1"' not in html or "__VIEWSTATE" not in html:
        _debug("http_form_gagal.html", html)
        if _looks_like_expired_session(response):
            raise EISSessionExpired("GET form mengembalikan halaman login/sesi habis.")
        raise EISRequestError(
            f"Form permohonan tidak terbaca (HTTP {response.status_code}, "
            f"{len(response.content)} byte): periksa EIS_MOHON_URL ({url}). "
            "Lihat debug/http_form_gagal.html."
        )

    payload = form_payload(html)
    payload.update(filter_fields(d_from, d_to, jenis))
    payload.update({"__EVENTTARGET": "btnCarirange", "__EVENTARGUMENT": ""})

    response = session.post(
        url,
        data=payload,
        headers={"Referer": url},
        timeout=timeout,
    )
    _check_response(response, "POST Load Data")
    result_html = response.text

    got = applied_dates(result_html)
    if got != (d_from, d_to):
        _debug("http_load_gagal.html", result_html)
        raise EISTransientError(
            f"EIS tidak menerapkan filter: tanggal pada jawaban {got}, "
            f"diminta {(d_from, d_to)}. Lihat debug/http_load_gagal.html."
        )

    state = pager(result_html)
    if state is None:
        _debug("http_load_gagal.html", result_html)
        raise EISTransientError(
            "Jawaban EIS tidak memuat pager 'Page 1 of N'. "
            "Transaksi akan dicoba ulang dari GET form; lihat debug/http_load_gagal.html."
        )

    if _UNIT["code"] not in (None, ALL_UNITS) and unit_check(result_html, _UNIT["code"], _UNIT["known"]) == "mismatch":
        raise EISRequestError(f"EIS tampaknya tidak menerapkan pilihan unit {_UNIT['code']}: sebagian besar baris halaman 1 bertujuan ke unit lain. Berhenti agar data unit lain tidak ikut terunggah.")
    return url, result_html, state


def titles(html: str) -> list[str]:
    """Read direct header cells from the DevExpress grid."""
    row = BeautifulSoup(html, "html.parser").find(
        "tr", id=re.compile(r"DXHeadersRow$")
    )
    if row is None:
        return []
    values = [cell.get_text(" ", strip=True) for cell in row.find_all("td", recursive=False)]
    return [value for value in values if value and not value.lower().startswith("drag a column")]


def _data_row_count(html: str) -> int:
    soup = BeautifulSoup(html, "html.parser")
    return len(soup.find_all("tr", id=re.compile(r"DXDataRow\d+$")))


def check(
    d_from=None,
    d_to=None,
    jenis=pm.EIS_JENIS_MOHON,
    headless=EIS_HEADLESS,
    attempts: int | None = None,
):
    """Load a date range and report row count/columns; do not export or upload."""
    d_from, d_to = (d_from, d_to) if d_from and d_to else pm.default_range()
    if d_from > d_to:
        raise ValueError("Tanggal awal setelah tanggal akhir.")

    holder = {"session": http_session(headless)}
    attempts = _retry_attempts(attempts)
    try:
        url, html, (_page, pages, items) = _run_with_retries(
            lambda s: load(s, d_from, d_to, jenis),
            holder,
            d_from,
            d_to,
            headless,
            attempts,
            "Load Data untuk cek",
        )
        row_count = _data_row_count(html)
        names = [pm.canonical_header(title) for title in titles(html)]
        missing = [column for column in pm.REQUIRED if column not in names]
        print(
            f"EIS (HTTP): {items} baris, {pages} halaman; "
            f"{row_count} baris pada halaman pertama; {len(names)} kolom; "
            f"alamat form: {url}"
        )
        if names:
            print(
                "EIS (HTTP): kolom wajib DISTRIVA "
                + ("lengkap." if not missing else "BELUM lengkap, kurang: " + ", ".join(missing))
            )
        else:
            print("EIS (HTTP): judul kolom belum terbaca (tabel kosong atau struktur berbeda).")

        pm.LAST.clear()
        pm.LAST.update({"items": items, "pages": pages})
        return {
            "items": items,
            "pages": pages,
            "dataRows": row_count,
            "titles": names,
            "missing": missing,
        }
    finally:
        holder["session"].close()


def _post_export(
    session: requests.Session,
    url: str,
    html: str,
    d_from: date,
    d_to: date,
    jenis: str,
    out_dir: str | Path,
):
    """POST Export Excel using the postback state returned by Load Data."""
    payload = form_payload(html)
    payload.update(filter_fields(d_from, d_to, jenis))
    payload.update({"__EVENTTARGET": "btnExport", "__EVENTARGUMENT": ""})

    response = session.post(
        url,
        data=payload,
        headers={"Referer": url},
        timeout=(20, 600),
    )
    _check_response(response, "POST Export Excel")

    if not is_file_answer(response.headers, response.content):
        if _looks_like_expired_session(response):
            raise EISSessionExpired("Export Excel mengembalikan halaman login/sesi habis.")
        _debug("http_export_gagal.html", response.content)
        raise EISExportError(
            "Jawaban Export Excel bukan berkas "
            f"(Content-Type {response.headers.get('Content-Type')!r}, "
            f"{len(response.content)} byte); lihat debug/http_export_gagal.html. "
            "Periksa apakah EIS menolak ukuran hasil; rentang akan dicoba lebih kecil."
        )

    target_dir = Path(out_dir)
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / pm.export_filename(d_from, d_to)
    target.write_bytes(response.content)
    return target


def halves(d_from: date, d_to: date):
    """Return two adjacent halves, or None when the window is a single day."""
    if d_from >= d_to:
        return None
    middle = d_from + (d_to - d_from) // 2
    return (d_from, middle), (middle + timedelta(days=1), d_to)


def windows(d_from: date, d_to: date, days: int = 14):
    """Create consecutive windows, oldest first."""
    if days < 1:
        raise ValueError("Jumlah hari per window harus minimal 1.")
    current = d_from
    while current <= d_to:
        end = min(current + timedelta(days=days - 1), d_to)
        yield current, end
        current = end + timedelta(days=1)


def _retry_attempts(value: int | None = None) -> int:
    if value is None:
        value = int(os.getenv("EIS_RETRY_ATTEMPTS", "4"))
    return max(1, min(int(value), 10))


def _retry_delay(attempt: int) -> float:
    """Exponential delay: 2, 4, 8, ... seconds, capped at 30 seconds."""
    return min(2 ** attempt, 30)


def _run_with_retries(
    operation: Callable[[requests.Session], object],
    holder: dict,
    d_from: date,
    d_to: date,
    headless: bool,
    attempts: int,
    label: str,
):
    """Retry a complete operation, always creating a new session after failure.

    For ASP.NET this is important: operation() must perform a new GET and build
    a new payload on every retry; old ViewState/EventValidation is never reused.
    """
    last_error: Exception | None = None
    for attempt in range(1, attempts + 1):
        if attempt > 1:
            delay = _retry_delay(attempt - 1)
            print(
                f"EIS: {pm.fmt(d_from)} - {pm.fmt(d_to)}: "
                f"menunggu {delay} detik sebelum {label}, percobaan {attempt}/{attempts}."
            )
            time.sleep(delay)
            try:
                old_session = holder.get("session")
                if old_session:
                    old_session.close()
                holder["session"] = http_session(headless=headless, fresh=True)
                print("EIS: session diperbarui melalui login ulang.")
            except Exception as exc:
                last_error = exc
                print(
                    f"EIS: login ulang gagal ({type(exc).__name__}: {str(exc)[:160]}), "
                    f"percobaan {attempt}/{attempts}."
                )
                continue

        try:
            return operation(holder["session"])
        except (*RETRYABLE_EXCEPTIONS, EISSessionExpired, EISTransientError) as exc:
            last_error = exc
            print(
                f"EIS: {pm.fmt(d_from)} - {pm.fmt(d_to)}: "
                f"{label} gagal ({type(exc).__name__}: {str(exc)[:180]}), "
                f"percobaan {attempt}/{attempts}."
            )

    message = (
        f"{label} gagal setelah {attempts} percobaan untuk "
        f"{pm.fmt(d_from)} - {pm.fmt(d_to)}: {last_error}"
    )
    raise EISRetryExhausted(message) from last_error


def export_many(
    d_from=None,
    d_to=None,
    jenis=pm.EIS_JENIS_MOHON,
    out_dir=EIS_DOWNLOAD_DIR,
    headless=EIS_HEADLESS,
    max_rows=EIS_MAX_ROWS_PER_FILE,
    max_bytes=EIS_MAX_FILE_BYTES,
    on_file=None,
    attempts: int | None = None,
):
    """Export a date range into files that fit DISTRIVA's row/byte limits.

    Each initial 14-day window is split in half when it has too many rows,
    creates an oversized file, or repeatedly fails from a transient connection
    / server problem. Splitting stops at a single day; a failed single-day
    window raises a clear exception and does not get silently skipped.
    """
    d_from, d_to = (d_from, d_to) if d_from and d_to else pm.default_range()
    if d_from > d_to:
        raise ValueError("Tanggal awal setelah tanggal akhir.")
    if max_rows < 1 or max_bytes < 1:
        raise ValueError("max_rows dan max_bytes harus lebih besar dari 0.")

    Path(out_dir).mkdir(parents=True, exist_ok=True)
    attempts = _retry_attempts(attempts)
    holder = {"session": http_session(headless)}
    results = []

    def export_window(start: date, end: date):
        def transaction(session):
            url, html, state = load(session, start, end, jenis)
            _page, _pages, item_count = state
            if item_count == 0:
                return url, html, state, None
            if item_count > max_rows and halves(start, end) is not None:
                return url, html, state, None
            target = _post_export(session, url, html, start, end, jenis, out_dir)
            return url, html, state, target

        return _run_with_retries(
            transaction,
            holder,
            start,
            end,
            headless,
            attempts,
            "Load Data/Export Excel",
        )

    def process_window(start: date, end: date):
        try:
            _url, _html, (_page, pages, item_count), target = export_window(start, end)
        except EISRetryExhausted as exc:
            parts = halves(start, end)
            if not parts:
                raise
            print(
                f"EIS: {pm.fmt(start)} - {pm.fmt(end)}: masih gagal setelah retry; "
                "rentang diperkecil untuk mengurangi beban server."
            )
            for part_start, part_end in parts:
                process_window(part_start, part_end)
            return
        except EISExportError as exc:
            # A non-file HTML response after a successful Load Data is often
            # EIS refusing a large export. Split only when the range permits it.
            parts = halves(start, end)
            if not parts:
                raise
            print(
                f"EIS: {pm.fmt(start)} - {pm.fmt(end)}: export ditolak ({exc}); "
                "rentang diperkecil."
            )
            for part_start, part_end in parts:
                process_window(part_start, part_end)
            return

        if item_count == 0:
            print(f"EIS: {pm.fmt(start)} - {pm.fmt(end)}: tabel kosong, dilewati.")
            return

        parts = halves(start, end)
        if item_count > max_rows and parts:
            print(
                f"EIS: {pm.fmt(start)} - {pm.fmt(end)}: {item_count} baris "
                f"(> {max_rows}), dibagi dua."
            )
            for part_start, part_end in parts:
                process_window(part_start, part_end)
            return

        if target is None:
            raise EISRequestError(
                f"EIS tidak menghasilkan berkas untuk {pm.fmt(start)} - {pm.fmt(end)}."
            )

        size = target.stat().st_size
        if size > max_bytes and parts:
            target.unlink(missing_ok=True)
            print(
                f"EIS: {pm.fmt(start)} - {pm.fmt(end)}: berkas {size} byte "
                f"melebihi batas {max_bytes}, dibagi dua."
            )
            for part_start, part_end in parts:
                process_window(part_start, part_end)
            return

        if size > max_bytes:
            print(
                f"PERINGATAN: {pm.fmt(start)} (satu hari) berukuran {size} byte, "
                "di atas batas unggah DISTRIVA; naikkan batas di sisi DISTRIVA "
                "atau unggah manual."
            )

        print(
            f"EIS: {pm.fmt(start)} - {pm.fmt(end)}: {item_count} baris "
            f"({pages} halaman) -> {target.name} ({size} byte)"
        )
        results.append((target, item_count))
        if on_file:
            # The caller stages this file immediately. If it raises, this file
            # remains on disk and later windows are not processed.
            on_file(target, item_count)

    try:
        for window_start, window_end in windows(d_from, d_to):
            process_window(window_start, window_end)

        total = sum(row_count for _path, row_count in results)
        print(
            f"EIS: {len(results)} berkas, {total} baris untuk "
            f"{pm.fmt(d_from)} - {pm.fmt(d_to)}."
        )
        pm.LAST.clear()
        pm.LAST.update({"items": total, "files": len(results)})
        return results
    finally:
        holder["session"].close()


def export(
    d_from=None,
    d_to=None,
    jenis=pm.EIS_JENIS_MOHON,
    out_dir=EIS_DOWNLOAD_DIR,
    headless=EIS_HEADLESS,
    attempts: int | None = None,
):
    """Export one range with retry/session recovery; no automatic splitting."""
    d_from, d_to = (d_from, d_to) if d_from and d_to else pm.default_range()
    if d_from > d_to:
        raise ValueError("Tanggal awal setelah tanggal akhir.")
    Path(out_dir).mkdir(parents=True, exist_ok=True)

    holder = {"session": http_session(headless)}
    attempts = _retry_attempts(attempts)
    try:
        def transaction(session):
            url, html, state = load(session, d_from, d_to, jenis)
            _page, pages, item_count = state
            target = None if item_count == 0 else _post_export(
                session, url, html, d_from, d_to, jenis, out_dir
            )
            return pages, item_count, target

        pages, items, target = _run_with_retries(
            transaction,
            holder,
            d_from,
            d_to,
            headless,
            attempts,
            "Export Excel",
        )
        pm.LAST.clear()
        pm.LAST.update({"items": items, "pages": pages})
        print(
            f"EIS (HTTP): {items} baris ({pages} halaman) untuk "
            f"{pm.fmt(d_from)} - {pm.fmt(d_to)}, Jenis Mohon {jenis}."
        )
        if target is None:
            print("EIS: tabel kosong (filter diterapkan server, tidak ada data).")
            return None
        print(f"Unduhan tersimpan: {target} ({target.stat().st_size} byte)")
        return target
    finally:
        holder["session"].close()
