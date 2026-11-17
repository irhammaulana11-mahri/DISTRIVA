"""Sesi Maximo (T&D) lewat HTTP: login, buka aplikasi `plusdwotrk`, kirim kejadian UI (klik) dan jalankan laporan WO.

Bagian UI (login, uisessionid/csrftoken, kejadian `maximo.jsp`) disusun dari tangkapan jaringan 17 Nov 2026 TETAPI BELUM DIUJI terhadap server (tangkapan dimulai setelah login):
`python3 main.py cek` menjalankan tiap langkah dan berhenti dengan pesan jelas di langkah yang gagal. Kredensial hanya dari variabel lingkungan / `.env`, tidak pernah ditulis ke berkas.
"""
import json
import re
from urllib.parse import urljoin

import requests

import report

UA = "Mozilla/5.0 (X11; Linux x86_64) maximo_sync"
RUN_REPORT_TARGET = "RUNAREPORT_1281__QL-tbb"            # tombol "Run report" pada dialog laporan (reportNum 1281, Work Order Details (T&D))


class MaximoError(RuntimeError):
    pass


class MaximoClient:
    def __init__(self, base, user, password, app="plusdwotrk", timeout=60):
        self.base = base.rstrip("/")
        self.user, self.password, self.app, self.timeout = user, password, app, timeout
        self.s = requests.Session()
        self.s.headers["User-Agent"] = UA
        self.uisid = self.csrf = self.table = None
        self.xhr = 0
        self.page_seq = "1"

    # -- sesi -------------------------------------------------------------------------------------------------------------------------------------------
    def login(self):
        """Form login: ambil halaman login, isi kolom nama dan kata sandi apa adanya dari form, kirim. Berhasil bila jawabannya bukan halaman login lagi."""
        r = self.s.get(f"{self.base}/maximo/ui/login", timeout=self.timeout)
        form = _login_form(r.text, r.url)
        if form is None:
            raise MaximoError("halaman login tidak memuat form kata sandi (alamat MAXIMO_URL benar?)")
        action, fields, user_key, pass_key = form
        fields[user_key], fields[pass_key] = self.user, self.password
        r = self.s.post(action, data=fields, timeout=self.timeout, allow_redirects=True)
        if _login_form(r.text, r.url) is not None:
            raise MaximoError("login ditolak: periksa MAXIMO_USERNAME / MAXIMO_PASSWORD (atau akun sedang dipakai di browser)")

    def open_app(self):
        r = self.s.get(f"{self.base}/maximo/ui/", params={"event": "loadapp", "value": self.app}, timeout=self.timeout, allow_redirects=True)
        m = re.search(r"uisessionid=(\d+)", r.url + r.text)
        c = re.search(r"csrftoken[\"']?\s*[:=]\s*[\"']([A-Za-z0-9]{16,64})[\"']", r.text, re.I) or re.search(r"csrftoken=([A-Za-z0-9]{16,64})", r.url + r.text)
        t = re.search(r"(m[0-9a-f]{8})_tdrow_\[C:1\]_ttxt-lb\[R:0\]", r.text)
        if not m or not c:
            raise MaximoError("uisessionid / csrftoken tidak ditemukan pada halaman aplikasi (bentuk halaman belum dikenal)")
        self.uisid, self.csrf, self.table = m.group(1), c.group(1), t.group(1) if t else None
        self.referer = r.url

    # -- kejadian UI ------------------------------------------------------------------------------------------------------------------------------------
    def event(self, target, etype="click", value="", focus=None):
        self.xhr += 1
        events = [{"type": etype, "targetId": target, "value": value, "requestType": "SYNC", "csrftokenholder": self.csrf}]
        data = {"uisessionid": self.uisid, "csrftoken": self.csrf, "currentfocus": focus or target, "scrollleftpos": "0", "localStorage": "true", "scrolltoppos": "0",
                "requesttype": "SYNC", "responsetype": "text/xml", "events": json.dumps(events, separators=(",", ":"))}
        r = self.s.post(f"{self.base}/maximo/ui/maximo.jsp", data=data, timeout=self.timeout,
                        headers={"X-Requested-With": "XMLHttpRequest", "_QM_Try": "1", "pageseqnum": self.page_seq, "xhrseqnum": str(self.xhr), "Referer": getattr(self, "referer", self.base)})
        if r.status_code != 200 or "<server_response" not in r.text:
            raise MaximoError(f"kejadian {etype} {target} ditolak ({r.status_code}); sesi habis?")
        m = re.search(r'csrftoken="([^"]+)"', r.text)
        m and setattr(self, "csrf", m.group(1))
        return r.text

    def row_target(self, row):
        if not self.table:
            raise MaximoError("id tabel daftar WO tidak ditemukan pada halaman aplikasi")
        return f"{self.table}_tdrow_[C:1]_ttxt-lb[R:{row}]"

    def report_of_row(self, row):
        """Klik nomor WO pada baris `row` daftar, tekan Run report, jalankan rantai laporan; jawaban SOAP (teks)."""
        self.event(self.row_target(row))
        answer = self.event(RUN_REPORT_TARGET)
        if "openreport.jsp" not in answer:
            raise MaximoError("tombol Run report tidak membuka laporan (id tombol berubah?)")
        return report.fetch(self.s, self.base, timeout=self.timeout * 2)


def _login_form(page, url):
    """(action, hidden fields, user key, password key) of a login form, or None when the page has no password field."""
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(page, "html.parser")
    for form in soup.find_all("form"):
        pw = form.find("input", {"type": "password"})
        if pw is None:
            continue
        inputs = [i for i in form.find_all("input") if i.get("name")]
        user = next((i for i in inputs if i.get("type", "text") in ("text", "email") and i is not pw), None)
        if user is None:
            continue
        fields = {i["name"]: i.get("value", "") for i in inputs if i.get("type") == "hidden"}
        return urljoin(url, form.get("action") or url), fields, user["name"], pw["name"]
    return None
