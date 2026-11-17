"""Memilih WO yang perlu diambil dari daftar (tanpa jaringan)."""
import re
from datetime import datetime

GARDU = re.compile(r"\b([A-Z]{2}\d{1,4})\b")


def gardu_of(description, location=""):
    """Kode gardu dari deskripsi WO ("Perbaikan/Pergantian INSPEKSI GARDU HC0505" -> HC0505); cadangan: nama lokasi ("GD HD0744 PENYULANG ..."). Yang terakhir di teks menang."""
    for text in (description or "", location or ""):
        found = GARDU.findall(text.upper())
        if found:
            return found[-1]
    return ""


def when(text):
    """'23/07/2026 12:52 PM' -> datetime (None bila bukan tanggal)."""
    for fmt in ("%d/%m/%Y %I:%M %p", "%d/%m/%Y %H:%M", "%d/%m/%Y"):
        try:
            return datetime.strptime((text or "").strip(), fmt)
        except ValueError:
            continue
    return None


def choose(rows, latest_per_gardu=True, done=()):
    """WO yang diambil: terbaru per gardu (tanggal status, lalu nomor WO terbesar) atau semuanya; yang sudah diambil (`done`, nomor WO) dilewati. Urutan hasil = nomor WO."""
    done = set(done)
    best = {}
    for r in rows:
        if not r.get("wonum"):
            continue
        g = gardu_of(r.get("description"), r.get("location"))
        key = g if (latest_per_gardu and g) else r["wonum"]
        rank = (when(r.get("status_date")) or datetime.min, int(r["wonum"]))
        if key not in best or rank > best[key][0]:
            best[key] = (rank, r)
    return sorted((r for _, r in best.values() if r["wonum"] not in done), key=lambda r: int(r["wonum"]))
