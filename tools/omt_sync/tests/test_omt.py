import csv
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import omt  # noqa: E402


def write(path, header, rows):
    with open(path, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(header)
        w.writerows(rows)


def row(names, **kv):
    d = {c: "" for c in names}
    d.update(kv)
    return [d[c] for c in names]


class OmtTest(unittest.TestCase):
    def test_dates(self):
        self.assertEqual(omt.parse_dt("2024-06-30 05:54:38")[0].isoformat(), "2024-06-30T05:54:38")
        self.assertEqual(omt.parse_dt("6/29/2024 22:56")[0].isoformat(), "2024-06-29T22:56:00")
        self.assertEqual(omt.parse_dt("7/1/2023 0:00")[1], "us")
        self.assertEqual(omt.parse_dt("2024-06-30")[0].hour, 0)
        self.assertEqual(omt.parse_dt("13/13/2024"), (None, None))
        self.assertEqual(omt.parse_dt(""), (None, None))

    def test_a_60_column_header_with_108_wide_rows_is_repaired_and_blank_rows_dropped(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "omt-pengukuran 2022-1.csv")
            common = dict(**{"Nama Unit": "MOJOKERTO", "Nama ULP": "JOMBANG", "Nama Penyulang": "WATUGALUH", "Kapasitas Aset": "100", "Tanggal Pengukuran": "2022-01-01"})
            old = row(omt.OLD, **common, **{"Nama Aset": "HD1", "Waktu Pengukuran": "2022-01-01 10:00:00", "iar": "10", "vrn": "230", "nhf_idt": ""})
            new = row(omt.NEW, **common, **{"Nama Aset": "HD2", "Waktu Pengukuran": "2022-01-01 11:30:15", "iar": "20", "ier": "5", "vrn": "228", "nhf_idt": ""})
            other = row(omt.NEW, **{"Nama Unit": "MALANG", "Nama ULP": "X", "Nama Aset": "E1", "Tanggal Pengukuran": "2022-01-01", "Waktu Pengukuran": "2022-01-01 12:00:00"})
            write(p, omt.OLD, [old, new, other, [""] * 108, [""] * 60])
            rows, per, dups = omt.clean([p], "MOJOKERTO")
            st = per[p]
            self.assertEqual([r["Nama Aset"] for r in rows], ["HD1", "HD2"])
            self.assertEqual((st["blank"], st["other_unit"], st["shifted"], st["layout_lama"], st["layout_baru"]), (2, 1, 1, 1, 1))     # only the 108-wide row of this unit is shifted against the 60 header
            hd2 = rows[1]
            self.assertEqual((hd2["iar"], hd2["ier"], hd2["vrn"], hd2["nhf_idt"]), ("20", "5", "228", ""))      # jurusan e..p exist only in the new layout and keep their own values
            self.assertEqual(rows[0]["ier"], "")                                                                  # old layout: jurusan e..p are simply empty
            self.assertEqual(hd2["Waktu Pengukuran"], "2022-01-01 11:30:15")

    def test_us_dates_dedupe_between_files_and_coverage(self):
        with tempfile.TemporaryDirectory() as d:
            mk = lambda name, rows: (write(os.path.join(d, name), omt.NEW, rows), os.path.join(d, name))[1]
            base = {"Nama Unit": "MOJOKERTO", "Nama ULP": "NGORO", "Kapasitas Aset": "50"}
            a = mk("omt-pengukuran a.csv", [row(omt.NEW, **base, **{"Nama Aset": "HE1", "Tanggal Pengukuran": "6/30/2024", "Waktu Pengukuran": "6/30/2024 5:54"}),
                                            row(omt.NEW, **base, **{"Nama Aset": "HE2", "Tanggal Pengukuran": "6/29/2024", "Waktu Pengukuran": "6/29/2024 22:56"})])
            b = mk("omt-pengukuran b.csv", [row(omt.NEW, **base, **{"Nama Aset": "HE1", "Tanggal Pengukuran": "2024-06-30", "Waktu Pengukuran": "2024-06-30 05:54:00", "Beban Trafo": "9"})])
            rows, per, dups = omt.clean([a, b], "MOJOKERTO")
            self.assertEqual(len(rows), 2)
            self.assertEqual(dups, 1)
            self.assertEqual({r["Nama Aset"]: r["Beban Trafo"] for r in rows}["HE1"], "9")                       # the later file wins
            self.assertEqual(per[a]["fmt_us"], 2)
            self.assertEqual(per[b]["fmt_iso"], 1)
            by, low = omt.coverage(rows)
            self.assertEqual(by["NGORO"]["2024-06"], 2)

    def test_bad_rows_are_counted_not_guessed(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "omt-pengukuran x.csv")
            base = {"Nama Unit": "MOJOKERTO", "Nama ULP": "NGORO", "Nama Aset": "HE1"}
            bad_date = row(omt.NEW, **base, **{"Tanggal Pengukuran": "bukan tanggal", "Waktu Pengukuran": "??"})
            date_only = row(omt.NEW, **base, **{"Tanggal Pengukuran": "2024-01-02", "Waktu Pengukuran": ""})
            write(p, omt.NEW, [bad_date, date_only, ["a", "b", "c"]])
            rows, per, _ = omt.clean([p], "MOJOKERTO")
            st = per[p]
            self.assertEqual((len(rows), st["bad_date"], st["time_missing"], st["bad_width"]), (1, 1, 1, 1))
            self.assertEqual(rows[0]["Waktu Pengukuran"], "2024-01-02 00:00:00")


if __name__ == "__main__":
    unittest.main()
