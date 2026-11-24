"""Tes tanpa jaringan untuk laporan saldo piutang (app/saldo_http.py): `python -m unittest discover -s tests` dari tools/eis_sync."""
import io
import sys
import types
import unittest
import zipfile
from pathlib import Path
from urllib.parse import parse_qs, unquote

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
for name in ("dotenv", "playwright", "playwright.sync_api"):
    if name not in sys.modules:
        sys.modules[name] = types.ModuleType(name)
sys.modules["dotenv"].load_dotenv = lambda *a, **k: None
sys.modules["playwright.sync_api"].sync_playwright = lambda: None

from app import saldo_http as sh  # noqa: E402

XLS = b"\xd0\xcf\x11\xe0" + b"x" * 3000


class Reply:
    def __init__(self, body, status=200, ctype="text/html"):
        self.content = body if isinstance(body, bytes) else body.encode()
        self.text = self.content.decode("utf-8", "replace")
        self.status_code, self.headers, self.url = status, {"Content-Type": ctype}, "http://eis/x"


def form(extra="", head=""):
    buttons = '<input type="submit" name="btnLoad" value="Load"><input type="submit" name="btnExport" value="Export"><input type="image" name="imgGo" src="x.png"><input type="button" name="btnX" value="x">'
    return f'<html><body><form><input type="hidden" name="__VIEWSTATE" value="VS"><input type="hidden" name="GV$CallbackState" value="CB"><select name="cbo"><option value="a">A</option><option value="b" selected>B</option></select>{buttons}{extra}<span>{head}</span></form></body></html>'


class FakeSession:
    """GET answers a form; a POST is recorded and answered with Excel (or with the page again when it is the Load Data of the KOGOL page)."""

    def __init__(self, head="REKAP SALDO PAL PER TANGGAL 20 , UP : 51453 ( MUTASI : 10/2026)", export=XLS):
        self.head, self.export, self.gets, self.posts = head, export, [], []

    def get(self, url, **kw):
        self.gets.append(url)
        self.get_headers = getattr(self, "get_headers", []) + [kw.get("headers")]
        return Reply(form())

    def post(self, url, data=None, **kw):
        self.posts.append((url, dict(data)))
        if data.get("__EVENTTARGET") == "btnLoad":
            return Reply(form(head=self.head))
        return Reply(self.export, ctype="application/vnd.ms-excel")


class MonthsTest(unittest.TestCase):
    def test_months_between_crosses_the_year_and_a_bad_month_is_refused(self):
        self.assertEqual(sh.months_between("2025-11", "2026-02"), ["2025-11", "2025-12", "2026-01", "2026-02"])
        self.assertEqual(sh.parse_month("2026-10"), "2026-10")
        for bad in ("2026-13", "10/2026", "2026-1"):
            with self.assertRaises(SystemExit):
                sh.parse_month(bad)


class ExcelCheckTest(unittest.TestCase):
    def test_only_a_real_and_not_tiny_excel_is_accepted(self):
        self.assertEqual(sh.check_excel(XLS, "application/vnd.ms-excel", 200), "xls")
        self.assertEqual(sh.check_excel(b"PK" + b"x" * 3000, "x", 200), "xlsx")
        with self.assertRaisesRegex(sh.SaldoError, "bukan Excel"):
            sh.check_excel(b"<html>login</html>" * 200, "text/html", 200)
        with self.assertRaisesRegex(sh.SaldoError, "kemungkinan kosong"):
            sh.check_excel(b"\xd0\xcf\x11\xe0" + b"x" * 100, "application/vnd.ms-excel", 200)


class MycubeTest(unittest.TestCase):
    def test_the_page_is_loaded_with_the_unit_and_month_in_its_address_and_exported_with_all_its_fields(self):
        s = FakeSession()
        data, ext = sh.fetch_mycube(s, "LEMBAR", "51453", "2026-10")
        self.assertEqual((data, ext), (XLS, "xls"))
        self.assertIn("jenis=saldo_lalu_eis_lbr", s.gets[0])
        self.assertEqual(unquote(s.gets[0].split("parameter=")[1]), "'51453';'202610';'PERLEMBAR'")
        sent = s.posts[0][1]
        self.assertEqual((sent["listExportFormatx"], sent["btnSave"], sent["__VIEWSTATE"], sent["GV$CallbackState"], sent["cbo"]), ("Excel", "Save", "VS", "CB", "b"))
        for other in ("btnLoad", "btnExport", "imgGo", "btnX"):                         # tombol lain tidak boleh ikut: EIS menganggapnya tombol yang diklik
            self.assertNotIn(other, sent)
        sh.fetch_mycube(s, "PRABAYAR", "51453", "2026-10")
        self.assertIn("jenis=saldo_lalu_ap3t_tarif_up", s.gets[2])                                       # gets[1] = halaman induk menu
        self.assertEqual(unquote(s.gets[2].split("parameter=")[1]), "'51453';'51MJK';'51';'202610'")      # ULP; AP (UP3); UPI; bulan
        sh.fetch_mycube(s, "GOLONGAN", "51454", "2026-01")
        self.assertIn("jenis=saldo_lalu_eis&", s.gets[3])
        self.assertIn("PERGOLONGAN", unquote(s.gets[3]))
        self.assertEqual(sh.LAPORAN, ("GOLONGAN", "LEMBAR", "KOGOL", "PRABAYAR"))


class ParentPageTest(unittest.TestCase):
    def test_the_prepaid_report_opens_its_menu_page_first_and_asks_for_the_data_page_with_that_referer(self):
        s = FakeSession()
        sh.fetch_mycube(s, "PRABAYAR", "51453", "2026-10")
        self.assertTrue(s.gets[0].endswith("/saldolaluap3t.aspx"))                          # halaman induk dulu, seperti peramban
        self.assertIn("mycube.aspx?jenis=saldo_lalu_ap3t_tarif_up", s.gets[1])
        self.assertEqual(s.get_headers[1]["Referer"], s.gets[0])
        self.assertTrue(s.posts[0][0].startswith(s.gets[1].split("&parameter")[0]))        # POST ke halaman data yang sama

    def test_the_standalone_reports_do_not_open_a_parent_page(self):
        s = FakeSession()
        sh.fetch_mycube(s, "GOLONGAN", "51453", "2026-10")
        self.assertEqual(len(s.gets), 1)
        self.assertIn("mycube.aspx", s.gets[0])


class KogolTest(unittest.TestCase):
    def test_load_data_then_export_when_the_title_names_the_requested_unit_and_month(self):
        s = FakeSession()
        data, ext = sh.fetch_kogol(s, "51453", "2026-10")
        self.assertEqual(ext, "xls")
        self.assertEqual([p[1]["__EVENTTARGET"] for p in s.posts], ["btnLoad", "btnExport"])
        self.assertTrue(all(p[1]["cbojenis_Value"] == "KOGOL" for p in s.posts))
        for _url, sent in s.posts:
            self.assertNotIn("btnLoad", sent)
            self.assertNotIn("btnExport", sent)

    def test_a_title_for_another_unit_or_month_is_refused_before_anything_is_exported(self):
        s = FakeSession(head="REKAP SALDO PAL PER TANGGAL 20 , UP : 51453 ( MUTASI : 08/2026)")
        with self.assertRaisesRegex(sh.SaldoError, "bukan 51453 10/2026"):
            sh.fetch_kogol(s, "51453", "2026-10")
        self.assertEqual([p[1]["__EVENTTARGET"] for p in s.posts], ["btnLoad"])
        with self.assertRaisesRegex(sh.SaldoError, "judul laporan KOGOL tidak ditemukan"):
            sh.fetch_kogol(FakeSession(head="tanpa judul"), "51453", "2026-10")


class FormFieldsTest(unittest.TestCase):
    def test_buttons_and_files_are_left_out_and_checked_boxes_selects_and_textareas_are_kept(self):
        html = ('<form><input name="a" value="1"><input type="checkbox" name="c1" value="x" checked><input type="checkbox" name="c2" value="y">'
                '<input type="radio" name="r" value="z"><select name="s"><option>P</option><option value="q" selected>Q</option></select><textarea name="t">isi</textarea>'
                '<input type="submit" name="go" value="Go"><input type="file" name="f"><input type="reset" name="rs"></form>')
        self.assertEqual(sh.form_fields(html), {"a": "1", "c1": "x", "s": "q", "t": "isi"})
        self.assertEqual(sh.form_fields("<p>tanpa form</p>"), {})


class DiagnosisTest(unittest.TestCase):
    def test_fields_after_a_form_closed_early_by_malformed_html_are_still_collected(self):
        html = ('<form><input type="hidden" name="__VIEWSTATE" value="VS"><table><tr><td><input name="a" value="1"></td></tr></form>'
                '<div><input type="hidden" name="ASPxPopupControl1$DropDownList2" value="Excel"></div></table><input name="z" value="9"></form>')
        self.assertEqual(sh.form_fields(html), {"__VIEWSTATE": "VS", "a": "1", "ASPxPopupControl1$DropDownList2": "Excel", "z": "9"})

    def test_an_http_500_names_the_fields_sent_and_the_start_of_the_answer_and_keeps_its_kind(self):
        class Broken(FakeSession):
            def post(self, url, data=None, **kw):
                self.posts.append((url, dict(data)))
                self.headers_seen = kw.get("headers")
                return Reply("<html><body><h1>Server Error</h1><p>Invalid postback or callback argument.</p></body></html>", status=500)

        s = Broken()
        with self.assertRaises(sh.eis.EISTransientError) as ctx:
            sh.fetch_mycube(s, "PRABAYAR", "51453", "2026-10")
        message = str(ctx.exception)
        self.assertIn("HTTP 500", message)
        self.assertIn("Invalid postback or callback argument", message)
        self.assertIn("isian terkirim", message)
        self.assertIn("__EVENTVALIDATION=TIDAK ADA", message)                      # halaman tiruan tidak punya isian itu: terlihat jelas
        self.assertEqual(s.headers_seen["Origin"], "http://eis.ap2t.pln.co.id")  # header POST seperti peramban
        self.assertEqual(s.headers_seen["Referer"], s.gets[1])                          # POST: Referer = halaman data (gets[0] = halaman induk)


class RetryTest(unittest.TestCase):
    def test_a_transient_eis_error_is_retried_and_other_files_continue_when_it_keeps_failing(self):
        calls = {"n": 0}
        original = sh.fetch_mycube

        def flaky(sess, report, ulp, month):
            calls["n"] += 1
            if calls["n"] < 3:
                raise sh.eis.EISTransientError("EIS sementara menjawab HTTP 500.")
            return XLS, "xls"

        class Client:
            def login(self):
                pass

            def import_eis_reports(self, name, content):
                return {"results": []}

        sh.fetch_mycube = flaky
        saved = (sh.eis, sh.TRANSIENT_DELAY)
        sh.TRANSIENT_DELAY = 0
        sh.eis = types.SimpleNamespace(http_session=lambda fresh=False: FakeSession(), EISSessionExpired=saved[0].EISSessionExpired, EISTransientError=saved[0].EISTransientError, RETRYABLE_EXCEPTIONS=saved[0].RETRYABLE_EXCEPTIONS,
                                       ALL_UNITS="-SEMUA UP-", select_unit=lambda *a: None, form_payload=saved[0].form_payload, _check_response=lambda *a: None)
        try:
            code = sh.run(Client(), [("51453", "JOMBANG")], ["2026-10"], ["GOLONGAN"], pause=0)
        finally:
            sh.fetch_mycube = original
            sh.eis, sh.TRANSIENT_DELAY = saved
        self.assertEqual(code, 0)                       # berhasil pada percobaan ketiga
        self.assertEqual(calls["n"], 3)


class ZipTest(unittest.TestCase):
    def test_the_archive_keeps_the_unit_and_month_folders_the_import_reads(self):
        z = zipfile.ZipFile(io.BytesIO(sh.build_zip([("51453/2026-10/GOLONGAN.xls", XLS), ("51453/2026-10/KOGOL.xls", XLS)])))
        self.assertEqual(z.namelist(), ["51453/2026-10/GOLONGAN.xls", "51453/2026-10/KOGOL.xls"])
        self.assertIsNone(z.testzip())


class RunTest(unittest.TestCase):
    def test_one_zip_per_month_is_uploaded_and_a_failed_file_makes_the_exit_code_one(self):
        uploads = []

        class Client:
            def login(self):
                pass

            def import_eis_reports(self, name, content):
                uploads.append((name, zipfile.ZipFile(io.BytesIO(content)).namelist()))
                return {"results": [{"name": f"{name} › {n}", "ok": True, "status": "BARU", "family": "309", "unit": "u", "period": "p", "lines": 1} for n in uploads[-1][1]]}

        session = FakeSession()
        calls = {"n": 0}
        original = sh.fetch_mycube

        def flaky(sess, report, ulp, month):
            calls["n"] += 1
            if (report, ulp, month) == ("LEMBAR", "51454", "2026-10"):
                raise sh.SaldoError("kosong")
            return original(sess, report, ulp, month)

        sh.fetch_mycube = flaky
        sh.eis = types.SimpleNamespace(http_session=lambda fresh=False: session, EISSessionExpired=RuntimeError, ALL_UNITS="-SEMUA UP-", select_unit=lambda *a: None, form_payload=sh.eis.form_payload, _check_response=lambda *a: None)
        try:
            code = sh.run(Client(), [("51453", "JOMBANG"), ("51454", "NGORO")], ["2026-10"], ["GOLONGAN", "LEMBAR"], pause=0)
        finally:
            sh.fetch_mycube = original
        self.assertEqual(code, 1)
        self.assertEqual(uploads, [("eis-piutang-2026-10.zip", ["51453/2026-10/GOLONGAN.xls", "51453/2026-10/LEMBAR.xls", "51454/2026-10/GOLONGAN.xls"])])


if __name__ == "__main__":
    unittest.main()
