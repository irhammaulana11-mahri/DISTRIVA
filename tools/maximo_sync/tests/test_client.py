import json
import os
import sys
import unittest
from urllib.parse import parse_qs

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.dirname(__file__))
import client  # noqa: E402


class Resp:
    def __init__(self, text, code=200, url="http://m/maximo/ui/"):
        self.text, self.status_code, self.url = text, code, url


class Sess:
    def __init__(self, answers):
        self.answers, self.calls, self.headers = list(answers), [], {}

    def post(self, url, **kw):
        self.calls.append((url, kw))
        return self.answers.pop(0)


class ClientTest(unittest.TestCase):
    def test_login_form_is_found_by_its_password_field(self):
        page = '<form action="/maximo/ui/login" method="post"><input type="hidden" name="allowinsubframe" value="null"><input type="text" name="username"><input type="password" name="password"></form>'
        action, fields, user, pw = client._login_form(page, "http://m/maximo/ui/login")
        self.assertEqual((action, fields, user, pw), ("http://m/maximo/ui/login", {"allowinsubframe": "null"}, "username", "password"))
        self.assertIsNone(client._login_form("<html>sudah masuk</html>", "http://m/"))

    def test_a_click_is_sent_like_the_browser_does_and_the_sequence_and_token_follow_the_answers(self):
        m = client.MaximoClient("http://m", "u", "p")
        m.uisid, m.csrf, m.table = "6168", "TOK", "m6a7dfd2f"
        m.s = Sess([Resp('<server_response csrftoken="TOK2"></server_response>')])
        m.event(m.row_target(4))
        url, kw = m.s.calls[0]
        self.assertEqual(url, "http://m/maximo/ui/maximo.jsp")
        data = kw["data"]
        ev = json.loads(data["events"])
        self.assertEqual((data["uisessionid"], data["requesttype"], ev[0]["type"], ev[0]["targetId"], ev[0]["csrftokenholder"]), ("6168", "SYNC", "click", "m6a7dfd2f_tdrow_[C:1]_ttxt-lb[R:4]", "TOK"))
        self.assertEqual((kw["headers"]["xhrseqnum"], kw["headers"]["X-Requested-With"]), ("1", "XMLHttpRequest"))
        self.assertEqual(m.csrf, "TOK2")

    def test_an_answer_that_is_not_a_ui_response_is_an_error(self):
        m = client.MaximoClient("http://m", "u", "p")
        m.uisid, m.csrf = "1", "T"
        m.s = Sess([Resp("<html>login</html>")])
        with self.assertRaises(client.MaximoError):
            m.event("x")


class AppendTest(unittest.TestCase):
    def test_tambah_adds_only_the_new_work_orders_to_the_existing_csv(self):
        import csv
        import tempfile
        import main
        import test_wo
        with tempfile.TemporaryDirectory() as d:
            raw, out = os.path.join(d, "raw"), os.path.join(d, "out")
            os.makedirs(raw)
            os.makedirs(out)
            soap = test_wo.report()
            with open(os.path.join(raw, "wo-100000001.xml"), "w", encoding="utf-8") as fh:
                fh.write(soap)
            with open(os.path.join(raw, "wo-100000002.xml"), "w", encoding="utf-8") as fh:
                fh.write(soap.replace("100000001", "100000002"))
            import wo
            wo.write_csv(wo.parse(soap), os.path.join(out, "maximo-wo-pengukuran.csv"))                   # 100000001 is already in the CSV
            args = type("A", (), {"raw": raw, "out": out})()
            todo = [{"wonum": "100000001"}, {"wonum": "100000002"}, {"wonum": "100000003"}]               # 100000003 failed / has no file
            self.assertEqual(main._append(todo, [("100000003", "x")], args), 0)
            rows = list(csv.DictReader(open(os.path.join(out, "maximo-wo-pengukuran.csv"), encoding="utf-8")))
            self.assertEqual([r["wonum"] for r in rows], ["100000001", "100000002"])


if __name__ == "__main__":
    unittest.main()
