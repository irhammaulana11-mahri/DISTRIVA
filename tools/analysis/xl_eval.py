"""ANALYSIS TOOL (not the production evaluator): safe Excel-subset evaluator used to test whether the workbook volume formulas can be reproduced without eval(). See docs/59."""
import math, re
from wb import col2n, n2col

TOK = re.compile(r"""\s*(?:(?P<num>\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(?P<str>"(?:[^"]|"")*")|(?P<ref>(?:(?:'[^']+'|[A-Za-z_][A-Za-z0-9_.]*)!)?\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?)|(?P<fn>[A-Z][A-Z0-9.]*)\(|(?P<op><=|>=|<>|[-+*/^(),=<>&%]))""")
class Unsupported(Exception): pass

def tokens(s):
    pos, out = 0, []
    s = s.strip().lstrip("=")
    while pos < len(s):
        m = TOK.match(s, pos)
        if not m or m.end() == pos: raise Unsupported(f"token@{pos}:{s[pos:pos+12]!r}")
        pos = m.end()
        for k in ("num", "str", "ref", "fn", "op"):
            if m.group(k) is not None: out.append((k, m.group(k))); break
    return out

class Ev:
    def __init__(self, own, getsheet, ownname):
        self.own, self.getsheet, self.ownname, self.memo = own, getsheet, ownname, {}
    def cell(self, sheet, col, row, stack):
        rows = self.own if sheet in (None, self.ownname) else self.getsheet(sheet)
        c = rows.get(row, {}).get(col)
        if c is None: return 0.0
        key = (sheet or self.ownname, col, row)
        if key in self.memo: return self.memo[key]
        if c[1] and (sheet in (None, self.ownname)) and col in "HIJK" and key not in stack:
            v = self.evaluate(c[1], stack | {key})
        else:
            v = self.coerce(c[0])
        self.memo[key] = v
        return v
    @staticmethod
    def coerce(v):
        if v is None: return 0.0
        try: return float(v)
        except (TypeError, ValueError): return v
    def evaluate(self, formula, stack=frozenset()):
        saved = (getattr(self, "t", None), getattr(self, "i", 0), getattr(self, "stack", frozenset()))  # nested evaluations must not clobber the caller
        try:
            self.t, self.i, self.stack = tokens(formula), 0, stack
            v = self.expr()
            if self.i != len(self.t): raise Unsupported("trailing tokens")
            return v
        finally:
            self.t, self.i, self.stack = saved
    # recursive descent: comparison > concat > add > mul > pow > unary > atom
    def peek(self): return self.t[self.i] if self.i < len(self.t) else (None, None)
    def take(self): tok = self.t[self.i]; self.i += 1; return tok
    def expr(self):
        a = self.concat()
        while self.peek()[1] in ("=", "<>", "<", ">", "<=", ">="):
            op = self.take()[1]; b = self.concat()
            rank = lambda x: 2 if isinstance(x, bool) else (1 if isinstance(x, str) else 0)  # Excel order: numbers < text < booleans
            ka, kb = (rank(a), a if rank(a) != 1 else str(a).lower()), (rank(b), b if rank(b) != 1 else str(b).lower())
            if op in ("=", "<>") and rank(a) != rank(b): eq = False
            else: eq = ka == kb
            a = {"=": eq, "<>": not eq, "<": ka < kb, ">": ka > kb, "<=": ka <= kb, ">=": ka >= kb}[op]
        return a
    def concat(self):
        a = self.add()
        while self.peek()[1] == "&": self.take(); a = f"{a}{self.add()}"
        return a
    def add(self):
        a = self.mul()
        while self.peek()[1] in ("+", "-"):
            op = self.take()[1]; b = self.mul(); a = self.num(a) + self.num(b) if op == "+" else self.num(a) - self.num(b)
        return a
    def mul(self):
        a = self.pow()
        while self.peek()[1] in ("*", "/"):
            op = self.take()[1]; b = self.pow(); a = self.num(a) * self.num(b) if op == "*" else self.num(a) / self.num(b)
        return a
    def pow(self):
        a = self.unary()
        while self.peek()[1] == "^": self.take(); a = self.num(a) ** self.num(self.unary())
        return a
    def unary(self):
        if self.peek()[1] in ("+", "-"):
            op = self.take()[1]; v = self.unary(); return self.num(v) if op == "+" else -self.num(v)
        return self.atom()
    @staticmethod
    def num(v):
        if isinstance(v, bool): return 1.0 if v else 0.0
        if isinstance(v, (int, float)): return float(v)
        if v in ("", None): return 0.0
        try: return float(v)  # Excel coerces numeric text ("0") in arithmetic
        except (TypeError, ValueError): raise Unsupported(f"non-numeric operand {v!r}")
    def atom(self):
        kind, val = self.take()
        if kind == "num": v = float(val)
        elif kind == "str": v = val[1:-1].replace('""', '"')
        elif kind == "ref": v = self.ref(val)
        elif kind == "fn":
            args = []
            if self.peek()[1] != ")":
                args.append(self.expr())
                while self.peek()[1] == ",": self.take(); args.append(self.expr())
            if self.take()[1] != ")": raise Unsupported("missing )")
            v = self.call(val, args)
        elif val == "(":
            v = self.expr()
            if self.take()[1] != ")": raise Unsupported("missing )")
        else: raise Unsupported(f"unexpected {val}")
        if self.peek()[1] == "%": self.take(); v = self.num(v) / 100
        return v
    def ref(self, text):
        sheet = None
        if "!" in text: sheet, text = text.rsplit("!", 1); sheet = sheet.strip("'")
        text = text.replace("$", "")
        if ":" in text:
            a, b = text.split(":"); ca, ra = re.match(r"([A-Z]+)(\d+)", a).groups(); cb, rb = re.match(r"([A-Z]+)(\d+)", b).groups()
            return [[self.cell(sheet, n2col(c), r, self.stack) for c in range(col2n(ca), col2n(cb) + 1)] for r in range(int(ra), int(rb) + 1)]
        c, r = re.match(r"([A-Z]+)(\d+)", text).groups()
        return self.cell(sheet, c, int(r), self.stack)
    def flat(self, v):
        if isinstance(v, list):
            for x in v:
                yield from self.flat(x)
        else: yield v
    def call(self, fn, a):
        n = self.num
        if fn == "IF": return a[1] if a[0] else (a[2] if len(a) > 2 else False)
        if fn == "OR": return any(bool(x) for v in a for x in self.flat(v))
        if fn == "AND": return all(bool(x) for v in a for x in self.flat(v))
        if fn == "SUM": return sum(x for v in a for x in self.flat(v) if isinstance(x, (int, float)) and not isinstance(x, bool))
        if fn == "TRUNC": d = int(n(a[1])) if len(a) > 1 else 0; return math.trunc(n(a[0]) * 10 ** d) / 10 ** d
        if fn == "ROUND": d = int(n(a[1])); x = n(a[0]) * 10 ** d; return math.floor(abs(x) + 0.5) * (1 if x >= 0 else -1) / 10 ** d
        if fn == "ROUNDUP": d = int(n(a[1])); x = n(a[0]) * 10 ** d; return math.ceil(abs(x) - 1e-12) * (1 if x >= 0 else -1) / 10 ** d
        if fn == "SUMIF":
            crit_range, crit = list(self.flat(a[0])), a[1]
            sum_range = list(self.flat(a[2])) if len(a) > 2 else crit_range
            tot = 0.0
            for cv, sv in zip(crit_range, sum_range):
                ok = (str(cv).strip() == str(crit).strip()) if not isinstance(crit, (int, float)) else (isinstance(cv, (int, float)) and float(cv) == float(crit))
                if ok and isinstance(sv, (int, float)): tot += sv
            return tot
        raise Unsupported(f"function {fn}")
