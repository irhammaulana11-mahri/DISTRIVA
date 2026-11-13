#!/usr/bin/env python3
"""Import and approve the KHS catalogue through the DISTRIVA API, signed in as YOURSELF.

Why a script and not a console command: every draft and every approval is recorded with the person who did it
(separation of duties: the creator may not approve). Run the import as an ENGINEERING/PERENCANAAN user and the approval
as a different UP3_MANAGER user, each with their own login. Standard library only; the password is read from the
terminal (or DISTRIVA_PASSWORD for automation) and is never printed or stored.

  python3 tools/khs_admin.py import  --email engineer@... --file khs.csv --valid-from 2026-01-01          # dry run
  python3 tools/khs_admin.py import  --email engineer@... --file khs.csv --valid-from 2026-01-01 --apply  # real import (drafts)
  python3 tools/khs_admin.py approve --email manager@...                                                  # approve all pending drafts

Construction types (iteration 2B-2): files come from tools/extract_construction_csv.py; run as ENGINEERING/PERENCANAAN, approve as UP3_MANAGER.
  python3 tools/khs_admin.py types-import    --email engineer@... --file tools/output/construction_types.csv --valid-from 2026-01-01 [--apply]
  python3 tools/khs_admin.py mappings-import --email engineer@... --file tools/output/construction_mappings.csv [--apply]
  python3 tools/khs_admin.py types-approve   --email manager@...        # approves drafts that HAVE mappings, lists the rest

BOM (iteration 2C-2): files from tools/extract_bom_json.py; run as ENGINEERING/PERENCANAAN, approve as UP3_MANAGER.
  python3 tools/khs_admin.py bom-import  --email engineer@... --dir tools/output --valid-from 2026-01-01 [--group SUTM ...] [--apply]
  python3 tools/khs_admin.py bom-approve --email manager@...

--base defaults to $DISTRIVA_API or http://127.0.0.1:8001 (the port `php artisan serve` printed).
Create khs.csv with: python3 -I tools/extract_khs_csv.py "MASTER RAB & KKF.xlsx" khs.csv
"""
import argparse, getpass, json, mimetypes, os, sys, urllib.error, urllib.request, uuid


def call(base, method, path, token=None, body=None, files=None, fields=None):
    headers = {"Accept": "application/json"}
    data = None
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if files is not None:
        boundary = uuid.uuid4().hex
        parts = []
        for k, v in (fields or {}).items():
            parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
        for k, (name, content) in files.items():
            ctype = mimetypes.guess_type(name)[0] or "text/csv"
            parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"; filename="{name}"\r\nContent-Type: {ctype}\r\n\r\n'.encode() + content + b"\r\n")
        parts.append(f"--{boundary}--\r\n".encode())
        data = b"".join(parts)
        headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"
    elif body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(base.rstrip("/") + "/api" + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b"{}")
        except ValueError:
            return e.code, {"message": f"HTTP {e.code}"}
    except urllib.error.URLError as e:
        sys.exit(f"Tidak dapat terhubung ke {base}: {e.reason}. Periksa port yang ditampilkan `php artisan serve`.")


def login(base, email):
    password = os.environ.get("DISTRIVA_PASSWORD") or getpass.getpass(f"Password untuk {email}: ")
    status, res = call(base, "POST", "/auth/login", body={"email": email, "password": password})
    if status != 200:
        sys.exit(f"Login gagal (HTTP {status}): {res.get('message')}")
    if res.get("must_change_password"):
        sys.exit("Akun ini wajib mengganti password dahulu (buka aplikasi web).")
    return res["token"]


def show_rows(rows, limit=15):
    shown = [r for r in rows if r["action"] == "REJECT"][:limit]
    for r in shown:
        print(f"  baris {r['row']:>4} kode={r['code']!r}: {'; '.join(r['messages'])}")
    unit = [r for r in rows if r.get("unit_change")][:limit]
    for r in unit:
        print(f"  baris {r['row']:>4} kode={r['code']!r}: {'; '.join(r['messages'])}")


def cmd_import(a, token):
    content = open(a.file, "rb").read()
    fields = {"valid_from": a.valid_from, "dry_run": "0" if a.apply else "1", "accept_unit_changes": "1" if a.accept_unit_changes else "0"}
    if a.source:
        fields["source_reference"] = a.source
    status, res = call(a.base, "POST", "/master-data/khs/import", token, files={"file": (os.path.basename(a.file), content)}, fields=fields)
    if status not in (200, 201):
        sys.exit(f"Impor ditolak (HTTP {status}): {res.get('message')} {json.dumps(res.get('errors', ''))}")
    d = res["data"]
    print(("IMPOR NYATA" if a.apply else "DRY RUN (tidak ada yang ditulis)") + f": {d['total']} baris")
    print(f"  kode baru       : {d['new_items']}\n  versi baru      : {d['new_versions']}\n  tidak berubah   : {d['unchanged']}\n  ditolak         : {d['rejected']}\n  perubahan satuan: {d['unit_changes']}")
    show_rows(res["rows"])
    if not a.apply:
        print("\nUlangi dengan --apply untuk membuat draf. Draf belum aktif sebelum disetujui UP3_MANAGER.")
    else:
        print("\nDraf dibuat. Minta UP3_MANAGER (orang lain) menjalankan: tools/khs_admin.py approve")


def cmd_approve(a, token):
    drafts, page = [], 1
    while True:
        status, res = call(a.base, "GET", f"/master-data/khs?has_draft=1&per_page=100&page={page}", token)
        if status != 200:
            sys.exit(f"Gagal membaca daftar (HTTP {status}): {res.get('message')}")
        drafts += [i["draft"] for i in res["data"] if i.get("draft")]
        if page >= res["meta"]["last_page"]:
            break
        page += 1
    if not drafts:
        sys.exit("Tidak ada draf KHS yang menunggu persetujuan.")
    print(f"{len(drafts)} draf menunggu. Contoh:")
    for d in drafts[:5]:
        print(f"  v{d['version_number']} {d['name'][:60]} [{d['unit_text']}] berlaku sejak {d['valid_from']}")
    if not a.yes and input(f"\nSetujui SEMUA {len(drafts)} draf atas nama {a.email}? ketik 'ya': ").strip().lower() != "ya":
        sys.exit("Dibatalkan.")
    done = 0
    for i in range(0, len(drafts), 500):  # each request is all-or-nothing
        chunk = [d["id"] for d in drafts[i:i + 500]]
        status, res = call(a.base, "POST", "/master-data/khs/versions/approve", token, body={"version_ids": chunk, "reason": a.reason})
        if status != 200:
            sys.exit(f"Persetujuan ditolak (HTTP {status}): {res.get('message')} (sudah disetujui sebelum ini: {done})")
        done += res["data"]["approved"]
    print(f"Disetujui: {done}.")


def _upload(a, token, path, fields):
    content = open(a.file, "rb").read()
    status, res = call(a.base, "POST", path, token, files={"file": (os.path.basename(a.file), content)}, fields=fields)
    if status not in (200, 201):
        sys.exit(f"Ditolak (HTTP {status}): {res.get('message')} {json.dumps(res.get('errors', ''))}")
    return res


def cmd_types_import(a, token):
    fields = {"valid_from": a.valid_from, "dry_run": "0" if a.apply else "1", "source_reference": a.source}
    res = _upload(a, token, "/master-data/construction-types/import", fields)
    d = res["data"]
    print(("IMPOR NYATA" if a.apply else "DRY RUN (tidak ada yang ditulis)") + f": {d['total']} baris")
    print(f"  jenis baru: {d['new_types']} | versi baru: {d['new_versions']} | tidak berubah: {d['unchanged']} | ditolak: {d['rejected']}")
    for r in [r for r in res["rows"] if r["action"] == "REJECT"][:15]:
        print(f"  baris {r['row']:>4} {r['group']}/{r['label']!r}: {'; '.join(r['messages'])}")
    print("  contoh kode:", ", ".join(f"{r['code']}={r['label']}" for r in res["rows"][:3]))


def cmd_mappings_import(a, token):
    res = _upload(a, token, "/master-data/construction-types/mappings/import", {"dry_run": "0" if a.apply else "1"})
    d = res["data"]
    print(("IMPOR NYATA" if a.apply else "DRY RUN (tidak ada yang ditulis)") + f": {d['total']} baris")
    print(f"  baru: {d['inserted']} | diubah: {d['updated']} | tidak berubah: {d['unchanged']} | ditolak: {d['rejected']}")
    for r in [r for r in res["rows"] if r["action"] == "REJECT"][:15]:
        print(f"  baris {r['row']:>5} {r['construction']} KHS {r['khs_code']}: {'; '.join(r['messages'])}")


def cmd_types_approve(a, token):
    ready, waiting, page = [], [], 1
    while True:
        status, res = call(a.base, "GET", f"/master-data/construction-types?has_draft=1&per_page=100&page={page}", token)
        if status != 200:
            sys.exit(f"Gagal membaca daftar (HTTP {status}): {res.get('message')}")
        for t in res["data"]:
            (ready if t["draft"]["mappings_count"] > 0 else waiting).append(t)
        if page >= res["meta"]["last_page"]:
            break
        page += 1
    if waiting:
        print(f"{len(waiting)} draf BELUM punya pemetaan KHS dan dilewati: " + ", ".join(f"{t['code']} ({t['name']})" for t in waiting[:8]))
    if not ready:
        sys.exit("Tidak ada draf yang siap disetujui.")
    print(f"{len(ready)} draf siap. Contoh: " + ", ".join(f"{t['code']} ({t['draft']['mappings_count']} pemetaan)" for t in ready[:4]))
    if not a.yes and input(f"\nSetujui {len(ready)} draf atas nama {a.email}? ketik 'ya': ").strip().lower() != "ya":
        sys.exit("Dibatalkan.")
    done = 0
    for i in range(0, len(ready), 200):
        ids = [t["draft"]["id"] for t in ready[i:i + 200]]
        status, res = call(a.base, "POST", "/master-data/construction-types/versions/approve", token, body={"version_ids": ids, "reason": a.reason})
        if status != 200:
            sys.exit(f"Persetujuan ditolak (HTTP {status}): {res.get('message')} (sudah disetujui sebelum ini: {done})")
        done += res["data"]["approved"]
    print(f"Disetujui: {done}.")


def cmd_bom_import(a, token):
    import glob
    files = sorted(glob.glob(os.path.join(a.dir, "bom_*.json")))
    if a.group:
        files = [f for f in files if os.path.basename(f) in {f"bom_{g}.json" for g in a.group}]
    if not files:
        sys.exit(f"Tidak ada berkas bom_*.json di {a.dir} (buat dengan tools/extract_bom_json.py).")
    for f in files:
        a.file = f
        fields = {"valid_from": a.valid_from, "dry_run": "0" if a.apply else "1", "source_reference": a.source}
        content = open(f, "rb").read()
        status, res = call(a.base, "POST", "/master-data/bom/import", token, files={"file": (os.path.basename(f), content)}, fields=fields)
        name = os.path.basename(f)
        if status not in (200, 201):
            print(f"{name}: DITOLAK (HTTP {status}): {res.get('message')} {json.dumps(res.get('errors', ''))}")
            continue
        d = res["data"]
        print(f"{name}: {'IMPOR NYATA' if a.apply else 'DRY RUN'} — baris {d['accepted_lines']}/{d['total_lines']}, berkode KHS {d['with_khs']}, sel rumus {d['formula_cells']}, ditolak {d['rejected_lines']}")
        for p in res.get("problems", [])[:10]:
            print(f"   {p['where']}: {'; '.join(p['messages'])}")


def cmd_bom_approve(a, token):
    status, res = call(a.base, "GET", "/master-data/bom?status=DRAFT", token)
    if status != 200:
        sys.exit(f"Gagal membaca daftar (HTTP {status}): {res.get('message')}")
    drafts = res["data"]
    if not drafts:
        sys.exit("Tidak ada draf BOM.")
    print("Draf BOM: " + ", ".join(f"{d['group']} v{d['version_number']} ({d['lines_count']} baris, berlaku {d['valid_from']})" for d in drafts))
    if not a.yes and input(f"\nSetujui {len(drafts)} draf atas nama {a.email}? ketik 'ya': ").strip().lower() != "ya":
        sys.exit("Dibatalkan.")
    status, res = call(a.base, "POST", "/master-data/bom/versions/approve", token, body={"version_ids": [d["id"] for d in drafts], "reason": a.reason})
    if status != 200:
        sys.exit(f"Persetujuan ditolak (HTTP {status}): {res.get('message')}")
    print(f"Disetujui: {res['data']['approved']}; versi lama ditutup: {res['data']['auto_closed']}.")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--base", default=os.environ.get("DISTRIVA_API", "http://127.0.0.1:8001"))
    sub = p.add_subparsers(dest="cmd", required=True)
    i = sub.add_parser("import"); i.add_argument("--email", required=True); i.add_argument("--file", required=True)
    i.add_argument("--valid-from", required=True, dest="valid_from", help="YYYY-MM-DD"); i.add_argument("--source", default="MASTER RAB & KKF.xlsx / sheet KHS")
    i.add_argument("--apply", action="store_true"); i.add_argument("--accept-unit-changes", action="store_true")
    ap = sub.add_parser("approve"); ap.add_argument("--email", required=True); ap.add_argument("--yes", action="store_true")
    ap.add_argument("--reason", default="Verifikasi katalog KHS dari workbook MASTER RAB & KKF")
    ti = sub.add_parser("types-import"); ti.add_argument("--email", required=True); ti.add_argument("--file", required=True)
    ti.add_argument("--valid-from", required=True, dest="valid_from"); ti.add_argument("--source", default="MASTER RAB & KKF.xlsx / sheet GAMBAR"); ti.add_argument("--apply", action="store_true")
    mi = sub.add_parser("mappings-import"); mi.add_argument("--email", required=True); mi.add_argument("--file", required=True); mi.add_argument("--apply", action="store_true")
    bi = sub.add_parser("bom-import"); bi.add_argument("--email", required=True); bi.add_argument("--dir", default="tools/output"); bi.add_argument("--group", action="append", help="only this group (repeatable), e.g. --group SUTM")
    bi.add_argument("--valid-from", required=True, dest="valid_from"); bi.add_argument("--source", default="MASTER RAB & KKF.xlsx / sheet BOM"); bi.add_argument("--apply", action="store_true")
    ba = sub.add_parser("bom-approve"); ba.add_argument("--email", required=True); ba.add_argument("--yes", action="store_true"); ba.add_argument("--reason", default="Verifikasi BOM dan rumus dari workbook MASTER RAB & KKF")
    ta = sub.add_parser("types-approve"); ta.add_argument("--email", required=True); ta.add_argument("--yes", action="store_true")
    ta.add_argument("--reason", default="Verifikasi jenis konstruksi dan pemetaan KHS dari workbook MASTER RAB & KKF")
    a = p.parse_args()
    token = login(a.base, a.email)
    try:
        {"import": cmd_import, "approve": cmd_approve, "types-import": cmd_types_import, "mappings-import": cmd_mappings_import, "types-approve": cmd_types_approve, "bom-import": cmd_bom_import, "bom-approve": cmd_bom_approve}[a.cmd](a, token)
    finally:
        call(a.base, "POST", "/auth/logout", token)


if __name__ == "__main__":
    main()
