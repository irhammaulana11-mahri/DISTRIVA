"""Client of the DISTRIVA import API for the EIS Excel export (docs/62 §52): log in -> upload the file (STAGED) -> optionally confirm.

POST /api/applications/imports stages the file: every row is classified (NEW / MATCHED / UNCHANGED / REJECT) and nothing is written to the applications until
POST /api/applications/imports/{id}/confirm. The account needs `applications.import` (NIAGA_RETAIL of a ULP, or SYS_ADMIN, who also needs MFA — a scheduled job cannot
give it, so a SYS_ADMIN login stops here with a clear message).
"""
import requests

from app.config import DISTRIVA_EMAIL, DISTRIVA_PASSWORD, DISTRIVA_TOKEN, DISTRIVA_URL


class DistrivaError(RuntimeError):
    pass


class DistrivaClient:
    def __init__(self, base_url=DISTRIVA_URL, email=DISTRIVA_EMAIL, password=DISTRIVA_PASSWORD, session=None, timeout=120, token=DISTRIVA_TOKEN):
        self.base_url = base_url.rstrip("/")
        self.email = email
        self.password = password
        self.http = session or requests.Session()
        self.timeout = timeout
        self.token = token or None
        self.external_token = bool(token)          # given by DISTRIVA (it started this run and revokes the token itself): never logged in or out here

    def _headers(self):
        return {"Accept": "application/json", "Authorization": f"Bearer {self.token}"} if self.token else {"Accept": "application/json"}

    def _check(self, res, what):
        ctype = (getattr(res, "headers", None) or {}).get("Content-Type", "")
        if ctype and "json" not in ctype.lower():       # not DISTRIVA (Laravel answers the API with JSON): e.g. another program on the same port
            server = (res.headers or {}).get("Server", "?")
            raise DistrivaError(f"{what} gagal: {self.base_url} tidak menjawab seperti DISTRIVA (HTTP {res.status_code}, {ctype}, Server: {server}). "
                                "Periksa DISTRIVA_URL: `php artisan serve` pindah ke port 8001, 8002, ... bila 8000 sudah dipakai program lain.")
        if res.status_code >= 400:
            try:
                msg = res.json().get("message") or res.text[:300]
            except ValueError:
                msg = res.text[:300]
            if "failed to upload" in str(msg).lower():
                msg += " (PHP menolak berkas: biasanya lebih besar dari upload_max_filesize server, bawaan 2 MB; naikkan di php.ini atau biarkan alat memotong berkas sesuai batas dari /api/applications/imports/limits)"
            elif res.status_code == 413:
                msg += " (server web menolak ukuran berkas: naikkan client_max_body_size pada nginx)"
            raise DistrivaError(f"{what} gagal (HTTP {res.status_code}): {msg}")
        return res.json()

    def login(self):
        if self.external_token:
            self.limits()                          # any call slides the token's idle timeout, and proves the token still works
            return None
        if not self.email or not self.password:
            raise DistrivaError("DISTRIVA_EMAIL / DISTRIVA_PASSWORD belum diisi di .env")
        body = self._check(self.http.post(f"{self.base_url}/api/auth/login", json={"email": self.email, "password": self.password, "device_name": "eis-sync"}, headers={"Accept": "application/json"}, timeout=self.timeout), "Login DISTRIVA")
        mfa = body.get("mfa") or {}
        if mfa.get("required") and not mfa.get("verified"):
            raise DistrivaError("Akun ini memerlukan verifikasi MFA; pakai akun Niaga Retail untuk sinkron otomatis.")
        if body.get("must_change_password"):
            raise DistrivaError("Akun ini harus mengganti kata sandi dulu.")
        self.token = body["token"]
        return body.get("user")

    def stage(self, path):
        with open(path, "rb") as fh:
            res = self.http.post(f"{self.base_url}/api/applications/imports", files={"file": (str(path).split("/")[-1], fh)}, headers=self._headers(), timeout=self.timeout)
        return self._check(res, "Unggah berkas")["data"]

    def confirm(self, batch_id):
        res = self.http.post(f"{self.base_url}/api/applications/imports/{batch_id}/confirm", headers=self._headers(), timeout=self.timeout)
        return self._check(res, "Konfirmasi impor")["data"]

    def limits(self):
        """What an upload can really be on this server: {max_rows, effective_max_bytes, php_upload_max_bytes, ...} (PHP's upload_max_filesize is often only 2 MB)."""
        res = self.http.get(f"{self.base_url}/api/applications/imports/limits", headers=self._headers(), timeout=self.timeout)
        return self._check(res, "Pembacaan batas unggah")["data"]

    def stale(self, before):
        """Running EIS applications of this account's scope that were requested before `before` (a date): a sync that starts at that date never refreshes them."""
        res = self.http.get(f"{self.base_url}/api/applications/imports/stale", params={"before": str(before)}, headers=self._headers(), timeout=self.timeout)
        return self._check(res, "Pemeriksaan permohonan lama")["data"]

    def import_eis_reports(self, name, content):
        """Upload one ZIP (folders ULP/BULAN/<laporan>.xls) to the monthly EIS report import (docs/88): {results: [{name, ok, status, family, unit, period, lines, warnings | message}]}.
        HTTP 422 means every file of the archive failed; the per-file reasons are still in the answer, so they are returned instead of raised."""
        res = self.http.post(f"{self.base_url}/api/eis-reports/import", files={"files[]": (name, content, "application/zip")}, headers=self._headers(), timeout=max(self.timeout, 600))
        if res.status_code == 422:
            try:
                body = res.json()
                if isinstance(body.get("results"), list):
                    return body
            except ValueError:
                pass
        return self._check(res, "Unggah laporan EIS")

    def logout(self):
        if self.external_token:
            return
        if self.token:
            try:
                self.http.post(f"{self.base_url}/api/auth/logout", headers=self._headers(), timeout=30)
            finally:
                self.token = None


def summarize(batch):
    c = batch.get("counts") or {}
    return (f"batch {batch.get('id')} [{batch.get('status')}] {batch.get('total_rows')} baris: "
            f"baru {c.get('NEW', 0)}, cocok {c.get('MATCHED', 0)}, tak berubah {c.get('UNCHANGED', 0)}, ditolak {c.get('REJECT', 0)}, di luar cakupan {c.get('OUT_OF_SCOPE', 0)}"
            + _scope_detail(c))


def _scope_detail(c):
    """Why rows are out of scope: a new application is taken only when paid / PK printed (status) and only from the minimum power (power)."""
    status, power = c.get("OUT_OF_SCOPE_STATUS", 0), c.get("OUT_OF_SCOPE_POWER", 0)
    if not (status or power):
        return ""
    return f" (status baru belum Bayar/Cetak PK {status}, daya di bawah batas {power})"
