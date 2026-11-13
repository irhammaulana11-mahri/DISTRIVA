"""EIS menu LAYANAN > MONITORING PERMOHONAN (Detil): set the filters, Load Data, Export Excel (docs/62 §52).

The page (mohondetil.aspx, a Coolite/ExtJS form with a DevExpress grid, shown in an iframe of the EIS frame set) has stable ids, read from the saved form (debug/permohonan_form.html):
  tgl1 / tgl2 = Range Mohon (ExtJS DateField, d/m/Y)      cboJenis = Jenis Mohon (display PB/PD/PS = value SEMUA, PB, PD, PS)      cboAsal = Asal Mohon (SEMUA)
  btnCarirange = Load Data (a full postback: the page reloads with the grid GV filled)      btnExport = Export Excel (a postback whose answer is the file)
  GV = ASPxGridView (rows tr[id*='DXDataRow'], header tr[id*='DXHeadersRow'], summary "Page 1 of N (M items)", client object window.GV with GotoPage(i), pageCount)
The download of "Export Excel" is the very file DISTRIVA imports (44 columns: NOAGENDA, TGLMOHON, IDPEL, NAMA, ..., UNITTUJUAN, PAKETSLO, PLTS_ATAP), so nothing is re-typed or re-parsed here.
If the page changes, run `python main.py inspect` (saves the form to debug/) or override one control with EIS_SEL_LOAD / EIS_SEL_EXPORT (CSS selectors) in .env.
"""
import csv
import os
import re
from datetime import date, datetime, timedelta
from pathlib import Path

from app.config import EIS_DAYA_MAX, EIS_DAYA_MIN, EIS_DOWNLOAD_DIR, EIS_HEADLESS, EIS_JENIS_MOHON, EIS_LOOKBACK_DAYS
from app.session import login_page

DEBUG_DIR = Path("debug")


def parse_date(text):
    """dd/mm/yyyy or yyyy-mm-dd -> date."""
    text = text.strip()
    for fmt in ("%d/%m/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            pass
    raise ValueError(f"Tanggal tidak dikenali: {text!r} (pakai dd/mm/yyyy atau yyyy-mm-dd)")


def default_range(today=None, lookback_days=EIS_LOOKBACK_DAYS):
    """Range Mohon of a normal sync: today - lookback .. today."""
    today = today or date.today()
    return today - timedelta(days=lookback_days), today


def fmt(d):
    return d.strftime("%d/%m/%Y")


def export_filename(d_from, d_to, now=None):
    now = now or datetime.now()
    return f"permohonan_{d_from:%Y%m%d}_{d_to:%Y%m%d}_{now:%H%M%S}.xls"


def _override(name):
    return os.getenv(f"EIS_SEL_{name}")


# The menu says "(Detil)" on the EIS (the tab title is "Mon.Permohonan (Detil)"); "(Detail)" is accepted too.
MENU_PATTERN = re.compile(r"MONITORING\s+PERMOHONAN\s*\(\s*DET(?:AI|I)L\s*\)", re.I)


def _menu_texts(page):
    """Every visible text of the open ExtJS menus (for the error message and debug/menu_items.txt)."""
    try:
        return [t.strip() for t in page.locator(".x-menu-item-text, .x-menu-item a, .x-menu-item").all_inner_texts() if t.strip()]
    except Exception:
        return []


def _open_menu(page):
    page.get_by_text("LAYANAN", exact=True).first.click()
    page.wait_for_timeout(800)
    item = page.get_by_text(MENU_PATTERN).first
    try:
        item.wait_for(state="visible", timeout=10000)
    except Exception:
        texts = _menu_texts(page)
        DEBUG_DIR.mkdir(exist_ok=True)
        (DEBUG_DIR / "menu_items.txt").write_text("\n".join(texts), encoding="utf-8")
        page.screenshot(path=str(DEBUG_DIR / "menu.png"))
        near = [t for t in dict.fromkeys(texts) if "PERMOHONAN" in t.upper()]
        raise RuntimeError("Menu 'Monitoring Permohonan (Detil)' tidak ditemukan setelah klik LAYANAN. Butir menu yang mengandung 'PERMOHONAN': "
                           + (", ".join(near) if near else "(tidak ada)") + ". Daftar lengkap: debug/menu_items.txt, tangkapan layar: debug/menu.png")
    item.click()
    page.wait_for_timeout(3000)


def _find_frame(page, text="Range Mohon", timeout_ms=30000):
    """The page sits in an iframe of the EIS frame set; wait until the one that shows the form appears."""
    waited = 0
    while waited < timeout_ms:
        for f in [page, *page.frames]:
            try:
                if f.locator("#tgl1").count() > 0 or f.get_by_text(text, exact=False).count() > 0:
                    return f
            except Exception:
                continue
        page.wait_for_timeout(500)
        waited += 500
    raise RuntimeError(f"Form '{text}' tidak ditemukan; jalankan `python main.py inspect`.")


JENIS_VALUES = {"PB/PD/PS": "SEMUA", "SEMUA": "SEMUA", "PB": "PB", "PD": "PD", "PS": "PS"}


def jenis_value(text):
    """The combo shows 'PB/PD/PS' but its value is SEMUA; accept either, refuse anything else (a typo must not silently load everything)."""
    key = str(text).strip().upper()
    if key not in JENIS_VALUES:
        raise ValueError(f"Jenis Mohon tidak dikenal: {text!r} (PB/PD/PS, PB, PD, atau PS)")
    return JENIS_VALUES[key]


_SUMMARY = re.compile(r"Page\s+(\d+)\s+of\s+(\d+)\s*\(\s*([\d.,]+)\s*items?\s*\)", re.I)


def parse_summary(text):
    """'Page 1 of 7 (66 items)' -> (page, pages, items); None when it is not the pager summary."""
    m = _SUMMARY.search(str(text))
    return (int(m.group(1)), int(m.group(2)), int(re.sub(r"[.,]", "", m.group(3)))) if m else None


LAST = {}          # the last check of the table (items, pages, reloaded, ...), for the caller (main.py compares it with what DISTRIVA staged)


def _set_filters(frame, d_from, d_to, jenis):
    """Fills the ExtJS controls through their own API (typing into a Coolite date field is fragile) and reads them back. The END of Range Daya is mandatory on the page
    (allowBlank false): left empty, the form refuses to post and the grid silently stays empty, so a wide range stands for "all"."""
    want = [fmt(d_from), fmt(d_to), jenis_value(jenis), str(EIS_DAYA_MIN), str(EIS_DAYA_MAX)]
    frame.evaluate("""([a, b, j, d1, d2]) => {
        Ext.getCmp('tgl1').setValue(a);
        Ext.getCmp('tgl2').setValue(b);
        Ext.getCmp('cboJenis').setValue(j);
        Ext.getCmp('TxtDaya1').setValue(d1);
        Ext.getCmp('TxtDaya2').setValue(d2);
    }""", want)
    got = frame.evaluate("() => [document.getElementById('tgl1').value, document.getElementById('tgl2').value, document.getElementById('cboJenis_Value').value, "
                         "document.getElementById('TxtDaya1').value, document.getElementById('TxtDaya2').value]")
    if got != want:
        raise RuntimeError(f"Filter tidak terpasang seperti yang diminta: {got} (diminta {want})")


_STATE_JS = """() => {
  const sum = document.querySelector('.dxpSummary_Youthful');
  const hdr = document.querySelector("tr[id*='DXHeadersRow']");
  const titles = hdr ? Array.from(hdr.children).map(td => td.innerText.trim()).filter(t => t && !/^Drag a column/i.test(t)) : [];   // direct cells only: a header cell holds a nested table
  const nodata = !!Array.from(document.querySelectorAll('td, div')).find(e => e.children.length === 0 && /^\\s*No data to display\\s*$/i.test(e.innerText || ''));
  return {
    summary: sum ? sum.innerText : '',
    dataRows: document.querySelectorAll("tr[id*='DXDataRow']").length,
    titles, nodata,
    invalid: Array.from(document.querySelectorAll('.x-form-invalid')).map(e => e.id || e.name || '?'),
    marker: !!window.__eisBefore,
    hasGrid: !!window.GV,
  };
}"""


def table_state(frame):
    """What the grid shows now: pager summary (page, pages, items), rows in the DOM, header titles, 'No data to display', fields the page marks invalid, and whether the page was reloaded."""
    try:
        st = frame.evaluate(_STATE_JS)
    except Exception:
        return None                                      # the page is being reloaded
    st["pager"] = parse_summary(st.get("summary", ""))
    return st


def _summary(frame):
    st = table_state(frame)
    return st["pager"] if st else None


def _save_debug(page, frame, name):
    DEBUG_DIR.mkdir(exist_ok=True)
    try:
        (DEBUG_DIR / f"{name}.html").write_text(frame.content(), encoding="utf-8")
        page.screenshot(path=str(DEBUG_DIR / f"{name}.png"), full_page=True)
    except Exception:
        pass


def _load_data(page, frame, timeout_s=300):
    """Clicks Load Data and waits for the result. The button posts the form back, so the page reloads (a marker set before the click is then gone). Returns a state dict with
    `reloaded`, `pager`, `items`, `pages`. A grid that is still empty and was NOT reloaded means the load never ran (e.g. a mandatory field was empty): the caller must not read it as "no data"."""
    before = _summary(frame)
    frame.evaluate("() => { window.__eisBefore = true; }")
    (frame.locator(_override("LOAD")) if _override("LOAD") else frame.locator("#btnCarirange button")).click()
    waited, steady, last = 0, 0, None
    while waited < timeout_s * 1000:
        page.wait_for_timeout(1500)
        waited += 1500
        st = table_state(frame)
        if not st or not st["pager"]:
            steady = 0
            continue                                     # reloading
        masked = frame.evaluate("() => !!document.querySelector('.ext-el-mask-msg, .ext-el-mask')")
        reloaded = not st["marker"]
        if reloaded or st["pager"] != before:
            last = st
            break
        steady = 0 if masked else steady + 1
        if steady >= 8:                                  # ~12 s of nothing: the page did not react
            last = st
            break
    if last is None:
        raise RuntimeError(f"Load Data tidak selesai dalam {timeout_s} detik.")
    _page, pages, items = last["pager"]
    last.update(reloaded=not last["marker"], pages=pages, items=items)
    LAST.clear()
    LAST.update({k: last[k] for k in ("reloaded", "pages", "items", "dataRows", "titles", "invalid", "nodata")})
    return last


def describe(st):
    """A short, readable check of the table (counts and titles only, never customer data)."""
    names = [canonical_header(t) for t in st["titles"]]
    missing = [c for c in REQUIRED if st["titles"] and c not in names]
    return [f"Tabel: {st['items']} baris, {st['pages']} halaman; {st['dataRows']} baris terlihat di halaman ini; muat ulang halaman: {'ya' if st['reloaded'] else 'TIDAK'}.",
            f"Kolom ({len(st['titles'])}): " + (", ".join(names[:12]) + (" ..." if len(names) > 12 else "") if names else "(belum ada)"),
            ("Kolom wajib DISTRIVA lengkap." if st["titles"] and not missing else f"Kolom wajib yang belum ada di tabel: {', '.join(missing)}" if st["titles"] else "Kolom wajib: belum dapat diperiksa (tabel kosong)."),
            ("Kolom yang ditandai tidak valid oleh halaman: " + ", ".join(st["invalid"])) if st["invalid"] else "Tidak ada kolom isian yang ditandai tidak valid."]


def _open_and_load(page, d_from, d_to, jenis):
    _open_menu(page)
    frame = _find_frame(page)
    _set_filters(frame, d_from, d_to, jenis)
    st = _load_data(page, frame)
    print("EIS: alamat form:", frame.url)                  # the address for the HTTP method (EIS_MOHON_URL)
    for line in describe(st):
        print("EIS:", line)
    if st["items"] == 0 and not st["reloaded"]:
        _save_debug(page, frame, "load_gagal")
        raise RuntimeError("Load Data tidak berjalan: halaman tidak dimuat ulang dan tabel tetap kosong"
                           + (f" (kolom tidak valid: {', '.join(st['invalid'])})" if st["invalid"] else "")
                           + ". Form dan tangkapan layar disimpan di debug/load_gagal.*")
    if st["items"] > 0 and st["dataRows"] == 0:
        _save_debug(page, frame, "tabel_tanpa_baris")
        raise RuntimeError(f"Ringkasan menyebut {st['items']} baris tetapi tidak ada baris di tabel; disimpan di debug/tabel_tanpa_baris.*")
    return frame, st


# The 44 columns of the Excel export (and of DISTRIVA's EIS import). The grid on the page shows the same data under display titles ("No. Agenda"), so a grid read is mapped back to these names
# by comparing titles without spaces, dots and underscores; a title that matches none is kept as it is (DISTRIVA ignores columns it does not know).
CANONICAL = ["NOAGENDA", "NO_REGISTRASI", "TGLMOHON", "IDPEL", "NAMA", "ALAMAT", "NOTELP_PEMOHON", "NOTELP_HP_PEMOHON", "ASALMOHON", "UPIENTRI", "PETUGASCATAT", "TARIF_LAMA", "DAYA_LAMA", "TARIF", "DAYA",
             "JENIS_TRANSAKSI", "PAKET_SAR", "TOTALBIAYA", "TGLBAYAR", "DURASI_HARI_KERJA", "DURASI_HARI_KALENDER", "KRITERIA_TMP", "ALASAN_KRITERIA_TMP", "KETERANGAN_ALASAN_KRITERIA_TMP",
             "ESTIMASI_DURASI_HARI_LAYANAN", "STATUS_PENANGGUHAN", "ALASAN_PENANGGUHAN", "KETERANGAN_ALASAN_PENANGGUHAN", "TGLPENANGGUHAN", "TGLSIAPSAMBUNG", "STATUS_RESTITUSI_ATAU_TITIPAN", "TGLRESTITUSI",
             "TGLBPTITIPAN", "STATUS_PERMOHONAN", "TGL_UPDATE_PERMOHONAN", "TGLPK", "TGLNYALA", "TGLPEREMAJAAN", "NAMAUPI", "NAMAAP", "NAMAUP", "UNITTUJUAN", "PAKETSLO", "PLTS_ATAP"]
_ALIASES = {re.sub(r"[^A-Z0-9]", "", c): c for c in CANONICAL}
# the least data DISTRIVA needs to create an application and to follow its status (the importer ignores absent columns and never clears a value with an empty one)
REQUIRED = ["NOAGENDA", "NAMA", "JENIS_TRANSAKSI", "UNITTUJUAN"]


def canonical_header(title):
    key = re.sub(r"[^A-Z0-9]", "", str(title).upper())
    return _ALIASES.get(key, str(title).strip())


def write_rows_csv(headers, rows, path):
    """Writes a grid read as the CSV that DISTRIVA imports; refuses a read that lacks a required column (so a wrong page never reaches DISTRIVA)."""
    names = [canonical_header(h) for h in headers]
    missing = [c for c in REQUIRED if c not in names]
    if missing:
        raise ValueError("Kolom wajib tidak ada pada tabel: " + ", ".join(missing) + f". Kolom yang terbaca: {', '.join(names[:20])}")
    with open(path, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(names)
        for r in rows:
            w.writerow([(c or "").strip() for c in r] + [""] * (len(names) - len(r)))
    return path


_GRID_JS = "() => window.GV && window.GV.GotoPage ? { pages: window.GV.pageCount, name: 'GV' } : null"


def _read_page(frame):
    """Header titles and the cell texts of the data rows currently shown by the DevExpress grid (direct cells only: a header cell holds a nested table)."""
    return frame.evaluate("""
    () => {
      const hdr = document.querySelector("tr[id*='DXHeadersRow']");
      const titles = hdr ? Array.from(hdr.children).map(td => td.innerText.trim()).filter(t => t && !/^Drag a column/i.test(t)) : [];
      const rows = Array.from(document.querySelectorAll("tr[id*='DXDataRow']")).map(tr => Array.from(tr.children).map(td => td.innerText.trim()));
      return { titles, rows };
    }""")


def scrape_grid(page, frame):
    """Reads every page of the result grid (no Excel): returns (titles, rows). Uses the grid's own client API (window.GV.GotoPage), which is how DevExpress pages without a reload (10 rows a page)."""
    info = frame.evaluate(_GRID_JS)
    if not info:
        raise RuntimeError("Tabel DevExpress tidak ditemukan pada halaman; pakai --sumber excel atau jalankan `python main.py inspect`.")
    first = _read_page(frame)
    titles, rows = first["titles"], list(first["rows"])
    for i in range(1, int(info["pages"])):
        frame.evaluate(f"() => window.GV.GotoPage({i})")
        for _ in range(30):                                  # wait until the pager says it is on page i+1
            page.wait_for_timeout(500)
            if frame.get_by_text(f"Page {i + 1} of", exact=False).count() > 0:
                break
        rows.extend(_read_page(frame)["rows"])
    return titles, rows


def inspect(headless=None):
    """Logs in, opens the page and saves its HTML + a screenshot to debug/ (no data is loaded or exported)."""
    from playwright.sync_api import sync_playwright
    DEBUG_DIR.mkdir(exist_ok=True)
    with sync_playwright() as p:
        browser, _context, page = login_page(p, EIS_HEADLESS if headless is None else headless)
        try:
            _open_menu(page)
            frame = _find_frame(page)
            (DEBUG_DIR / "permohonan_form.html").write_text(frame.content(), encoding="utf-8")
            page.screenshot(path=str(DEBUG_DIR / "permohonan_form.png"), full_page=True)
            print("Form disimpan di debug/permohonan_form.html dan .png")
        finally:
            browser.close()


def check(d_from=None, d_to=None, jenis=EIS_JENIS_MOHON, headless=None):
    """Loads the range and reports what the table shows (no download, no upload): counts, columns, required columns, invalid fields; saves debug/cek_tabel.png."""
    from playwright.sync_api import sync_playwright
    d_from, d_to = (d_from, d_to) if d_from and d_to else default_range()
    jenis_value(jenis)
    with sync_playwright() as p:
        browser, _context, page = login_page(p, EIS_HEADLESS if headless is None else headless)
        try:
            frame, st = _open_and_load(page, d_from, d_to, jenis)
            DEBUG_DIR.mkdir(exist_ok=True)
            page.screenshot(path=str(DEBUG_DIR / "cek_tabel.png"), full_page=True)
            print("Tangkapan layar: debug/cek_tabel.png")
            return st
        finally:
            browser.close()


def export(d_from=None, d_to=None, jenis=EIS_JENIS_MOHON, out_dir=EIS_DOWNLOAD_DIR, headless=None, sumber="excel"):
    """Gets the range as a file DISTRIVA can import: sumber='excel' downloads the page's Export Excel (default, the most faithful), sumber='grid' reads the result table page by page (CSV).
    Returns the path, or None when the table really is empty (the page reloaded and shows no data)."""
    from playwright.sync_api import sync_playwright
    d_from, d_to = (d_from, d_to) if d_from and d_to else default_range()
    if d_from > d_to:
        raise ValueError("Tanggal awal setelah tanggal akhir.")
    jenis_value(jenis)                                  # refuse a wrong Jenis Mohon before any browser is opened
    Path(out_dir).mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser, _context, page = login_page(p, EIS_HEADLESS if headless is None else headless)
        try:
            frame, st = _open_and_load(page, d_from, d_to, jenis)
            if st["items"] == 0:
                print(f"EIS: tabel kosong untuk {fmt(d_from)} - {fmt(d_to)} (halaman dimuat ulang dan tidak menampilkan data).")
                return None
            if sumber == "grid":
                titles, rows = scrape_grid(page, frame)
                if len(rows) != st["items"]:
                    raise RuntimeError(f"Baris terbaca ({len(rows)}) tidak sama dengan ringkasan tabel ({st['items']}).")
                target = (Path(out_dir) / export_filename(d_from, d_to)).with_suffix(".csv")
                write_rows_csv(titles, rows, target)
                print(f"Tabel terbaca ({len(rows)} baris), tersimpan: {target}")
                return target
            target = Path(out_dir) / export_filename(d_from, d_to)
            with page.expect_download(timeout=300000) as dl:
                (frame.locator(_override("EXPORT")) if _override("EXPORT") else frame.locator("#btnExport button")).click()
            dl.value.save_as(str(target))
            print(f"Unduhan tersimpan: {target}")
            return target
        finally:
            browser.close()
