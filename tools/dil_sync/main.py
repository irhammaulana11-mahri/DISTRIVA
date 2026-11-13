"""DIL -> DISTRIVA master pelanggan.   python main.py inspect SUMBER [--table T]   |   python main.py load SUMBER [--table T] [--units 51453,51452] [--limit N] [--dry-run]
Akun dan alamat dari .env: DISTRIVA_URL, DISTRIVA_EMAIL, DISTRIVA_PASSWORD (Niaga Retail UP3, Perencanaan atau Enjiniring; SYS_ADMIN memerlukan MFA)."""
import argparse
import collections
import os
import sys

from dotenv import load_dotenv

import dil

load_dotenv()


def inspect(args):
    """Aggregate view only (counts); no name, address or contact is printed."""
    n = 0
    c = {k: collections.Counter() for k in ("UNITUP", "STATUS_DIL", "TARIF", "JENISLAYANAN")}
    no_gardu = 0
    for r in dil.read_rows(args.source, args.table, args.mdb_export):
        n += 1
        for k in c:
            c[k][r[k].strip()] += 1
        no_gardu += not r["NOMOR_GARDU"].strip()
        if args.limit and n >= args.limit:
            break
    print(f"{n} baris, {no_gardu} tanpa NOMOR_GARDU")
    for k, v in c.items():
        print(f"{k}: {v.most_common(12)}")


def run_load(args):
    client = None
    if not args.dry_run:
        client = dil.Client(os.getenv("DISTRIVA_URL", "http://127.0.0.1:8001"), os.getenv("DISTRIVA_EMAIL", ""), os.getenv("DISTRIVA_PASSWORD", ""))
        client.login()
    units = {u.strip() for u in args.units.split(",")} if args.units else None
    res = dil.load(args.source, client, args.table, args.chunk, args.limit, units, args.dry_run, mdb_export=args.mdb_export)
    print(res)


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)
    for name, fn in (("inspect", inspect), ("load", run_load)):
        s = sub.add_parser(name)
        s.add_argument("source")
        s.add_argument("--table")
        s.add_argument("--limit", type=int)
        s.add_argument("--mdb-export", default=os.getenv("MDB_EXPORT", "mdb-export"))
        if name == "load":
            s.add_argument("--units")
            s.add_argument("--chunk", type=int, default=1000)
            s.add_argument("--dry-run", action="store_true")
        s.set_defaults(fn=fn)
    a = p.parse_args(argv)
    a.fn(a)


if __name__ == "__main__":
    main()
