import csv
import html
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import wo  # noqa: E402

HEAD = ("Work Order Details 100000001: INSPEKSI GARDU HD0744 Asset: Location: GD01.1 GD HD0744 PENYULANG X HI Value: KURANG HI Numeric Value: 0 HI Total Value: 31 dari 171 "
        "Sched Start: Site: TND Job Plan: Sched Finish: Priority: Supervisor: S1 Target Start: 3 Agustus 2026 Work Type: INST1 Lead: L1 Target Finish: 3 Agustus 2026 Status: COMP Vendor: "
        "Actual Start: 3 Agustus 2026 Parent: Owner: 51453.INSPEKTOR.3 Actual Finish: 13 Agustus 2026 Failure Class: Report Date: 3 Agustus 2026 Problem Code: Reported By: X kMs: 0 Task IDs Task ID")


def tr(*cells):
    return "<tr>" + "".join(f"<td>{c}</td>" for c in cells) + "</tr>"


def report(extra=""):
    rows = [tr("Sequence", "Meter", "Meter Description", "Measure date", "Measurement Value", "Measure Unit", "Mandatory", "Observation", "HI Value"),
            tr("INSPEKSI GARDU HD0744", "", "", "", "", "", "", "", ""),
            tr("80", "PEMBEBANANTRAFO", "Pembebanan Trafo", "Aug 13, 2026 16:34:06", "52.65", "%", "1", "", "Baik"),
            tr("60", "KETIDAKSEIMBANGANPHASA", "Imbalance", "Aug 13, 2026 16:34:06", "15.07", "%", "1", "", "Cukup"),
            tr("91153677 HANTARAN TR, LVCABLE JURUSAN A", "", "", "", "", "", "", "", "")]
    for seq, meter, at, val, unit in [(10, "R-0", "13:13:15", "229", "V"), (20, "S-0", "13:13:16", "228", "V"), (30, "T-0", "13:13:18", "230", "V"), (40, "BEBAN-R", "13:13:21", "55", "A"),
                                      (50, "BEBAN-S", "13:13:23", "82", "A"), (60, "BEBAN-T", "13:13:25", "60", "A"), (70, "BEBAN-N", "13:13:27", "42", "A"), (80, "BEBAN-R-NORMAL", "13:13:29", "99", "A")]:
        rows.append(tr(seq, meter, meter, f"Aug 12, 2026 {at}", val, unit, "1", "", ""))
    rows.append(tr(120, "RATINGNHFUSER", "Rating NH Fuse R", "Aug 12, 2026 13:13:37", "1", "L : 125", "1", "", ""))
    rows.append(tr("91153678 HANTARAN TR, LVCABLE JURUSAN C", "", "", "", "", "", "", "", ""))
    for seq, meter, at, val, unit in [(10, "R-0", "13:14:59", "226", "V"), (40, "BEBAN-R", "13:14:34", "10", "A")]:
        rows.append(tr(seq, meter, meter, f"Aug 12, 2026 {at}", val, unit, "1", "", ""))
    body = f"<table><tr><td>{HEAD}</td></tr>{''.join(rows)}</table>{extra}"
    return f"<?xml version='1.0'?><soapenv:Envelope><soapenv:Body><Update><UpdateContent><Content>{html.escape(body)}</Content></UpdateContent></Update></soapenv:Body></soapenv:Envelope>"


class WoTest(unittest.TestCase):
    def test_dates(self):
        self.assertEqual(wo.date_id("3 Agustus 2026"), "2026-08-03")
        self.assertEqual(wo.date_id("17 November 2026"), "2026-11-17")
        self.assertIsNone(wo.date_id("besok"))
        self.assertEqual(wo.stamp("Aug 12, 2026 13:09:16").isoformat(), "2026-08-12T13:09:16")
        self.assertIsNone(wo.stamp(""))

    def test_a_soap_answer_gives_the_header_the_gardu_level_values_and_the_load_per_jurusan(self):
        [r] = wo.parse(report())
        self.assertEqual((r["wonum"], r["description"], r["gardu"], r["status"], r["owner"], r["hi_value"]), ("100000001", "INSPEKSI GARDU HD0744", "HD0744", "COMP", "51453.INSPEKTOR.3", "KURANG"))
        self.assertEqual((r["actual_start"], r["actual_finish"], r["pembebanan_trafo_pct"], r["imbalance_pct"]), ("2026-08-03", "2026-08-13", 52.65, 15.07))
        self.assertEqual(r["jurusan"]["a"], {"vr": 229.0, "vs": 228.0, "vt": 230.0, "peak_r": 55.0, "peak_s": 82.0, "peak_t": 60.0, "peak_n": 42.0, "normal_r": 99.0, "nhf_r": "L : 125"})
        self.assertEqual(set(r["jurusan"]), {"a", "c"})
        self.assertEqual(r["measured_at"], "2026-08-12 13:13:15")               # the earliest FIELD measurement, not the calculation time of the gardu-level rows

    def test_the_csv_row_uses_omt_column_names_and_the_lowest_base_voltage_per_phase(self):
        [r] = wo.parse(report())
        row = wo.flatten(r)
        self.assertEqual((row["iar"], row["ias"], row["iat"], row["ian"], row["icr"]), (55.0, 82.0, 60.0, 42.0, 10.0))      # peak load, not the normal one
        self.assertEqual((row["vrn"], row["vsn"], row["vtn"]), (226.0, 228.0, 230.0))                                        # jurusan A 229, jurusan C 226 -> 226
        self.assertEqual(row["nhf_iar"], "L : 125")

    def test_a_page_that_is_not_a_work_order_is_ignored_and_plain_html_works(self):
        self.assertEqual(wo.parse("<html><body>login</body></html>"), [])
        plain = html.unescape(report()[report().index("<Content>") + 9:report().index("</Content>")])
        self.assertEqual(wo.parse(plain)[0]["wonum"], "100000001")

    def test_cli_writes_one_row_per_work_order_and_skips_duplicates(self):
        import main
        with tempfile.TemporaryDirectory() as d:
            for name in ("a.json", "b.json"):
                with open(os.path.join(d, name), "w", encoding="utf-8") as fh:
                    fh.write(report())
            with open(os.path.join(d, "c.json"), "w", encoding="utf-8") as fh:
                fh.write("<html>login</html>")
            self.assertEqual(main.main(["parse", os.path.join(d, "*.json"), "--out", os.path.join(d, "out")]), 0)
            rows = list(csv.DictReader(open(os.path.join(d, "out", "maximo-wo-pengukuran.csv"), encoding="utf-8")))
            self.assertEqual([r["wonum"] for r in rows], ["100000001"])


if __name__ == "__main__":
    unittest.main()
