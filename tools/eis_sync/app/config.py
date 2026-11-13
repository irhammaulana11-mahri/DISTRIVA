import os
from dotenv import load_dotenv

load_dotenv()

LOGIN_URL = "http://eis.ap2t.pln.co.id/eis"

USERNAME = os.getenv("EIS_USERNAME", "")          # set in .env (never in the code)
PASSWORD = os.getenv("EIS_PASSWORD", "")


# ---- Monitoring Permohonan (Detail) -> DISTRIVA (docs/62 §52) ------------------------------------------------------------------------------------------------------------------
# Everything below comes from .env (see .env.example); no credential is ever written in the code.
DISTRIVA_URL = os.getenv("DISTRIVA_URL", "http://127.0.0.1:8001").rstrip("/")
DISTRIVA_EMAIL = os.getenv("DISTRIVA_EMAIL", "")
DISTRIVA_PASSWORD = os.getenv("DISTRIVA_PASSWORD", "")
DISTRIVA_TOKEN = os.getenv("DISTRIVA_TOKEN", "")          # set by DISTRIVA itself when it starts a sync (a short-lived token of the user who started it); then no email/password is needed
EIS_LOOKBACK_DAYS = int(os.getenv("EIS_LOOKBACK_DAYS", "180"))          # Range Mohon = today - N days .. today (statuses of older applications still change)
EIS_JENIS_MOHON = os.getenv("EIS_JENIS_MOHON", "PB/PD/PS")             # the option of the "Jenis Mohon" list
EIS_DOWNLOAD_DIR = os.getenv("EIS_DOWNLOAD_DIR", "downloads")
EIS_HEADLESS = os.getenv("EIS_HEADLESS", "0") == "1"
EIS_DAYA_MIN = os.getenv("EIS_DAYA_MIN", "0")                         # Range Daya (VA): the end field is mandatory on the page, so a wide range stands for "all"
EIS_DAYA_MAX = os.getenv("EIS_DAYA_MAX", "99999999")
EIS_MAX_ROWS_PER_FILE = int(os.getenv("EIS_MAX_ROWS_PER_FILE", "3000"))     # a long range is cut into windows of at most this many rows (~1.3 KB a row: DISTRIVA takes 5 MB / 20,000 rows a file)
EIS_MAX_FILE_BYTES = int(os.getenv("EIS_MAX_FILE_BYTES", str(5 * 1024 * 1024 - 250 * 1024)))
EIS_MAX_BACKFILL_DAYS = int(os.getenv("EIS_MAX_BACKFILL_DAYS", "730"))        # how far back a sync may reach to refresh an old application that is still running in DISTRIVA

