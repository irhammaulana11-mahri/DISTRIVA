import csv
import io
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import dil  # noqa: E402

HEAD = ["IDPEL", "UNITUP", "NAMA", "TARIF", "DAYA", "JENISLAYANAN", "KODE_FASA", "NOMOR_METER_KWH", "NOMOR_METER_PREPAID", "NAMA_KELURAHAN", "NAMA_KECAMATAN", "NAMA_KABUPATEN", "TGLNYALA_PB", "NOMOR_GARDU", "NAMA_GARDU",
        "STATUS_DIL", "V_BULAN_REKAP", "NIK", "NOTELP", "EMAIL", "KOORDINAT_X", "NAMAPNJ"]


def write(rows):
    f = tempfile.NamedTemporaryFile("w", suffix=".csv", delete=False, newline="", encoding="utf-8")
    w = csv.writer(f)
    w.writerow(HEAD)
    for r in rows:
        w.writerow([r.get(h, "") for h in HEAD])
    f.close()
    return f.name


def row(i, **o):
    return {"IDPEL": f"51453000000{i}", "UNITUP": "51453", "NAMA": "BUDI SANTOSO", "TARIF": "R1", "DAYA": "900", "JENISLAYANAN": "PRABAYAR", "KODE_FASA": "1", "NOMOR_METER_KWH": "", "NOMOR_METER_PREPAID": "555",
            "NAMA_KELURAHAN": "KLW", "TGLNYALA_PB": "2020-05-01 00:00:00", "NOMOR_GARDU": "GD514530001", "NAMA_GARDU": "GD HD0008 PENYULANG DENANYAR", "STATUS_DIL": "AKTIF", "V_BULAN_REKAP": "202210",
            "NIK": "3517123456780001", "NOTELP": "08123456789", "EMAIL": "a@b.c", "KOORDINAT_X": "112.1", "NAMAPNJ": "JL MAWAR 1"} | o


class FakeClient:
    def __init__(self):
        self.sent, self.started, self.completed = [], [], []

    def start(self, name, month):
        self.started.append((name, month))
        return {"id": "b1"}

    def send(self, bid, items):
        self.sent.append(items)
        return {"counts": {"created": len(items)}, "problems": []}

    def complete(self, bid):
        self.completed.append(bid)


class DilTest(unittest.TestCase):
    def test_mask_name(self):
        self.assertEqual(dil.mask_name("BUDI SANTOSO"), "BUD*********")
        self.assertEqual(dil.mask_name("BUD*****"), "BUD*****")        # already masked: untouched
        self.assertIsNone(dil.mask_name(""))

    def test_item_has_only_allowed_fields_and_no_personal_data(self):
        it = dil.to_item(row(1))
        self.assertEqual(set(it), {"idpel", "unit_code", "name", "tariff_code", "power_va", "service_type", "phase_code", "meter_number", "kelurahan", "kecamatan", "kabupaten", "energized_on", "gardu_ref", "gardu_name", "status"})
        flat = " ".join(str(v) for v in it.values())
        for secret in ("3517123456780001", "08123456789", "a@b.c", "MAWAR", "SANTOSO"):
            self.assertNotIn(secret, flat)
        self.assertEqual((it["meter_number"], it["energized_on"], it["power_va"]), ("555", "2020-05-01", 900.0))

    def test_reader_never_returns_personal_columns(self):
        path = write([row(1)])
        r = next(dil.read_rows(path))
        for k in ("NIK", "NOTELP", "EMAIL", "KOORDINAT_X", "NAMAPNJ"):
            self.assertNotIn(k, r)

    def test_load_sends_chunks_and_closes_the_batch(self):
        path = write([row(i) for i in range(1, 6)])
        c = FakeClient()
        out = io.StringIO()
        res = dil.load(path, c, chunk=2, out=out)
        self.assertEqual([len(x) for x in c.sent], [2, 2, 1])
        self.assertEqual(c.started, [(os.path.basename(path), "202210")])
        self.assertEqual(c.completed, ["b1"])
        self.assertEqual((res["rows"], res["counts"]), (5, {"created": 5}))

    def test_units_limit_and_dry_run(self):
        path = write([row(1), row(2, UNITUP="51452"), row(3)])
        c = FakeClient()
        res = dil.load(path, c, units={"51453"}, out=io.StringIO())
        self.assertEqual(res["rows"], 2)
        c2 = FakeClient()
        res = dil.load(path, c2, dry_run=True, out=io.StringIO())
        self.assertEqual((res["rows"], c2.sent, c2.started), (3, [], []))      # a dry run sends and starts nothing
        res = dil.load(path, FakeClient(), limit=1, out=io.StringIO())
        self.assertEqual(res["rows"], 1)

    def test_missing_required_column_stops(self):
        f = tempfile.NamedTemporaryFile("w", suffix=".csv", delete=False)
        f.write("IDPEL,UNITUP\n1,2\n")
        f.close()
        with self.assertRaises(SystemExit):
            list(dil.read_rows(f.name))


    def test_the_gardu_name_is_read_for_the_gardu_code_it_holds_and_nothing_personal_comes_with_it(self):
        it = dil.to_item(row(1))
        self.assertEqual(it["gardu_name"], "GD HD0008 PENYULANG DENANYAR")
        self.assertNotIn("NAMAPNJ", it)
        self.assertNotIn("NIK", it)


if __name__ == "__main__":
    unittest.main()
