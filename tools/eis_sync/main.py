"""EIS -> DISTRIVA (docs/62 §52).  Usage (from tools/eis_sync, with the .env filled in):

  python main.py inspect                         log in, open LAYANAN > MONITORING PERMOHONAN (Detail), save the form to debug/ (to fix locators; nothing is loaded)
  python main.py cek [--dari D --sampai D] [--metode http]       muat rentang itu dan periksa tabelnya (jumlah baris, kolom, kolom wajib, isian tidak valid); tanpa unduhan dan tanpa unggahan
  python main.py export [--dari D --sampai D]    download the Excel export of the range (default: today - EIS_LOOKBACK_DAYS .. today) into downloads/
  python main.py sync [--dari D --sampai D]      export + upload to DISTRIVA as a STAGED batch (nothing is written to the applications yet)
  python main.py sync --konfirmasi               ... and apply the batch at once (scheduled runs should add this once the first manual runs looked right)
  (rentang panjang: metode http memecahnya otomatis menjadi potongan <= EIS_MAX_ROWS_PER_FILE baris, satu berkas dan satu batch per potongan; pakai --konfirmasi agar semuanya langsung diterapkan)
  (berkas Excel hasil unduhan dihapus setelah berhasil disinkron; --simpan-berkas menyimpannya; berkas dari --berkas tidak pernah dihapus)
  (setelah rentangnya: DISTRIVA melaporkan permohonan yang masih berjalan tetapi lebih tua dari rentang; dengan --konfirmasi alat menarik otomatis rentang lama itu, kecuali --tanpa-lengkapi)
  python main.py sync --metode http              ambil lewat HTTP biasa seperti alur piutang (tanpa peramban untuk data; peramban hanya untuk login bila cookie habis)
  python main.py sync --metode http --per-unit   pilih unit EIS satu per satu dari yang paling atas (kotak UP di bilah atas): unduh dan unggah tiap unit, lanjut ke unit berikutnya sampai selesai
  python main.py sync --metode http --unit 51453 [--unit 51454]   hanya unit itu (kode ULP)
  python main.py sync --sumber grid              ... baca tabel hasil di layar (tanpa Export Excel) menjadi CSV yang diimpor DISTRIVA
  python main.py sync --berkas FILE              skip the EIS and upload a file that was exported before
  python main.py piutang --dari 2026-01 --sampai 2026-10 [--unit 51453] [--laporan GOLONGAN,LEMBAR,KOGOL,PRABAYAR,KONTROL309]   laporan EIS bulanan (saldo piutang per golongan, per lembar, kogol, saldo prabayar, dan kontrol penjualan 309) per ULP per bulan -> ZIP -> impor laporan EIS DISTRIVA
  python main.py schedule [--jam 18:13]          run `sync` every day at that time (add --konfirmasi to apply)
The old receivables ("piutang", MongoDB) job is unchanged: python piutang.py
Dates: dd/mm/yyyy or yyyy-mm-dd.
"""
import argparse
import sys


def _export(args, d_from, d_to):
    """Returns a list of (file, rows-in-the-EIS-table-for-that-file or None); empty when there is nothing."""
    from app import permohonan
    jenis = args.jenis or permohonan.EIS_JENIS_MOHON
    if getattr(args, "metode", "browser") == "http":
        if getattr(args, "sumber", "excel") == "grid":
            raise SystemExit("--sumber grid hanya untuk --metode browser (metode http memakai Export Excel).")
        from app import permohonan_http
        return permohonan_http.export_many(d_from, d_to, jenis, on_file=getattr(args, "on_file", None), **(getattr(args, "limits", None) or {}))   # a long range is cut into windows that fit DISTRIVA's upload limits
    path = permohonan.export(d_from, d_to, jenis, sumber=getattr(args, "sumber", "excel"))
    return [] if path is None else [(path, (permohonan.LAST or {}).get("items"))]


def _remove(path):
    import os
    try:
        os.remove(path)
        print(f"Berkas unduhan dihapus: {path}")
    except OSError as e:
        print(f"PERINGATAN: berkas {path} tidak dapat dihapus ({e}).")


def _upload(client, path, expected, confirm, delete=False):
    """One file -> one STAGED batch (confirmed when asked); the row count of the EIS table is compared with what DISTRIVA received.
    A count that differs is never applied automatically and its file is kept for inspection. The downloaded file is deleted (`delete`) only once everything asked of it succeeded
    (staged, and confirmed when --konfirmasi); on any failure it stays, so the run can be repeated with --berkas."""
    from app.distriva import summarize
    batch = client.stage(path)
    print(f"[{path}] Tersimpan sementara:", summarize(batch))
    if expected is not None and batch.get("total_rows") != expected:
        print(f"PERINGATAN: tabel EIS menyebut {expected} baris, DISTRIVA menerima {batch.get('total_rows')} baris. Batch dibiarkan sementara (tidak diterapkan otomatis) dan berkas disimpan untuk diperiksa.")
        return batch
    if expected is not None:
        print(f"Cocok: {expected} baris di tabel EIS dan di DISTRIVA.")
    if (batch.get("counts") or {}).get("REJECT"):
        print("Ada baris ditolak: lihat rinciannya di halaman Impor Permohonan DISTRIVA.")
    if confirm:
        print("Diterapkan:", summarize(client.confirm(batch["id"])))
    if delete:
        _remove(path)
    return batch


def _range(args):
    """(from, to) of the run: both given, or the default (today - EIS_LOOKBACK_DAYS .. today); giving only one is refused (it would be silently ignored otherwise)."""
    from app import permohonan
    if bool(args.dari) != bool(args.sampai):
        raise SystemExit("Isi --dari dan --sampai bersama-sama (atau keduanya dikosongkan untuk rentang bawaan).")
    if args.dari:
        return permohonan.parse_date(args.dari), permohonan.parse_date(args.sampai)
    return permohonan.default_range()


def _stale_check(client, args, d_from):
    """No application may stay out of date only because it is older than the synced range: report the ones still running in DISTRIVA that were requested before `d_from`, and (with --konfirmasi)
    pull exactly their range from the EIS so a status that became PEREMAJAAN there is applied here too."""
    from datetime import timedelta
    from app import permohonan
    from app.config import EIS_MAX_BACKFILL_DAYS
    st = client.stale(d_from.isoformat())
    if not st["total"]:
        print(f"Tidak ada permohonan yang masih berjalan di DISTRIVA dan diajukan sebelum {permohonan.fmt(d_from)}.")
        return
    print(f"PERHATIAN: {st['total']} permohonan masih berjalan di DISTRIVA tetapi diajukan sebelum {permohonan.fmt(d_from)} (terlama {st['oldest']}); rentang ini tidak memperbarui statusnya.")
    if not (args.konfirmasi and args.lengkapi):
        print("Ulangi dengan --konfirmasi (tanpa --tanpa-lengkapi) agar rentang lama itu ditarik otomatis, atau perlebar --dari.")
        return
    start = max(permohonan.parse_date(st["oldest"]), d_from - timedelta(days=EIS_MAX_BACKFILL_DAYS))
    end = d_from - timedelta(days=1)
    print(f"Menarik rentang lama {permohonan.fmt(start)} - {permohonan.fmt(end)} untuk memperbarui permohonan itu ...")
    keep = not getattr(args, "simpan", False)
    sent = set()

    def on_file(path, expected):
        _upload(client, path, expected, True, delete=keep)
        sent.add(str(path))

    prior = getattr(args, "on_file", None)
    args.on_file = on_file  # files are uploaded as they are exported; never upload them a second time
    try:
        for path, expected in _export(args, start, end):
            if str(path) not in sent:
                _upload(client, path, expected, True, delete=keep)
    finally:
        args.on_file = prior
    left = client.stale(d_from.isoformat())
    print(f"Setelah rentang lama: {left['total']} permohonan masih berjalan dan lebih tua dari {permohonan.fmt(d_from)}"
          + (f" (terlama {left['oldest']}; ini memang belum selesai di EIS, atau lebih tua dari EIS_MAX_BACKFILL_DAYS={EIS_MAX_BACKFILL_DAYS} hari)." if left["total"] else "."))


BYTES_PER_ROW = 1400            # an EIS export row is ~1.3 KB


def _limits(client):
    """The file limits of this run: the configured ones, lowered to what the DISTRIVA server really accepts (90 % of its effective limit, because the file size is only known after the export)."""
    from app.config import EIS_MAX_FILE_BYTES, EIS_MAX_ROWS_PER_FILE
    lim = client.limits()
    max_bytes = min(EIS_MAX_FILE_BYTES, int(int(lim["effective_max_bytes"]) * 0.9))
    max_rows = min(EIS_MAX_ROWS_PER_FILE, int(lim["max_rows"]), max(200, max_bytes // BYTES_PER_ROW))
    print(f"Batas unggah DISTRIVA: {int(lim['effective_max_bytes']) / 1048576:.1f} MB per berkas (PHP upload_max_filesize {int(lim['php_upload_max_bytes']) / 1048576:.1f} MB); "
          f"berkas dipotong <= {max_bytes / 1048576:.1f} MB dan <= {max_rows} baris.")
    return {"max_rows": max_rows, "max_bytes": max_bytes}


def _unit_choices(args, session):
    """(units of this run as (code, name), every code of the EIS combo): the ones named with --unit (checked against the combo), or every unit of the combo, from the top."""
    from app import permohonan_http as eis
    available = eis.list_units(session)
    names = dict(available)
    wanted = [c.strip() for item in (getattr(args, "unit", None) or []) for c in str(item).split(",") if c.strip()]
    unknown = [c for c in wanted if c not in names]
    if unknown:
        raise SystemExit(f"Unit tidak ada di kotak UP EIS: {', '.join(unknown)}. Yang tersedia: {', '.join(names)}.")
    return ([(c, names[c]) for c in wanted] if wanted else available), list(names)


def _sync_units(client, args, d_from, d_to):
    """Unit by unit, like the MIMS pull per warehouse: choose the unit in EIS, download its range, upload it, and only then go on to the next unit. A unit that fails (after the retries inside the export)
    is reported and the run continues with the next one; the exit code is 1 when any unit failed, so the run is visibly incomplete."""
    from app import permohonan_http as eis
    if getattr(args, "metode", "browser") != "http":
        raise SystemExit("--per-unit dan --unit memerlukan --metode http (pilihan unit dikirim lewat HTTP seperti kotak UP di EIS).")
    if args.berkas:
        raise SystemExit("--per-unit tidak dapat dipakai bersama --berkas.")
    session = eis.http_session()
    units, known = _unit_choices(args, session)
    args.limits = _limits(client)
    ok, failed = [], []
    try:
        for i, (code, name) in enumerate(units, 1):
            print(f"=== Unit {i}/{len(units)}: {code} {name} ===", flush=True)
            sent = set()

            def on_file(path, expected, _sent=sent):
                _upload(client, path, expected, args.konfirmasi, delete=not getattr(args, "simpan", False))
                _sent.add(str(path))

            args.on_file = on_file
            try:
                client.login()                                # a fresh token per unit: a long run outlives the token's idle time
                eis.set_unit(code, known)
                files = [f for f in (_export(args, d_from, d_to) or []) if str(f[0]) not in sent]
                for path, expected in files:
                    _upload(client, path, expected, args.konfirmasi, delete=not getattr(args, "simpan", False))
                print(f"Unit {code} selesai ({len(sent) + len(files)} berkas).", flush=True)
                ok.append(code)
            except SystemExit:
                raise
            except Exception as e:                            # one unit's failure does not stop the others
                print(f"Unit {code} GAGAL: {e}", flush=True)
                failed.append((code, str(e)))
        if not args.konfirmasi:
            print("Belum diterapkan: buka halaman Impor Permohonan untuk meninjau batch sementara tiap unit (atau ulangi dengan --konfirmasi).")
        eis.set_unit(eis.ALL_UNITS, known)                    # the backfill of older applications below is meant for every unit
        _stale_check(client, args, d_from)
    finally:
        try:
            eis.select_unit(session, eis.ALL_UNITS)             # leave the EIS session on "-SEMUA UP-" so a later plain run is not filtered by the last unit
        except eis.EISSessionExpired:
            print("Sesi EIS sudah berakhir; pilihan unit kembali ke SEMUA UP pada login berikutnya.")
        except Exception as e:
            print(f"PERINGATAN: pilihan unit EIS tidak dapat dikembalikan ke SEMUA UP ({e}); sesi EIS berikutnya akan memulai ulang.")
        eis.set_unit(None)
    print(f"Ringkasan unit: {len(ok)} berhasil ({', '.join(ok) or '-'}); {len(failed)} gagal ({', '.join(c for c, _ in failed) or '-'}).")
    return 1 if failed else 0


def do_sync(args):
    from app.distriva import DistrivaClient
    d_from, d_to = _range(args)
    client = DistrivaClient()
    client.login()
    try:
        if getattr(args, "per_unit", False) or getattr(args, "unit", None):
            return _sync_units(client, args, d_from, d_to)
        if args.berkas:
            files = [(args.berkas, None)]
        else:
            done = set()
            if getattr(args, "metode", "browser") == "http":
                args.limits = _limits(client)
                def on_file(path, expected):                  # each file goes up as soon as it is downloaded, so a failure later in a long run loses nothing
                    _upload(client, path, expected, args.konfirmasi, delete=not getattr(args, "simpan", False))
                    done.add(str(path))
                args.on_file = on_file
            files = _export(args, d_from, d_to)
            if not files:
                return 0
            if not done:
                client.login()                               # a fresh token: the export can take longer than the token's idle time
            files = [f for f in files if str(f[0]) not in done]
        for path, expected in files:
            _upload(client, path, expected, args.konfirmasi, delete=not args.berkas and not getattr(args, "simpan", False))
        if not args.konfirmasi:
            print(f"Belum diterapkan ({len(files)} batch sementara): buka halaman Impor Permohonan untuk meninjau lalu mengonfirmasi (atau ulangi dengan --konfirmasi).")
        if not args.berkas:
            _stale_check(client, args, d_from)
    finally:
        client.logout()
    return 0


def do_piutang(args):
    """Laporan saldo piutang bulanan (docs/88): bulan demi bulan, semua unit yang dipilih, tiga laporan; satu ZIP per bulan diunggah ke impor laporan EIS."""
    from app import permohonan_http as eis
    from app import saldo_http
    from app.distriva import DistrivaClient
    last = saldo_http.parse_month(args.sampai)
    first = saldo_http.parse_month(args.dari) if args.dari else last
    if first > last:
        raise SystemExit("--dari tidak boleh setelah --sampai.")
    months = saldo_http.months_between(first, last)
    if len(months) > 24:
        raise SystemExit("Paling banyak 24 bulan per putaran.")
    wanted = [x.strip().upper() for x in (args.laporan or "").split(",") if x.strip()] or list(saldo_http.DEFAULT_LAPORAN)
    unknown = [x for x in wanted if x not in saldo_http.LAPORAN]
    if unknown:
        raise SystemExit(f"Laporan tidak dikenal: {', '.join(unknown)}. Pilihan: {', '.join(saldo_http.LAPORAN)}.")
    session = eis.http_session()
    units, _known = _unit_choices(args, session)
    client = DistrivaClient()
    client.login()
    print(f"Mulai: {len(wanted)} laporan x {len(units)} unit x {len(months)} bulan ({first} s.d. {last})", flush=True)
    try:
        return saldo_http.run(client, units, months, wanted, keep_dir=args.simpan_zip)
    finally:
        client.logout()


def main(argv=None):
    ap = argparse.ArgumentParser(description="Sinkron permohonan EIS (Layanan > Monitoring Permohonan Detail) ke DISTRIVA")
    sub = ap.add_subparsers(dest="cmd")
    sub.add_parser("inspect")
    for name in ("cek", "export", "sync", "schedule"):
        p = sub.add_parser(name)
        p.add_argument("--dari")
        p.add_argument("--sampai")
        p.add_argument("--jenis")
        p.add_argument("--metode", choices=["browser", "http"], default="browser", help="browser = Playwright (bawaan); http = permintaan HTTP seperti alur piutang")
        p.add_argument("--sumber", choices=["excel", "grid"], default="excel", help="excel = Export Excel (bawaan); grid = baca tabel hasil halaman demi halaman, tanpa unduhan")
        if name not in ("export", "cek"):
            p.add_argument("--konfirmasi", action="store_true")
        if name in ("sync", "schedule"):
            p.add_argument("--tanpa-lengkapi", dest="lengkapi", action="store_false", help="jangan menarik otomatis rentang lama untuk permohonan yang masih berjalan di DISTRIVA")
            p.add_argument("--simpan-berkas", dest="simpan", action="store_true", help="jangan hapus berkas unduhan setelah berhasil disinkron (bawaan: dihapus)")
        if name in ("sync", "schedule"):
            p.add_argument("--per-unit", dest="per_unit", action="store_true", help="pilih unit EIS satu per satu dari yang paling atas; unduh dan unggah tiap unit, lanjut ke unit berikutnya sampai selesai (butuh --metode http)")
            p.add_argument("--unit", action="append", help="hanya unit ini (kode ULP, mis. 51453); boleh diulang atau dipisah koma; menyiratkan --per-unit")
        if name == "sync":
            p.add_argument("--berkas")
        if name == "schedule":
            p.add_argument("--jam", default="18:13")
    pp = sub.add_parser("piutang")
    pp.add_argument("--dari", help="bulan awal YYYY-MM (bawaan: sama dengan --sampai)")
    pp.add_argument("--sampai", required=True, help="bulan akhir YYYY-MM")
    pp.add_argument("--unit", action="append", help="hanya unit ini (kode ULP); boleh diulang atau dipisah koma; bawaan semua unit di kotak UP EIS")
    pp.add_argument("--laporan", help="GOLONGAN,LEMBAR,KOGOL,PRABAYAR,KONTROL309 (bawaan: empat yang pertama)")
    pp.add_argument("--simpan-zip", dest="simpan_zip", help="folder untuk menyimpan ZIP tiap bulan (bawaan: tidak disimpan)")
    args = ap.parse_args(argv)
    if args.cmd is None:                                # `python main.py` alone: show how to use it (nothing is run, no login, no upload)
        print(__doc__)
        return 0
    if args.cmd == "inspect":
        from app import permohonan
        permohonan.inspect()
        return 0
    if args.cmd == "cek":
        from app import permohonan
        d_from = permohonan.parse_date(args.dari) if args.dari else None
        d_to = permohonan.parse_date(args.sampai) if args.sampai else None
        if args.metode == "http":
            from app import permohonan_http
            st = permohonan_http.check(d_from, d_to, args.jenis or permohonan.EIS_JENIS_MOHON)
        else:
            st = permohonan.check(d_from, d_to, args.jenis or permohonan.EIS_JENIS_MOHON)
        return 0 if st["items"] > 0 else 1
    if args.cmd == "export":
        from app import permohonan
        _export(args, permohonan.parse_date(args.dari) if args.dari else None, permohonan.parse_date(args.sampai) if args.sampai else None)
        return 0
    if args.cmd == "sync":
        return do_sync(args)
    if args.cmd == "piutang":
        return do_piutang(args)
    from apscheduler.schedulers.blocking import BlockingScheduler
    hour, minute = args.jam.split(":")
    args.berkas = None
    sched = BlockingScheduler()
    sched.add_job(lambda: do_sync(args), "cron", hour=int(hour), minute=int(minute))
    print(f"Penjadwal berjalan: sinkron tiap hari pukul {args.jam}{' (otomatis diterapkan)' if args.konfirmasi else ' (hanya diunggah, perlu konfirmasi)'}")
    try:
        sched.start()
    except KeyboardInterrupt:
        print("\nPenjadwal dihentikan.")
    return 0


if __name__ == "__main__":
    from app.session import EisTidakTersedia

    try:
        sys.exit(main())
    except EisTidakTersedia as exc:
        print(f"❌ {exc}", file=sys.stderr)
        sys.exit(2)
