import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import client  # noqa: E402
import plan  # noqa: E402


def row(wo, desc, status_date, location=""):
    return {"wonum": wo, "description": desc, "location": location, "status_date": status_date}


ANSWER = ('<server_response><component id="x"><![CDATA[<span id="m1_tdrow_[C:1]_ttxt-lb[R:0]" ctype="label" class="a">100011567</span>'
          '<td id="m1_tdrow_[C:2]-c[R:0]" class="tc">Perbaikan/Pergantian INSPEKSI GARDU HC0505<!--m1_tdrow_[C:2]-c[R:0]--></td>'
          '<td id="m1_tdrow_[C:8]-c[R:0]" class="tc">COMP<!--m1_tdrow_[C:8]-c[R:0]--></td>'
          '<td id="m1_tdrow_[C:15]-c[R:0]" class="tc">23/07/2026 12:24 PM<!--m1_tdrow_[C:15]-c[R:0]--></td>'
          '<span id="m1_tdrow_[C:1]_ttxt-lb[R:1]" ctype="label">100011570</span>'
          '<td id="m1_tdrow_[C:8]-c[R:1]">WINSP<!--x--></td>]]></component>'
          '<component id="p">&nbsp;1 - &nbsp;&nbsp;&nbsp;20 of 13863 </component></server_response>')


class PlanTest(unittest.TestCase):
    def test_gardu_code_comes_from_the_description_then_the_location(self):
        self.assertEqual(plan.gardu_of("Perbaikan/Pergantian INSPEKSI GARDU HC0505"), "HC0505")
        self.assertEqual(plan.gardu_of("INSPEKSI GARDU", "GD01.1 GD HD0744 PENYULANG MEGALUH"), "HD0744")
        self.assertEqual(plan.gardu_of("tanpa kode"), "")

    def test_dates(self):
        self.assertEqual(plan.when("23/07/2026 12:52 PM").isoformat(), "2026-07-23T12:52:00")
        self.assertEqual(plan.when("04/08/2026 11:38 AM").hour, 11)
        self.assertIsNone(plan.when(""))

    def test_the_latest_work_order_per_gardu_is_chosen_and_done_ones_are_skipped(self):
        rows = [row("100000001", "INSPEKSI GARDU HD0744", "01/03/2026 10:00 AM"), row("100000002", "INSPEKSI GARDU HD0744", "01/09/2026 10:00 AM"),
                row("100000003", "INSPEKSI GARDU HD0745", "01/09/2026 10:00 AM"), row("100000004", "tanpa kode", "01/09/2026 10:00 AM")]
        self.assertEqual([r["wonum"] for r in plan.choose(rows)], ["100000002", "100000003", "100000004"])
        self.assertEqual([r["wonum"] for r in plan.choose(rows, done=["100000003"])], ["100000002", "100000004"])
        self.assertEqual(len(plan.choose(rows, latest_per_gardu=False)), 4)

    def test_list_rows_and_the_page_counter_are_read_from_an_ui_answer(self):
        m = client.MaximoClient("http://m", "u", "p")
        m.table = "m1"
        rows = m.rows_of(ANSWER)
        self.assertEqual([(r["wonum"], r["status"]) for r in rows], [("100011567", "COMP"), ("100011570", "WINSP")])
        self.assertEqual((rows[0]["description"], rows[0]["status_date"]), ("Perbaikan/Pergantian INSPEKSI GARDU HC0505", "23/07/2026 12:24 PM"))
        self.assertEqual(client.MaximoClient.page_info(ANSWER), (1, 20, 13863))
        self.assertIsNone(client.MaximoClient.page_info("<server_response/>"))


if __name__ == "__main__":
    unittest.main()
