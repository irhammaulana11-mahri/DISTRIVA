"""Tes tanpa jaringan untuk percobaan ulang halaman login EIS (app/session.py): `python -m unittest discover -s tests` dari tools/eis_sync."""
import sys
import types
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
for name in ("dotenv", "playwright", "playwright.sync_api"):
    if name not in sys.modules:
        sys.modules[name] = types.ModuleType(name)
sys.modules["dotenv"].load_dotenv = lambda *a, **k: None
sys.modules["playwright.sync_api"].sync_playwright = lambda: None

from app import session  # noqa: E402


class FakePage:
    def __init__(self, statuses):
        self.statuses = list(statuses)
        self.visited = []
        self.waits = []

    def goto(self, url):
        self.visited.append(url)
        status = self.statuses.pop(0)
        if isinstance(status, Exception):
            raise status
        return types.SimpleNamespace(status=status)

    def wait_for_timeout(self, ms):
        self.waits.append(ms)


class LoginRetryTest(unittest.TestCase):
    def test_server_pulih_pada_percobaan_kedua(self):
        page = FakePage([500, 200])
        session._open_login_page(page)
        self.assertEqual(2, len(page.visited))
        self.assertEqual([session.LOGIN_RETRY_WAIT_MS], page.waits)

    def test_berhasil_langsung_tanpa_menunggu(self):
        page = FakePage([200])
        session._open_login_page(page)
        self.assertEqual(1, len(page.visited))
        self.assertEqual([], page.waits)

    def test_galat_terus_menerus_memberi_pesan_yang_jelas(self):
        page = FakePage([500] * session.LOGIN_ATTEMPTS)
        with self.assertRaises(RuntimeError) as ctx:
            session._open_login_page(page)
        self.assertIn("Server EIS sedang bermasalah (HTTP 500", str(ctx.exception))
        self.assertEqual(session.LOGIN_ATTEMPTS, len(page.visited))
        self.assertEqual(session.LOGIN_ATTEMPTS - 1, len(page.waits))     # tidak menunggu setelah percobaan terakhir

    def test_dns_tidak_resolve_memberi_pesan_jaringan_tanpa_mengulang(self):
        page = FakePage([Exception("Page.goto: net::ERR_NAME_NOT_RESOLVED at http://eis.ap2t.pln.co.id/eis/login.aspx")])
        with self.assertRaises(session.EisTidakTerjangkau) as ctx:
            session._open_login_page(page)
        self.assertIn("ERR_NAME_NOT_RESOLVED", str(ctx.exception))
        self.assertIn("VPN", str(ctx.exception))
        self.assertEqual(1, len(page.visited))
        self.assertEqual([], page.waits)
        self.assertIsInstance(ctx.exception, session.EisTidakTersedia)

    def test_galat_lain_diteruskan_apa_adanya(self):
        page = FakePage([ValueError("sesuatu yang lain")])
        with self.assertRaises(ValueError):
            session._open_login_page(page)


if __name__ == "__main__":
    unittest.main()
