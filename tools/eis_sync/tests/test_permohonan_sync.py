"""Offline tests (no EIS, no DISTRIVA): `python -m unittest discover -s tests` from tools/eis_sync. Heavy/optional modules are stubbed so only the logic is exercised."""
import json
import sys
import types
import unittest
from datetime import date
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
for name in ("dotenv", "playwright", "playwright.sync_api"):
    if name not in sys.modules:
        sys.modules[name] = types.ModuleType(name)
sys.modules["dotenv"].load_dotenv = lambda *a, **k: None
sys.modules["playwright.sync_api"].sync_playwright = lambda: None

from app import permohonan  # noqa: E402
from app import permohonan_http as ph  # noqa: E402
from app.distriva import DistrivaClient, DistrivaError, summarize  # noqa: E402


class Resp:
    def __init__(self, status, body, headers=None):
        self.status_code, self._body, self.text = status, body, str(body)
        self.headers = headers if headers is not None else {"Content-Type": "application/json"}

    def json(self):
        return self._body


class DatesTest(unittest.TestCase):
    def test_both_date_formats_and_a_clear_error(self):
        self.assertEqual(permohonan.parse_date("09/11/2026"), date(2026, 11, 9))
        self.assertEqual(permohonan.parse_date("2026-11-09"), date(2026, 11, 9))
        with self.assertRaises(ValueError):
            permohonan.parse_date("9 Nov 2026")

    def test_default_range_is_lookback_days_back_to_today(self):
        self.assertEqual(permohonan.default_range(date(2026, 11, 9), 90), (date(2026, 8, 11), date(2026, 11, 9)))
        self.assertEqual(permohonan.fmt(date(2026, 11, 1)), "01/11/2026")

    def test_export_filename_carries_the_range(self):
        from datetime import datetime
        self.assertEqual(permohonan.export_filename(date(2026, 8, 11), date(2026, 11, 9), datetime(2026, 11, 9, 18, 13, 5)), "permohonan_20260811_20261109_181305.xls")


class ClientTest(unittest.TestCase):
    def client(self, *responses):
        http = mock.Mock()
        http.post.side_effect = list(responses)
        return DistrivaClient("http://x/", "a@b.c", "pw", session=http), http

    def test_a_token_given_by_distriva_is_only_checked_never_logged_in_or_out(self):
        http = mock.Mock()
        http.get.return_value = Resp(200, {"data": {"effective_max_bytes": 1, "max_rows": 1}})
        c = DistrivaClient(base_url="http://x", session=http, token="GIVEN")
        self.assertIsNone(c.login())                                       # no email/password needed: a call to /limits proves the token and slides its idle time
        self.assertEqual("Bearer GIVEN", http.get.call_args.kwargs["headers"]["Authorization"])
        http.post.assert_not_called()
        c.logout()                                                         # DISTRIVA revokes it itself
        http.post.assert_not_called()
        self.assertEqual("GIVEN", c.token)

    def test_login_stage_confirm_logout_use_the_bearer_token(self):
        c, http = self.client(Resp(200, {"token": "T", "mfa": {"required": False, "verified": True}, "user": {"email": "a@b.c"}}),
                              Resp(201, {"data": {"id": "B1", "status": "STAGED", "total_rows": 3, "counts": {"NEW": 2, "REJECT": 1}}}),
                              Resp(200, {"data": {"id": "B1", "status": "CONFIRMED", "total_rows": 3, "counts": {"NEW": 2}}}), Resp(200, {}))
        c.login()
        path = Path(__file__).parent / "_x.xls"
        path.write_bytes(b"x")
        try:
            batch = c.stage(path)
            self.assertEqual(batch["counts"]["NEW"], 2)
            self.assertEqual(c.confirm("B1")["status"], "CONFIRMED")
            c.logout()
        finally:
            path.unlink()
        urls = [call.args[0] for call in http.post.call_args_list]
        self.assertEqual(urls, ["http://x/api/auth/login", "http://x/api/applications/imports", "http://x/api/applications/imports/B1/confirm", "http://x/api/auth/logout"])
        self.assertEqual(http.post.call_args_list[1].kwargs["headers"]["Authorization"], "Bearer T")
        self.assertIsNone(c.token)

    def test_mfa_required_stops_with_a_clear_message(self):
        c, _ = self.client(Resp(200, {"token": "T", "mfa": {"required": True, "verified": False}}))
        with self.assertRaisesRegex(DistrivaError, "MFA"):
            c.login()
        self.assertIsNone(c.token)

    def test_server_errors_carry_their_message(self):
        c, _ = self.client(Resp(401, {"message": "Email atau kata sandi salah."}))
        with self.assertRaisesRegex(DistrivaError, "HTTP 401.*salah"):
            c.login()

    def test_missing_credentials_are_refused_before_any_request(self):
        c = DistrivaClient("http://x", "", "", session=mock.Mock())
        with self.assertRaisesRegex(DistrivaError, "belum diisi"):
            c.login()

    def test_summary_line(self):
        s = summarize({"id": "B", "status": "STAGED", "total_rows": 5, "counts": {"NEW": 3, "MATCHED": 1, "REJECT": 1}})
        self.assertIn("baru 3", s)
        self.assertIn("ditolak 1", s)
        self.assertNotIn("status baru", s)                                      # no breakdown when nothing is out of scope

    def test_summary_explains_why_rows_are_out_of_scope(self):
        s = summarize({"id": "B", "status": "STAGED", "total_rows": 100, "counts": {"NEW": 2, "OUT_OF_SCOPE": 90, "OUT_OF_SCOPE_STATUS": 70, "OUT_OF_SCOPE_POWER": 20}})
        self.assertIn("di luar cakupan 90", s)
        self.assertIn("status baru belum Bayar/Cetak PK 70", s)
        self.assertIn("daya di bawah batas 20", s)


class PageHelpersTest(unittest.TestCase):
    def test_jenis_mohon_accepts_the_shown_text_or_the_value_and_refuses_a_typo(self):
        self.assertEqual(permohonan.jenis_value("PB/PD/PS"), "SEMUA")
        self.assertEqual(permohonan.jenis_value("semua"), "SEMUA")
        self.assertEqual([permohonan.jenis_value(x) for x in ("PB", "pd", "PS")], ["PB", "PD", "PS"])
        with self.assertRaises(ValueError):
            permohonan.jenis_value("PBPD")

    def test_the_pager_summary_is_parsed(self):
        self.assertEqual(permohonan.parse_summary("Page 1 of 0 (0 items)"), (1, 0, 0))
        self.assertEqual(permohonan.parse_summary("Page 3 of 276 (2.755 items)"), (3, 276, 2755))
        self.assertIsNone(permohonan.parse_summary("No data to display"))


class DescribeTest(unittest.TestCase):
    def state(self, **over):
        st = {"items": 12, "pages": 2, "dataRows": 10, "reloaded": True, "titles": ["No", "No. Agenda", "Nama", "Jenis Transaksi", "Unit Tujuan"], "invalid": [], "nodata": False}
        st.update(over)
        return st

    def test_a_complete_table_is_reported_with_its_counts_and_required_columns(self):
        text = "\n".join(permohonan.describe(self.state()))
        self.assertIn("12 baris, 2 halaman", text)
        self.assertIn("muat ulang halaman: ya", text)
        self.assertIn("Kolom wajib DISTRIVA lengkap", text)

    def test_a_table_that_was_not_reloaded_and_a_missing_column_are_flagged(self):
        text = "\n".join(permohonan.describe(self.state(reloaded=False, items=0, dataRows=0, titles=["No. Agenda", "Nama"], invalid=["TxtDaya2"])))
        self.assertIn("muat ulang halaman: TIDAK", text)
        self.assertIn("JENIS_TRANSAKSI", text)
        self.assertIn("UNITTUJUAN", text)
        self.assertIn("TxtDaya2", text)


RAW_FORM = """<html><body><form id="form1" action="mohondetil.aspx"><input type="hidden" name="__VIEWSTATE" value="VS1"><input type="hidden" name="__EVENTVALIDATION" value="EV1">
<input type="hidden" name="__EVENTTARGET" value=""><input type="hidden" name="cboUPIENTRI_Value" value="" disabled><input type="checkbox" name="unchecked" value="x">
<input type="checkbox" name="checked" value="y" checked></form><script>new Ext.form.DateField({id:"tgl1",renderTo:"tgl1_Container",allowBlank:false,format:"d/m/Y",value:new Date(2026,10,1)});
new Ext.form.DateField({id:"tgl2",renderTo:"tgl2_Container",format:"d/m/Y",value:new Date(2026,10,9)});</script></body></html>"""
LOADED = RAW_FORM + '<table><tr><td class="dxpSummary_Youthful">Page 1 of 235 (2342 items)</td></tr></table>'


class HttpResp:
    def __init__(self, text="", status=200, headers=None, content=None):
        self.text, self.status_code, self.headers = text, status, headers or {}
        self.content = content if content is not None else text.encode()


class HttpTest(unittest.TestCase):
    def test_the_payload_is_what_a_browser_would_submit(self):
        p = ph.form_payload(RAW_FORM)
        self.assertEqual(p["__VIEWSTATE"], "VS1")
        self.assertNotIn("cboUPIENTRI_Value", p)             # disabled: not sent
        self.assertNotIn("unchecked", p)
        self.assertEqual(p["checked"], "y")

    def test_the_filter_fields_use_the_page_values_and_a_wide_daya_range(self):
        f = ph.filter_fields(date(2026, 11, 1), date(2026, 11, 9), "PB/PD/PS")
        self.assertEqual(f["tgl1"], "01/11/2026")
        self.assertEqual(f["tgl2"], "09/11/2026")
        self.assertEqual(f["cboJenis_Value"], "SEMUA")
        self.assertEqual((f["TxtDaya1"], f["TxtDaya2"]), ("0", "99999999"))                    # the end of Range Daya is mandatory
        self.assertEqual(ph.filter_fields(date(2026, 11, 1), date(2026, 11, 9), "pd")["cboJenis_Value"], "PD")

    def test_the_dates_the_server_echoes_and_the_pager_are_read(self):
        self.assertEqual(ph.applied_dates(RAW_FORM), (date(2026, 11, 1), date(2026, 11, 9)))
        self.assertIsNone(ph.applied_dates("<html></html>"))
        self.assertEqual(ph.pager(LOADED), (1, 235, 2342))
        self.assertIsNone(ph.pager(RAW_FORM))

    def test_the_header_titles_are_the_direct_cells_only(self):
        html = '<table><tr id="GV_DXHeadersRow"><td><table><tr><td>No. Agenda</td></tr></table></td><td>Nama</td><td>Jenis Transaksi</td><td>Unit Tujuan</td></tr></table>'
        found = ph.titles(html)
        self.assertEqual(len(found), 4)                                                 # the nested cell is not counted twice
        self.assertEqual([permohonan.canonical_header(x) for x in found], ["NOAGENDA", "NAMA", "JENIS_TRANSAKSI", "UNITTUJUAN"])
        self.assertEqual(ph.titles("<html></html>"), [])

    def test_only_a_real_file_is_accepted_as_the_export(self):
        self.assertTrue(ph.is_file_answer({"Content-Disposition": "attachment; filename=x.xls"}, b"abc"))
        self.assertTrue(ph.is_file_answer({"Content-Type": "application/vnd.ms-excel"}, b"abc"))
        self.assertFalse(ph.is_file_answer({"Content-Type": "text/html"}, b"<html>error</html>"))
        self.assertFalse(ph.is_file_answer({"Content-Type": "application/vnd.ms-excel"}, b""))

    def run_export(self, post_answers, tmp):
        session = mock.Mock()
        session.get.return_value = HttpResp(RAW_FORM)
        session.post.side_effect = post_answers
        with mock.patch.object(ph, "http_session", return_value=session), mock.patch.object(ph, "DEBUG_DIR", Path(tmp)):
            return ph.export(date(2026, 11, 1), date(2026, 11, 9), "PB/PD/PS", out_dir=tmp), session

    def test_export_replays_load_data_then_export_excel_and_saves_the_file(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            path, session = self.run_export([HttpResp(LOADED), HttpResp("", headers={"Content-Disposition": "attachment; filename=x.xls"}, content=b"XLSDATA")], tmp)
            self.assertEqual(Path(path).read_bytes(), b"XLSDATA")
            first, second = (c.kwargs["data"] for c in session.post.call_args_list)
            self.assertEqual((first["__EVENTTARGET"], second["__EVENTTARGET"]), ("btnCarirange", "btnExport"))
            self.assertEqual(first["tgl1"], "01/11/2026")
            self.assertEqual(first["__VIEWSTATE"], "VS1")
            self.assertEqual(permohonan.LAST["items"], 2342)

    def test_a_server_that_did_not_apply_the_filter_or_shows_no_pager_is_a_failure_not_empty_data(self):
        import tempfile
        other_dates = LOADED.replace("new Date(2026,10,9)", "new Date(2026,10,30)")
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(RuntimeError, "tidak menerapkan filter"):
                self.run_export([HttpResp(other_dates)], tmp)
            with self.assertRaisesRegex(RuntimeError, "tidak memuat tabel"):
                self.run_export([HttpResp(RAW_FORM)], tmp)

    def test_an_empty_table_returns_none_and_an_html_export_answer_is_refused(self):
        import tempfile
        empty = LOADED.replace("Page 1 of 235 (2342 items)", "Page 1 of 0 (0 items)")
        with tempfile.TemporaryDirectory() as tmp:
            path, _ = self.run_export([HttpResp(empty)], tmp)
            self.assertIsNone(path)
            with self.assertRaisesRegex(RuntimeError, "bukan berkas"):
                self.run_export([HttpResp(LOADED), HttpResp("<html>Error</html>", headers={"Content-Type": "text/html"})], tmp)



class WindowsTest(unittest.TestCase):
    def covered(self, calls):
        days = []
        for a, b in sorted(calls):
            d = a
            while d <= b:
                days.append(d)
                d = date.fromordinal(d.toordinal() + 1)
        return days

    def test_a_long_range_is_cut_in_consecutive_windows_without_gap_or_overlap(self):
        w = ph.windows(date(2026, 5, 1), date(2026, 11, 9))
        self.assertEqual(w[0], (date(2026, 5, 1), date(2026, 5, 14)))
        self.assertEqual(w[-1][1], date(2026, 11, 9))
        days = self.covered(w)
        self.assertEqual(len(days), (date(2026, 11, 9) - date(2026, 5, 1)).days + 1)
        self.assertEqual(len(set(days)), len(days))
        self.assertEqual(ph.windows(date(2026, 11, 1), date(2026, 11, 9)), [(date(2026, 11, 1), date(2026, 11, 9))])      # a short range stays one window

    def test_halves_cover_the_range_exactly_and_a_single_day_cannot_be_cut(self):
        (a1, b1), (a2, b2) = ph.halves(date(2026, 11, 1), date(2026, 11, 8))
        self.assertEqual((a1, b1, a2, b2), (date(2026, 11, 1), date(2026, 11, 4), date(2026, 11, 5), date(2026, 11, 8)))
        self.assertEqual(ph.halves(date(2026, 11, 1), date(2026, 11, 2))[0][1], date(2026, 11, 1))
        self.assertIsNone(ph.halves(date(2026, 11, 1), date(2026, 11, 1)))

    def run_many(self, rows_per_day, max_rows, file_bytes=100, max_bytes=10**9, empty_days=()):
        import tempfile
        calls = []

        def fake_load(session, a, b, jenis):
            n = sum(rows_per_day for k in range((b - a).days + 1) if date.fromordinal(a.toordinal() + k) not in empty_days)
            return "http://x/f", "<html></html>", (1, max(1, n // 10), n)

        def fake_post(session, url, html, a, b, jenis, out_dir):
            calls.append((a, b))
            target = Path(out_dir) / f"{a:%Y%m%d}_{b:%Y%m%d}.xls"
            target.write_bytes(b"x" * file_bytes)
            return target

        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(ph, "http_session", return_value=mock.Mock()), mock.patch.object(ph, "load", fake_load), \
                mock.patch.object(ph, "_post_export", fake_post):
            res = ph.export_many(date(2026, 5, 1), date(2026, 11, 9), "PB/PD/PS", out_dir=tmp, max_rows=max_rows, max_bytes=max_bytes)
        return res, calls

    def test_every_window_fits_the_row_limit_and_together_they_cover_every_day_once(self):
        res, calls = self.run_many(rows_per_day=233, max_rows=3000)
        self.assertTrue(all(n <= 3000 for _, n in res))
        days = WindowsTest.covered(self, calls)
        self.assertEqual(len(days), (date(2026, 11, 9) - date(2026, 5, 1)).days + 1)
        self.assertEqual(len(set(days)), len(days))
        self.assertEqual(sum(n for _, n in res), 233 * len(days))

    def test_a_window_over_the_limit_is_halved_and_empty_windows_are_skipped(self):
        empty = {date(2026, 5, d) for d in range(1, 15)}                                              # the whole first window has no data
        res, calls = self.run_many(rows_per_day=600, max_rows=3000, empty_days=empty)
        self.assertTrue(all(n <= 3000 for _, n in res))
        self.assertGreater(len(calls), len(ph.windows(date(2026, 5, 1), date(2026, 11, 9))) - 1)       # 14 days x 600 = 8400 rows: cut further
        self.assertNotIn(date(2026, 5, 1), WindowsTest.covered(self, calls))                          # an empty window is never exported
        days = WindowsTest.covered(self, calls)
        self.assertEqual(len(set(days)), len(days))                                                    # nothing exported twice

    def test_a_failed_export_is_retried_and_each_file_is_handed_over_as_it_is_made(self):
        import tempfile
        seen, tries = [], {"n": 0}

        def fake_post(session, url, html, a, b, jenis, out_dir):
            tries["n"] += 1
            if tries["n"] <= 2:                                                                       # the EIS answers a page instead of the file, twice
                raise RuntimeError("bukan berkas")
            target = Path(out_dir) / f"{a:%Y%m%d}_{b:%Y%m%d}.xls"
            target.write_bytes(b"x")
            return target

        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(ph, "http_session", return_value=mock.Mock()), \
                mock.patch.object(ph, "load", return_value=("u", "<html></html>", (1, 5, 50))), mock.patch.object(ph, "_post_export", fake_post), mock.patch.object(ph.time, "sleep"), mock.patch.object(ph, "http_session", return_value=mock.Mock()):
            res = ph.export_many(date(2026, 11, 1), date(2026, 11, 3), "PB/PD/PS", out_dir=tmp, on_file=lambda f, n: seen.append((f.name, n)))
        self.assertEqual(len(res), 1)
        self.assertEqual(seen, [("20261101_20261103.xls", 50)])
        self.assertEqual(tries["n"], 3)

    def test_an_empty_table_right_after_a_failed_export_is_a_failure_not_no_data(self):
        import tempfile
        loads = iter([("u", "<html></html>", (1, 5, 50)), ("u", "<html></html>", (1, 0, 0)), ("u", "<html></html>", (1, 0, 0)), ("u", "<html></html>", (1, 0, 0))])
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(ph, "http_session", return_value=mock.Mock()) as hs, mock.patch.object(ph, "load", side_effect=lambda *a: next(loads)), \
                mock.patch.object(ph, "_post_export", side_effect=RuntimeError("x")), mock.patch.object(ph.time, "sleep"):
            with self.assertRaises(RuntimeError):
                ph.export_many(date(2026, 11, 1), date(2026, 11, 3), "PB/PD/PS", out_dir=tmp)
        self.assertGreaterEqual(hs.call_count, 3)                                                       # the login was renewed on each retry

    def test_a_network_timeout_while_loading_renews_the_login_and_resumes_the_window(self):
        import tempfile
        import requests
        calls = {"n": 0}

        def flaky_load(*a):
            calls["n"] += 1
            if calls["n"] == 1:
                raise requests.exceptions.ReadTimeout("Read timed out. (read timeout=300)")
            return ("u", "<html></html>", (1, 5, 50))

        def fake_post(session, url, html, a, b, jenis, out_dir):
            target = Path(out_dir) / f"{a:%Y%m%d}_{b:%Y%m%d}.xls"
            target.write_bytes(b"x")
            return target

        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(ph, "http_session", return_value=mock.Mock()) as hs, mock.patch.object(ph, "load", flaky_load), \
                mock.patch.object(ph, "_post_export", fake_post), mock.patch.object(ph.time, "sleep"):
            res = ph.export_many(date(2026, 11, 1), date(2026, 11, 3), "PB/PD/PS", out_dir=tmp)
        self.assertEqual(len(res), 1)
        self.assertEqual(calls["n"], 2)
        self.assertGreaterEqual(hs.call_count, 2)                                                       # first session + the login renewed after the timeout

    def test_a_export_that_keeps_failing_raises_after_the_attempts(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(ph, "http_session", return_value=mock.Mock()), \
                mock.patch.object(ph, "load", return_value=("u", "<html></html>", (1, 5, 50))), mock.patch.object(ph, "_post_export", side_effect=RuntimeError("x")), mock.patch.object(ph.time, "sleep"):
            with self.assertRaises(RuntimeError):
                ph.export_many(date(2026, 11, 1), date(2026, 11, 3), "PB/PD/PS", out_dir=tmp)

    def test_an_oversize_file_is_deleted_and_its_window_halved(self):
        res, calls = self.run_many(rows_per_day=100, max_rows=3000, file_bytes=6000, max_bytes=5000)
        names = [Path(p).stem for p, _ in res]
        self.assertEqual(len(res), (date(2026, 11, 9) - date(2026, 5, 1)).days + 1)                   # 6000 bytes > 5000 all the way down to single days
        self.assertTrue(all(n.split("_")[0] == n.split("_")[1] for n in names))
        self.assertTrue(all(not Path(p).exists() for p, _ in res))                                    # the temporary directory is gone: files were real while it lasted


class StaleTest(unittest.TestCase):
    def args(self, **over):
        import argparse
        base = dict(dari=None, sampai=None, jenis=None, metode="http", sumber="excel", konfirmasi=True, lengkapi=True, berkas=None)
        base.update(over)
        return argparse.Namespace(**base)

    def test_a_non_distriva_server_gets_a_message_that_names_it(self):
        http = mock.Mock()
        http.post.return_value = Resp(400, "400 - Bad Request", headers={"Content-Type": "text/plain", "Server": "HPLIP_Printer_Application/3.22"})
        c = DistrivaClient("http://127.0.0.1:8000", "a@b.c", "pw", session=http)
        with self.assertRaisesRegex(DistrivaError, "tidak menjawab seperti DISTRIVA.*HPLIP.*8001"):
            c.login()

    def test_the_stale_call_asks_for_the_applications_older_than_the_range(self):
        http = mock.Mock()
        http.get.return_value = Resp(200, {"data": {"total": 3, "oldest": "2026-05-01", "by_unit": []}})
        c = DistrivaClient("http://x", "a", "b", session=http)
        c.token = "T"
        self.assertEqual(c.stale(date(2026, 8, 11))["total"], 3)
        self.assertEqual(http.get.call_args.kwargs["params"], {"before": "2026-08-11"})
        self.assertEqual(http.get.call_args.kwargs["headers"]["Authorization"], "Bearer T")

    def test_no_stale_application_means_nothing_more_is_pulled(self):
        import main
        client = mock.Mock()
        client.stale.return_value = {"total": 0, "oldest": None}
        with mock.patch.object(main, "_export") as ex:
            main._stale_check(client, self.args(), date(2026, 8, 11))
        ex.assert_not_called()

    def test_stale_applications_are_only_reported_without_confirmation(self):
        import main
        client = mock.Mock()
        client.stale.return_value = {"total": 5, "oldest": "2026-03-02"}
        with mock.patch.object(main, "_export") as ex:
            main._stale_check(client, self.args(konfirmasi=False), date(2026, 8, 11))
            main._stale_check(client, self.args(lengkapi=False), date(2026, 8, 11))
        ex.assert_not_called()

    def test_files_already_handed_over_by_on_file_are_not_uploaded_a_second_time(self):
        import main
        client = mock.Mock()
        client.stale.return_value = {"total": 2, "oldest": "2026-03-02"}
        args = self.args()
        args.on_file = "per-unit-hook"

        def export(a, start, end):
            files = [(Path("a.xlsx"), 1), (Path("b.xlsx"), 2)]
            for f in files:
                a.on_file(*f)
            return files

        with mock.patch.object(main, "_export", side_effect=export), mock.patch.object(main, "_upload") as up:
            main._stale_check(client, args, date(2026, 8, 11))
        self.assertEqual(up.call_count, 2)
        self.assertEqual(args.on_file, "per-unit-hook")

    def test_with_confirmation_the_old_range_is_pulled_up_to_the_oldest_stale_day_and_confirmed(self):
        import main
        client = mock.Mock()
        client.stale.side_effect = [{"total": 5, "oldest": "2026-03-02"}, {"total": 0, "oldest": None}]
        with mock.patch.object(main, "_export", return_value=[("old.xls", 700)]) as ex, mock.patch.object(main, "_upload") as up:
            main._stale_check(client, self.args(), date(2026, 8, 11))
        self.assertEqual(ex.call_args.args[1:], (date(2026, 3, 2), date(2026, 8, 10)))                # from the oldest stale day to the day before the range
        up.assert_called_once_with(client, "old.xls", 700, True, delete=True)
        self.assertEqual(client.stale.call_count, 2)                                                    # checked again afterwards

    def test_the_backfill_never_reaches_further_back_than_the_limit(self):
        import main
        from app import config
        client = mock.Mock()
        client.stale.side_effect = [{"total": 2, "oldest": "2020-01-01"}, {"total": 2, "oldest": "2020-01-01"}]
        with mock.patch.object(main, "_export", return_value=[]) as ex:
            main._stale_check(client, self.args(), date(2026, 8, 11))
        self.assertEqual((date(2026, 8, 11) - ex.call_args.args[1]).days, config.EIS_MAX_BACKFILL_DAYS)

    def test_giving_only_one_date_is_refused(self):
        import main
        with self.assertRaises(SystemExit):
            main._range(self.args(dari="01/11/2026"))
        self.assertEqual(main._range(self.args(dari="01/11/2026", sampai="09/11/2026")), (date(2026, 11, 1), date(2026, 11, 9)))



class LimitsTest(unittest.TestCase):
    LIM = {"max_rows": 20000, "effective_max_bytes": 2 * 1048576, "php_upload_max_bytes": 2 * 1048576, "php_post_max_bytes": 8 * 1048576, "max_bytes_config": 5 * 1048576}

    def test_the_files_are_cut_to_what_the_server_really_accepts(self):
        import io
        import main
        client = mock.Mock()
        client.limits.return_value = self.LIM
        with mock.patch("sys.stdout", io.StringIO()):
            got = main._limits(client)
        self.assertEqual(got["max_bytes"], int(2 * 1048576 * 0.9))                       # 90 % of 2 MB
        self.assertEqual(got["max_rows"], got["max_bytes"] // main.BYTES_PER_ROW)            # ~1,300 rows a file instead of 3,000
        self.assertLess(got["max_rows"], 3000)

    def test_a_big_server_limit_never_raises_the_configured_ones(self):
        import io
        import main
        client = mock.Mock()
        client.limits.return_value = dict(self.LIM, effective_max_bytes=50 * 1048576, php_upload_max_bytes=50 * 1048576)
        with mock.patch("sys.stdout", io.StringIO()):
            got = main._limits(client)
        from app import config
        self.assertEqual(got["max_rows"], config.EIS_MAX_ROWS_PER_FILE)
        self.assertEqual(got["max_bytes"], config.EIS_MAX_FILE_BYTES)

    def test_sync_logs_in_reads_the_limits_exports_with_them_and_logs_in_again_before_uploading(self):
        import io
        import main
        with mock.patch("app.distriva.DistrivaClient") as C, mock.patch.object(main, "_export", return_value=[("a.xls", 10)]) as ex, mock.patch.object(main, "_upload"), \
                mock.patch.object(main, "_stale_check"), mock.patch("sys.stdout", io.StringIO()):
            C.return_value.limits.return_value = self.LIM
            main.main(["sync", "--metode", "http", "--dari", "01/11/2026", "--sampai", "09/11/2026"])
        order = [c[0] for c in C.return_value.method_calls]
        self.assertEqual(order[:3], ["login", "limits", "login"])                       # login, limits, (export), fresh login
        self.assertEqual(ex.call_args.args[0].limits["max_bytes"], int(2 * 1048576 * 0.9))

    def test_upload_failures_name_the_php_limit_and_the_web_server_limit(self):
        http = mock.Mock()
        c = DistrivaClient("http://x", "a", "b", session=http)
        http.post.return_value = Resp(422, {"message": "The file failed to upload."})
        with self.assertRaisesRegex(DistrivaError, "upload_max_filesize"):
            c._check(http.post.return_value, "Unggah berkas")
        with self.assertRaisesRegex(DistrivaError, "client_max_body_size"):
            c._check(Resp(413, {"message": "Request Entity Too Large"}), "Unggah berkas")

    def test_the_limits_call_reads_the_server_limits(self):
        http = mock.Mock()
        http.get.return_value = Resp(200, {"data": self.LIM})
        c = DistrivaClient("http://x", "a", "b", session=http)
        c.token = "T"
        self.assertEqual(c.limits()["effective_max_bytes"], 2 * 1048576)
        self.assertTrue(http.get.call_args.args[0].endswith("/api/applications/imports/limits"))



class DeleteAfterSyncTest(unittest.TestCase):
    def make(self, tmp, name="a.xls"):
        path = Path(tmp) / name
        path.write_bytes(b"x")
        return str(path)

    def client(self, total=10, confirm_error=None, stage_error=None):
        c = mock.Mock()
        if stage_error:
            c.stage.side_effect = stage_error
        else:
            c.stage.return_value = {"id": "B", "status": "STAGED", "total_rows": total, "counts": {"NEW": total}}
        c.confirm.return_value = {"id": "B", "status": "CONFIRMED", "total_rows": total, "counts": {"NEW": total}}
        if confirm_error:
            c.confirm.side_effect = confirm_error
        return c

    def run_upload(self, client, path, expected, confirm, delete):
        import io
        import main
        with mock.patch("sys.stdout", io.StringIO()):
            return main._upload(client, path, expected, confirm, delete=delete)

    def test_the_file_is_deleted_after_a_successful_staging_and_confirmation(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            p = self.make(tmp)
            self.run_upload(self.client(), p, 10, True, True)
            self.assertFalse(Path(p).exists())

    def test_the_file_is_deleted_after_a_staging_only_run_too(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            p = self.make(tmp)
            c = self.client()
            self.run_upload(c, p, 10, False, True)
            c.confirm.assert_not_called()
            self.assertFalse(Path(p).exists())

    def test_the_file_is_kept_when_the_counts_differ_and_nothing_is_confirmed(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            p = self.make(tmp)
            c = self.client(total=9)
            self.run_upload(c, p, 10, True, True)
            c.confirm.assert_not_called()                                            # a count that differs is never applied automatically
            self.assertTrue(Path(p).exists())

    def test_the_file_is_kept_when_the_upload_or_the_confirmation_fails(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            p = self.make(tmp)
            with self.assertRaises(DistrivaError):
                self.run_upload(self.client(stage_error=DistrivaError("x")), p, 10, True, True)
            self.assertTrue(Path(p).exists())
            with self.assertRaises(DistrivaError):
                self.run_upload(self.client(confirm_error=DistrivaError("y")), p, 10, True, True)
            self.assertTrue(Path(p).exists())

    def test_a_file_given_with_berkas_or_kept_with_simpan_berkas_is_never_deleted(self):
        import io
        import tempfile
        import main
        with tempfile.TemporaryDirectory() as tmp:
            given = self.make(tmp, "given.xls")
            kept = self.make(tmp, "kept.xls")
            with mock.patch("app.distriva.DistrivaClient") as C, mock.patch("sys.stdout", io.StringIO()):
                C.return_value.stage.return_value = {"id": "B", "status": "STAGED", "total_rows": 1, "counts": {"NEW": 1}}
                C.return_value.confirm.return_value = {"id": "B", "status": "CONFIRMED", "total_rows": 1, "counts": {"NEW": 1}}
                main.main(["sync", "--berkas", given, "--konfirmasi"])
                with mock.patch.object(main, "_export", return_value=[(kept, 1)]), mock.patch.object(main, "_stale_check"), mock.patch.object(main, "_limits", return_value={}):
                    main.main(["sync", "--metode", "http", "--konfirmasi", "--simpan-berkas"])
            self.assertTrue(Path(given).exists())
            self.assertTrue(Path(kept).exists())

    def test_a_downloaded_file_is_deleted_by_a_normal_sync(self):
        import io
        import tempfile
        import main
        with tempfile.TemporaryDirectory() as tmp:
            p = self.make(tmp)
            with mock.patch("app.distriva.DistrivaClient") as C, mock.patch("sys.stdout", io.StringIO()):
                C.return_value.stage.return_value = {"id": "B", "status": "STAGED", "total_rows": 1, "counts": {"NEW": 1}}
                C.return_value.confirm.return_value = {"id": "B", "status": "CONFIRMED", "total_rows": 1, "counts": {"NEW": 1}}
                with mock.patch.object(main, "_export", return_value=[(p, 1)]), mock.patch.object(main, "_stale_check"), mock.patch.object(main, "_limits", return_value={}):
                    main.main(["sync", "--metode", "http", "--konfirmasi"])
            self.assertFalse(Path(p).exists())



class MenuTest(unittest.TestCase):
    def test_the_menu_pattern_accepts_detil_and_detail_in_any_case(self):
        for label in ("MONITORING PERMOHONAN (Detil)", "Monitoring Permohonan (Detail)", "MONITORING  PERMOHONAN ( DETIL )", "monitoring permohonan(detil)"):
            self.assertTrue(permohonan.MENU_PATTERN.search(label), label)
        for label in ("MONITORING PERMOHONAN", "MONITORING PERMOHONAN (Rekap)", "Mon.Permohonan (Detil)"):
            self.assertFalse(permohonan.MENU_PATTERN.search(label), label)


class GridTest(unittest.TestCase):
    def test_display_titles_map_back_to_the_export_names(self):
        for shown, name in [("No. Agenda", "NOAGENDA"), ("Jenis Transaksi", "JENIS_TRANSAKSI"), ("Unit Tujuan", "UNITTUJUAN"), ("Status Permohonan", "STATUS_PERMOHONAN"),
                            ("TGL_UPDATE_PERMOHONAN", "TGL_UPDATE_PERMOHONAN"), ("nama", "NAMA")]:
            self.assertEqual(permohonan.canonical_header(shown), name)
        self.assertEqual(permohonan.canonical_header("Kolom Aneh"), "Kolom Aneh")        # unknown titles are kept (DISTRIVA ignores them)
        self.assertEqual(len(permohonan.CANONICAL), 44)

    def test_a_grid_read_becomes_a_csv_with_the_export_names(self):
        import csv
        path = Path(__file__).parent / "_grid.csv"
        try:
            permohonan.write_rows_csv(["No", "No. Agenda", "Nama", "Jenis Transaksi", "Unit Tujuan", "Status Permohonan"], [["1", "A1", "BUDI", "PASANG BARU", "51453", "DISETUJUI"], ["2", "A2", "SITI"]], path)
            rows = list(csv.reader(open(path, encoding="utf-8")))
        finally:
            path.unlink()
        self.assertEqual(rows[0], ["No", "NOAGENDA", "NAMA", "JENIS_TRANSAKSI", "UNITTUJUAN", "STATUS_PERMOHONAN"])
        self.assertEqual(rows[2], ["2", "A2", "SITI", "", "", ""])                      # a short row is padded, never shifted

    def test_a_read_without_a_required_column_is_refused(self):
        with self.assertRaisesRegex(ValueError, "UNITTUJUAN"):
            permohonan.write_rows_csv(["No. Agenda", "Nama", "Jenis Transaksi"], [["A1", "BUDI", "PASANG BARU"]], Path(__file__).parent / "_never.csv")
        self.assertFalse((Path(__file__).parent / "_never.csv").exists())


class MainTest(unittest.TestCase):
    def test_sync_warns_when_the_staged_rows_differ_from_the_eis_table(self):
        import io
        import main
        buf = io.StringIO()
        with mock.patch("sys.stdout", buf), mock.patch("app.distriva.DistrivaClient") as C, mock.patch("app.permohonan.export", return_value="f.xls"):
            permohonan.LAST.clear()
            permohonan.LAST.update({"items": 100})
            C.return_value.stage.return_value = {"id": "B", "status": "STAGED", "total_rows": 97, "counts": {"NEW": 97}}
            main.main(["sync"])
        self.assertIn("PERINGATAN", buf.getvalue())
        self.assertIn("100", buf.getvalue())

    def test_no_command_prints_the_usage_and_runs_nothing(self):
        import io
        import main
        buf = io.StringIO()
        with mock.patch("sys.stdout", buf), mock.patch("app.distriva.DistrivaClient") as C:
            self.assertEqual(main.main([]), 0)
        self.assertIn("python main.py inspect", buf.getvalue())
        C.assert_not_called()

    def test_sync_with_a_file_skips_the_eis_and_does_not_confirm_by_default(self):
        import main
        with mock.patch("app.distriva.DistrivaClient") as C:
            inst = C.return_value
            inst.stage.return_value = {"id": "B9", "status": "STAGED", "total_rows": 1, "counts": {"NEW": 1}}
            self.assertEqual(main.main(["sync", "--berkas", "f.xls"]), 0)
            inst.stage.assert_called_once_with("f.xls")
            inst.confirm.assert_not_called()
            inst.logout.assert_called_once()
            main.main(["sync", "--berkas", "f.xls", "--konfirmasi"])
            inst.confirm.assert_called_once_with("B9")

UNIT_PAGE = ('<input name="__VIEWSTATE" value="VS123"/><script>this.storeUP_Data=[["-SEMUA UP-","-SEMUA UP-"],["51450 - MOJOAGUNG","51450"],'
             '["51453 - JOMBANG","51453"],["51460 - NGANJUK","51460"]];this.storeUP = 1;</script>')


def grid(*units, columns=("NOAGENDA", "UNITTUJUAN")):
    head = "<tr id=\"g_DXHeadersRow\">" + "".join(f"<td>{c}</td>" for c in columns) + "</tr>"
    rows = "".join(f"<tr id=\"g_DXDataRow{i}\"><td>A{i}</td><td>{u}</td></tr>" for i, u in enumerate(units))
    return f"<table>{head}{rows}</table>"


class UnitSelectionTest(unittest.TestCase):
    def test_the_units_come_from_the_combo_store_without_semua_up(self):
        self.assertEqual(ph.parse_units(UNIT_PAGE), [("51450", "51450 - MOJOAGUNG"), ("51453", "51453 - JOMBANG"), ("51460", "51460 - NGANJUK")])
        self.assertEqual(ph.parse_units("<html>tanpa kotak UP</html>"), [])

    def test_choosing_a_unit_posts_the_whole_form_as_a_coolite_event_and_is_judged_by_the_cookie(self):
        page = UNIT_PAGE + '<input type="hidden" name="__EVENTVALIDATION" value="EV"/><input type="hidden" name="cboUP_Value" value=""/><input type="text" name="cboUP" value=""/><input type="hidden" name="cboAP_Value" value="51MJK - MOJOKERTO"/>'
        session = mock.Mock()
        session.get.return_value = HttpResp(page)
        session.post.return_value = HttpResp('{errorMessage:"System.Exception: ..."}')                 # EIS answers an error JSON even when the choice was saved
        session.cookies = [types.SimpleNamespace(name="Info", value="UPI=51&UP=51453%20-%20JOMBANG&AP=x")]
        ph.select_unit(session, "51453")
        call = session.post.call_args
        data, headers = call.kwargs["data"], call.kwargs["headers"]
        self.assertEqual(headers["X-Coolite"], "delta=true")
        self.assertEqual((data["__EVENTTARGET"], data["__EVENTARGUMENT"], data["__VIEWSTATE"], data["__EVENTVALIDATION"]), ("ScriptManager1", "-|public|finalUP", "VS123", "EV"))
        self.assertEqual((data["cboUP_Value"], data["cboUP"], data["cboUP_SelIndex"], data["cboAP_Value"]), ("51453", "51453 - JOMBANG", "2", "51MJK - MOJOKERTO"))     # the combo fields of the page are kept
        self.assertEqual(json.loads(data["submitAjaxEventConfig"]), {"config": {"extraParams": {"xxx": "51453"}}})
        session.post.return_value = HttpResp('{script:"window.location=\\"/eis/login.aspx\\";"}')                    # EIS sends the browser to the login page: a lapsed session, which the run retries after a new login
        session.cookies = []
        with self.assertRaises(ph.EISSessionExpired):
            ph.select_unit(session, "51453")
        session.post.return_value = HttpResp('{errorMessage:"x"}')
        session.cookies = [types.SimpleNamespace(name="Info", value="UPI=51&UP=SEMUA&AP=x")]           # the cookie did not change: the choice was not saved
        with self.assertRaises(ph.EISRequestError):
            ph.select_unit(session, "51453")
        session.get.return_value = HttpResp("<html>tanpa viewstate</html>")
        with self.assertRaises(ph.EISRequestError):
            ph.select_unit(session, "51453")
        session.get.return_value = HttpResp(page)
        with self.assertRaises(ph.EISRequestError):                                                    # a unit that is not in the combo
            ph.select_unit(session, "99999")
        session.cookies = [types.SimpleNamespace(name="Info", value="UPI=51&UP=SEMUA&AP=x")]
        ph.select_unit(session, ph.ALL_UNITS)                                                          # back to every unit: the cookie says SEMUA
        self.assertEqual(session.post.call_args.kwargs["data"]["cboUP_SelIndex"], "0")

    def test_the_table_is_checked_against_the_chosen_unit_and_a_few_rows_of_another_unit_are_normal(self):
        known = ["51450", "51453", "51460"]
        self.assertEqual(ph.unit_check(grid(*["51453"] * 6), "51453", known), "ok")
        self.assertEqual(ph.unit_check(grid(*["51453"] * 7, "51460", "51450", "51460"), "51453", known), "ok")          # filtered by entry unit: some applications go to another unit
        self.assertEqual(ph.unit_check(grid("51453", "51460", "51450", "51450", "51460", "51460", "51450", "51453"), "51453", known), "mismatch")   # not filtered: every unit appears
        self.assertEqual(ph.unit_check(grid(*["51460"] * 6), "51453", known), "mismatch")
        self.assertEqual(ph.unit_check(grid("51453 - JOMBANG", *["51453"] * 5), "51453", known), "ok")
        self.assertEqual(ph.unit_check(grid("51453", "51460"), "51453", known), "unknown")                                # too few rows to say
        self.assertEqual(ph.unit_check(grid(*["JOMBANG"] * 6), "51453", known), "unknown")                                # no known code in the cells
        self.assertEqual(ph.unit_check(grid(*["51453"] * 6, columns=("A", "B")), "51453", known), "unknown")
        self.assertEqual(ph.unit_check(grid(*["51453"] * 6), ph.ALL_UNITS, known), "unknown")

    def test_load_chooses_the_unit_first_every_time_and_refuses_a_table_of_another_unit(self):
        calls = []
        session = mock.Mock()
        form = '<input name="__VIEWSTATE" value="v"/>id:"tgl1"'
        session.get.side_effect = lambda *a, **k: (calls.append("get"), HttpResp(form))[1]
        with mock.patch.object(ph, "select_unit", side_effect=lambda s, c: calls.append(f"unit {c}")), \
                mock.patch.object(ph, "applied_dates", return_value=(date(2026, 11, 10), date(2026, 11, 10))), mock.patch.object(ph, "pager", return_value=(1, 1, 3)):
            session.post.return_value = HttpResp(grid(*["51453"] * 6))
            ph.set_unit("51453", ["51453", "51460"])
            try:
                ph.load(session, date(2026, 11, 10), date(2026, 11, 10), "SEMUA")
                self.assertEqual(calls[:2], ["unit 51453", "get"])
                session.post.return_value = HttpResp(grid("51460", "51460", "51450", "51460", "51450", "51460"))
                with self.assertRaises(ph.EISRequestError):
                    ph.load(session, date(2026, 11, 10), date(2026, 11, 10), "SEMUA")
            finally:
                ph.set_unit(None, [])


class RealUnitPageTest(unittest.TestCase):
    """The answer EIS gave for unit 51450 (tools/samples/mohondetil.aspx, saved by hand from the browser, 16 Nov 2026). It holds customer data, so it is NOT part of the repository: the test only runs where the file exists."""
    PATH = Path(__file__).resolve().parents[2] / "samples" / "mohondetil.aspx"
    KNOWN = ["51450", "51452", "51453", "51454", "51455", "51456", "51457", "51458", "51459", "51460"]

    @unittest.skipUnless(PATH.is_file(), "tools/samples/mohondetil.aspx tidak ada")
    def test_a_table_filtered_by_the_unit_is_recognised_and_another_unit_is_refused(self):
        html = self.PATH.read_text(encoding="utf-8", errors="replace")
        self.assertEqual(ph.pager(html), (1, 23, 230))                                            # 230 items for this unit and range
        self.assertIn("UNITTUJUAN", ph.titles(html))
        self.assertEqual(ph.unit_check(html, "51450", self.KNOWN), "ok")                         # every row of the first page belongs to 51450
        self.assertEqual(ph.unit_check(html, "51453", self.KNOWN), "mismatch")


class PerUnitSyncTest(unittest.TestCase):
    def test_units_are_processed_one_after_another_a_failure_does_not_stop_the_rest_and_the_session_returns_to_all_units(self):
        import main as eis_main
        order, uploaded = [], []
        client = mock.Mock()
        args = types.SimpleNamespace(metode="http", berkas=None, per_unit=True, unit=None, konfirmasi=True, simpan=False, lengkapi=False, jenis=None, sumber="excel")

        def fake_export(a, d_from, d_to):
            code = ph._UNIT["code"]
            order.append(f"export {code}")
            if code == "51453":
                raise ph.EISRequestError("EIS tidak menjawab")
            a.on_file(f"{code}.xls", 5)
            return [(f"{code}.xls", 5)]

        with mock.patch.object(ph, "http_session", return_value=mock.Mock()), \
                mock.patch.object(ph, "list_units", return_value=[("51450", "MOJOAGUNG"), ("51453", "JOMBANG"), ("51460", "NGANJUK")]), \
                mock.patch.object(ph, "select_unit", side_effect=lambda s, c: order.append(f"reset {c}")), \
                mock.patch.object(eis_main, "_export", side_effect=fake_export), \
                mock.patch.object(eis_main, "_limits", return_value={}), \
                mock.patch.object(eis_main, "_upload", side_effect=lambda c, path, exp, conf, delete=False: uploaded.append(path)), \
                mock.patch.object(eis_main, "_stale_check", side_effect=lambda *a: order.append(f"stale {ph._UNIT['code']}")):
            code = eis_main._sync_units(client, args, date(2026, 11, 1), date(2026, 11, 10))
        self.assertEqual(code, 1)                                                                     # a unit failed: the run is visibly incomplete
        self.assertEqual(order, ["export 51450", "export 51453", "export 51460", f"stale {ph.ALL_UNITS}", f"reset {ph.ALL_UNITS}"])
        self.assertEqual(uploaded, ["51450.xls", "51460.xls"])                                         # 51453 failed, the others went up
        self.assertIsNone(ph._UNIT["code"])

    def test_only_the_named_units_run_and_an_unknown_unit_is_refused_before_anything_starts(self):
        import main as eis_main
        args = types.SimpleNamespace(unit=["51453,51460"])
        with mock.patch.object(ph, "list_units", return_value=[("51450", "A"), ("51453", "B"), ("51460", "C")]):
            units, known = eis_main._unit_choices(args, mock.Mock())
            self.assertEqual((units, known), ([("51453", "B"), ("51460", "C")], ["51450", "51453", "51460"]))
            with self.assertRaises(SystemExit):
                eis_main._unit_choices(types.SimpleNamespace(unit=["99999"]), mock.Mock())


if __name__ == "__main__":
    unittest.main()
