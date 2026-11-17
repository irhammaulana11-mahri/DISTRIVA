import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import report  # noqa: E402

OPEN = ('<html><head><script>window.onload=function(){var theForm=document.forms["reportForm"];actionURL="http://rep:9/maximo/report/?__report=x.rptdesign&amp;appname=A";theForm.action=actionURL;reportForm.submit();};</script></head>'
        '<body><form name="reportForm" id="reportForm" action="http://stale/" method="post"><input type="hidden" name="where" value="dummyWhere"><input type="hidden" name="__where__ibm__key" value="KEY1">'
        '<input type="hidden" name="reportNum" value="1281"><input type="hidden" name="comments" value=""></form></body></html>')
STEP2 = '<html><body><form name="reportForm" id="reportForm" action="testAction"></form></body></html><SCRIPT>reportForm.action="http://rep:9/maximo/report?__report=x.rptdesign&amp;appname=A&amp;uisessionid=1"\nreportForm.method="post"</SCRIPT>'
VIEWER = '<html><script>var SessionId = "20261117_000000_001"; </script></html>'
SOAP = "<?xml version='1.0'?><soapenv:Envelope><soapenv:Body><GetUpdatedObjectsResponse><Update/></GetUpdatedObjectsResponse></soapenv:Body></soapenv:Envelope>"


class Resp:
    def __init__(self, text, code=200):
        self.text, self.status_code = text, code


class Fake:
    """Answers the four steps in order and remembers every request."""

    def __init__(self, answers):
        self.answers, self.calls = list(answers), []

    def _next(self, verb, url, **kw):
        self.calls.append((verb, url, kw))
        return self.answers.pop(0)

    def get(self, url, **kw):
        return self._next("GET", url, **kw)

    def post(self, url, **kw):
        return self._next("POST", url, **kw)


class ReportTest(unittest.TestCase):
    def test_the_four_steps_replay_the_form_the_viewer_session_and_the_soap_page(self):
        s = Fake([Resp(OPEN), Resp(STEP2), Resp(VIEWER), Resp(SOAP)])
        out = report.fetch(s, "http://ui:1/")
        self.assertEqual(out, SOAP)
        (g1, u1, _), (p2, u2, k2), (p3, u3, _), (p4, u4, k4) = s.calls
        self.assertEqual((g1, u1), ("GET", "http://ui:1/maximo/webclient/common/openreport.jsp"))
        self.assertEqual(u2, "http://rep:9/maximo/report/?__report=x.rptdesign&appname=A")                      # the action set by the script wins over the stale one
        self.assertEqual(k2["data"], {"where": "dummyWhere", "__where__ibm__key": "KEY1", "reportNum": "1281", "comments": ""})
        self.assertEqual(u3, "http://rep:9/maximo/report?__report=x.rptdesign&appname=A&uisessionid=1")
        self.assertEqual(u4, u3 + "&__sessionId=20261117_000000_001&__dpi=96")
        self.assertIn(b"<Operator>GetPage</Operator>", k4["data"])
        self.assertEqual(k4["headers"]["request-type"], "SOAP")

    def test_a_page_without_the_work_order_key_or_the_session_id_is_an_error(self):
        with self.assertRaises(report.ReportError):
            report.fetch(Fake([Resp('<form><input name="where" value="x"></form>')]), "http://ui:1")
        with self.assertRaises(report.ReportError):
            report.fetch(Fake([Resp(OPEN), Resp(STEP2), Resp("<html>galat</html>")]), "http://ui:1")
        with self.assertRaises(report.ReportError):
            report.fetch(Fake([Resp(OPEN), Resp(STEP2), Resp(VIEWER), Resp("<html>login</html>")]), "http://ui:1")

    def test_task_id_counts_months_from_zero_like_javascript(self):
        import time
        t = time.mktime((2026, 11, 17, 15, 29, 4, 0, 0, -1)) + 0.658
        self.assertEqual(report.task_id(t), "2026-10-17-15-29-4-657") if report.task_id(t).endswith("657") else self.assertEqual(report.task_id(t), "2026-10-17-15-29-4-658")


if __name__ == "__main__":
    unittest.main()
