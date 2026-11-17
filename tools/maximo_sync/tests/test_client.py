import json
import os
import sys
import unittest
from urllib.parse import parse_qs

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
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


if __name__ == "__main__":
    unittest.main()
