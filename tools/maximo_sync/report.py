"""Rantai laporan WO Maximo setelah tombol "Run report" ditekan (dari tangkapan jaringan 17 Nov 2026), semuanya HTTP biasa:

  1. GET  {ui}/maximo/webclient/common/openreport.jsp          -> halaman berisi form yang mengirim dirinya sendiri (where=dummyWhere + kunci `__where__ibm__key` milik WO terpilih)
  2. POST aksi form itu ({report}/maximo/report/?...)            -> halaman kecil dengan skrip `reportForm.action="..."`
  3. POST alamat itu (tanpa isi)                                 -> penampil BIRT (HTML) yang memuat `SessionId = "..."`
  4. POST alamat itu + `&__sessionId=<id>&__dpi=96` (SOAP GetPage) -> jawaban SOAP berisi HTML laporan (dibaca `wo.parse`)

`sess` = objek mirip requests.Session (get/post); host UI dan host laporan boleh berbeda (10.99.10.41 / 10.99.10.46). Tidak ada nilai rahasia yang ditulis ke mana pun di sini.
"""
import html
import re
import time
from urllib.parse import urljoin

from bs4 import BeautifulSoup

OPEN_REPORT = "/maximo/webclient/common/openreport.jsp"


class ReportError(RuntimeError):
    pass


def form_of(page, url):
    """(action, {name: value}) of the first form with inputs in a page; the action may also be set by script (`theForm.action = "..."`)."""
    soup = BeautifulSoup(page, "html.parser")
    form = next((f for f in soup.find_all("form") if f.find("input")), None) or soup.find("form")
    if form is None:
        raise ReportError("halaman tidak memuat form")
    action = form.get("action") or ""
    m = re.search(r"actionURL\s*=\s*\"([^\"]+)\"", page)
    if m:
        action = html.unescape(m.group(1))
    fields = {i.get("name"): i.get("value", "") for i in form.find_all("input") if i.get("name")}
    return urljoin(url, action), fields


def script_action(page, url):
    """The target a self-submitting page sets with `reportForm.action="..."`."""
    m = re.search(r"reportForm\.action\s*=\s*\"([^\"]+)\"", page)
    if not m:
        raise ReportError("halaman tidak menyebut alamat laporan berikutnya")
    return urljoin(url, html.unescape(m.group(1)))


def task_id(now=None):
    """The viewer's `__taskid`: JavaScript's year-month(0-based)-day-hour-minute-second-millisecond of the moment (2026-10-17-15-29-4-658 = 17 Nov 2026 15:29:04.658)."""
    t = now or time.time()
    lt = time.localtime(t)
    return f"{lt.tm_year}-{lt.tm_mon - 1}-{lt.tm_mday}-{lt.tm_hour}-{lt.tm_min}-{lt.tm_sec}-{int((t % 1) * 1000)}"


def soap_body(task):
    ops = [("where", "dummyWhere"), ("__isdisplay__where", "dummyWhere"), ("appname", "PLUSDWOTRK"), ("__isdisplay__appname", "PLUSDWOTRK"), ("paramdelimiter", "||"), ("__isdisplay__paramdelimiter", "||"),
           ("paramstring", "appHierarchy=PLUSDWOTRK,WOTRACK"), ("__isdisplay__paramstring", "appHierarchy=PLUSDWOTRK,WOTRACK"), ("__page", "1"), ("__svg", "false"), ("__page", "1"), ("__taskid", task)]
    body = "".join(f"<Oprand><Name>{n}</Name><Value>{html.escape(v)}</Value></Oprand>" for n, v in ops)
    return ('<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><GetUpdatedObjects xmlns="http://schemas.eclipse.org/birt"><Operation><Target><Id>Document</Id><Type>Document</Type></Target>'
            f"<Operator>GetPage</Operator>{body}</Operation></GetUpdatedObjects></soap:Body></soap:Envelope>")


def fetch(sess, ui_base, timeout=90):
    """Runs the chain for the work order that is currently selected in the UI session; returns the SOAP answer (text)."""
    url1 = ui_base.rstrip("/") + OPEN_REPORT
    r1 = sess.get(url1, timeout=timeout)
    if r1.status_code != 200:
        raise ReportError(f"openreport.jsp menjawab {r1.status_code}")
    action, fields = form_of(r1.text, url1)
    if "__where__ibm__key" not in fields:
        raise ReportError("form laporan tidak memuat kunci WO (tombol Run report belum ditekan atau sesi habis)")
    r2 = sess.post(action, data=fields, timeout=timeout)
    if r2.status_code != 200:
        raise ReportError(f"langkah 2 menjawab {r2.status_code}")
    viewer = script_action(r2.text, action)
    r3 = sess.post(viewer, timeout=timeout)
    m = re.search(r"SessionId\s*=\s*\"([^\"]+)\"", r3.text)
    if r3.status_code != 200 or not m:
        raise ReportError("penampil BIRT tidak memberi SessionId")
    soap = f"{viewer}&__sessionId={m.group(1)}&__dpi=96"
    r4 = sess.post(soap, data=soap_body(task_id()).encode("utf-8"), timeout=timeout,
                   headers={"Content-type": "text/xml; charset=UTF-8", "SOAPAction": '""', "X-Prototype-Version": "1.7", "X-Requested-With": "XMLHttpRequest", "request-type": "SOAP"})
    if r4.status_code != 200 or "GetUpdatedObjectsResponse" not in r4.text:
        raise ReportError(f"jawaban SOAP tidak dikenali ({r4.status_code})")
    return r4.text
