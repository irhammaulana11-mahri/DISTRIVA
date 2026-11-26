import json
import os
from pathlib import Path

import requests
from playwright.sync_api import sync_playwright

from app.config import LOGIN_URL, USERNAME, PASSWORD

COOKIE_FILE = "eis_session.json"


def load_cookies():
    if not os.path.exists(COOKIE_FILE):
        return None
    try:
        with open(COOKIE_FILE, "r", encoding="utf-8") as file:
            cookies = json.load(file)
        return cookies if isinstance(cookies, list) else None
    except (OSError, json.JSONDecodeError):
        return None


def save_cookies(cookies):
    path = Path(COOKIE_FILE)
    temporary = path.with_suffix(path.suffix + ".tmp")
    with open(temporary, "w", encoding="utf-8") as file:
        json.dump(cookies, file)
    os.replace(temporary, path)
    try:
        path.chmod(0o600)
    except OSError:
        pass


def apply_cookies(session, cookies):
    for cookie in cookies:
        session.cookies.set(cookie["name"], cookie["value"])


def is_session_valid(cookies):
    """Check the saved EIS cookies without leaking a Requests session."""
    if not cookies:
        return False

    try:
        with requests.Session() as session:
            for cookie in cookies:
                session.cookies.set(
                    cookie["name"],
                    cookie["value"],
                    domain=cookie.get("domain") or None,
                    path=cookie.get("path") or "/",
                )
            response = session.get(
                f"{LOGIN_URL}/default.aspx",
                timeout=(5, 10),
                allow_redirects=True,
            )
            final_url = (response.url or "").lower()
            body = (response.text or "").lower()
            return (
                response.status_code < 400
                and "login.aspx" not in final_url
                and 'id="txtuserid"' not in body
                and "id='txtuserid'" not in body
            )
    except requests.RequestException:
        return False


def get_session():
    session = requests.Session()
    cookies = load_cookies()

    if cookies:
        print("🔄 Pakai cookie existing...")
        apply_cookies(session, cookies)
        if is_session_valid(cookies):
            print("✅ Session valid")
            return session
        print("⚠️ Session expired")

    cookies = run_eis_playwright()
    apply_cookies(session, cookies)
    return session


def run_eis_playwright():
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=False)
        try:
            context = browser.new_context()
            cookies = load_cookies()
            page = context.new_page()

            if cookies and is_session_valid(cookies):
                print("✅ Pakai session existing")
                context.add_cookies(cookies)
                page.goto(f"{LOGIN_URL}/default.aspx")
            else:
                if not USERNAME or not PASSWORD:
                    raise RuntimeError("EIS_USERNAME / EIS_PASSWORD belum diisi di .env")
                print("🔐 Login ulang...")
                page.goto(f"{LOGIN_URL}/login.aspx")
                page.fill("#txtUserid", USERNAME)
                page.fill("#TxtPWDx", PASSWORD)
                page.get_by_role("button", name="Login", exact=True).click()
                page.wait_for_load_state("networkidle")
                cookies = context.cookies()
                save_cookies(cookies)
                print("✅ Login berhasil & cookie disimpan")

            print("➡️ Menu PIUTANG")
            page.get_by_text("PIUTANG").click()
            page.wait_for_timeout(2000)
            print("➡️ Detail Data Tunggakan")
            page.get_by_text("Detail Data Tunggakan").click()
            page.wait_for_timeout(4000)

            frame = None
            for current_frame in page.frames:
                print("DEBUG FRAME:", current_frame.name, current_frame.url)
                if "waskit" in current_frame.url.lower():
                    frame = current_frame
                    break
            if frame is None:
                raise RuntimeError("❌ iframe tidak ditemukan")

            print("✅ iframe ditemukan")
            checkbox = frame.locator("#Checkbox2")
            checkbox.wait_for()
            if not checkbox.is_checked():
                checkbox.click()

            frame.wait_for_function(
                """() => {
                    const element = document.getElementById('xdaya1');
                    return element && !element.disabled;
                }"""
            )
            page.wait_for_timeout(500)
            frame.locator("#xdaya1").fill("6600")
            frame.locator("#xdaya2").fill("99999999")
            frame.locator("#btnLoad").click()
            print("⏳ Loading data...")
            page.wait_for_timeout(2000)
            frame.wait_for_function(
                """() => document.querySelectorAll('table tr').length > 5""",
                timeout=20000,
            )
            print("✅ Data muncul")
            cookies = context.cookies()
            save_cookies(cookies)
            return cookies
        finally:
            browser.close()


LOGIN_ATTEMPTS = 3
LOGIN_RETRY_WAIT_MS = 15000


def _open_login_page(page):
    """Buka halaman login EIS; ulangi bila server membalas galat 5xx.

    EIS sesekali menjawab "500 Server Application Unavailable" selama beberapa menit (aplikasi
    sedang dimuat ulang). Tanpa ini kegagalan baru terlihat setelah menunggu kolom login 30 detik
    dengan galat Playwright yang tidak menjelaskan penyebabnya.
    """
    status = None
    for attempt in range(1, LOGIN_ATTEMPTS + 1):
        response = page.goto(f"{LOGIN_URL}/login.aspx")
        status = response.status if response else None
        if status is not None and status < 500:
            return
        print(f"⚠ EIS membalas HTTP {status} (percobaan {attempt}/{LOGIN_ATTEMPTS}).")
        if attempt < LOGIN_ATTEMPTS:
            page.wait_for_timeout(LOGIN_RETRY_WAIT_MS)
    raise RuntimeError(
        f"Server EIS sedang bermasalah (HTTP {status}, halaman login tidak tersedia). "
        "Ini gangguan di sisi EIS, bukan di DISTRIVA; coba lagi beberapa menit lagi."
    )


def login_page(p, headless=False, force_login=False):
    """Open EIS in a logged-in Playwright browser.

    force_login=True deliberately ignores a still-present cookie file and
    performs a new credential login. This is needed after an ASP.NET session
    reset; otherwise a supposedly fresh HTTP session may simply reuse the
    cookie that just failed.

    Returns (browser, context, page). The caller owns browser.close().
    """
    if not USERNAME or not PASSWORD:
        raise RuntimeError("EIS_USERNAME / EIS_PASSWORD belum diisi di .env")

    browser = p.chromium.launch(headless=headless)
    try:
        context = browser.new_context(accept_downloads=True)
        cookies = load_cookies()
        page = context.new_page()

        if cookies and is_session_valid(cookies) and not force_login:
            context.add_cookies(cookies)
            page.goto(f"{LOGIN_URL}/default.aspx")
        else:
            _open_login_page(page)
            page.fill("#txtUserid", USERNAME)
            page.fill("#TxtPWDx", PASSWORD)
            page.get_by_role("button", name="Login", exact=True).click()
            page.wait_for_load_state("networkidle")
            save_cookies(context.cookies())

        return browser, context, page
    except Exception:
        browser.close()
        raise
