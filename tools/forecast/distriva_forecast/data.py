"""CSV -> training samples for the substation-load network.

readings.csv     substation_id, measured_on (YYYY-MM-DD), load_kva, capacity_kva, end_voltage_v (may be empty)
substations.csv  substation_id, unit_id, capacity_kva, transformer_count, customers, contracted_kva (empty allowed)
"""
from __future__ import annotations

import csv
import math
from dataclasses import dataclass, field
from datetime import date

import numpy as np

K = 5                       # readings of history fed to the network
STEP_DIM = 7                # age, ratio, voltage, has_voltage, capacity ratio, mask, ratio change since previous
STATIC_DIM = 7
MIN_GAP_YEARS = 0.1
MAX_GAP_YEARS = 6.0
MAX_RATIO = 2.5             # readings above 250 % of capacity are treated as measurement noise
TRAIN_END = date(2024, 7, 1)
VAL_END = date(2025, 7, 1)
YEAR = 365.25


@dataclass
class Substation:
    sid: str
    unit_index: int
    capacity: float
    trafo_count: float
    customers: float | None
    contracted_kva: float | None
    readings: list[tuple[date, float, float, float | None]] = field(default_factory=list)   # date, load_kva, capacity_kva, voltage


def _f(v: str | None) -> float | None:
    if v is None or v == '':
        return None
    try:
        x = float(v)
    except ValueError:
        return None
    return x if math.isfinite(x) else None


def load(readings_path: str, substations_path: str) -> tuple[dict[str, Substation], list[str]]:
    units: dict[str, int] = {}
    subs: dict[str, Substation] = {}
    with open(substations_path, newline='', encoding='utf-8') as fh:
        for r in csv.DictReader(fh):
            cap = _f(r.get('capacity_kva'))
            unit = units.setdefault(r['unit_id'], len(units) + 1)       # 0 = unknown unit
            subs[r['substation_id']] = Substation(r['substation_id'], unit, cap or 0.0, _f(r.get('transformer_count')) or 1.0, _f(r.get('customers')), _f(r.get('contracted_kva')))
    with open(readings_path, newline='', encoding='utf-8') as fh:
        for r in csv.DictReader(fh):
            s = subs.get(r['substation_id'])
            load_kva, cap = _f(r.get('load_kva')), _f(r.get('capacity_kva'))
            if s is None or load_kva is None or cap is None or cap <= 0 or load_kva < 0:
                continue
            if load_kva / cap > MAX_RATIO:
                continue
            s.readings.append((date.fromisoformat(r['measured_on'][:10]), load_kva, cap, _f(r.get('end_voltage_v'))))
    for s in subs.values():
        by_day: dict[date, tuple] = {}
        for rd in sorted(s.readings, key=lambda x: x[0]):
            by_day[rd[0]] = rd                                           # one reading per day: the last one wins
        s.readings = [by_day[d] for d in sorted(by_day)]
        if s.capacity <= 0 and s.readings:
            s.capacity = s.readings[-1][2]
    return subs, [u for u, _ in sorted(units.items(), key=lambda kv: kv[1])]


def _step(rd: tuple, prev_ratio: float | None, asof: date, asof_cap: float, present: bool = True) -> list[float]:
    d, load_kva, cap, volt = rd
    ratio = load_kva / cap
    return [
        (asof - d).days / YEAR / 3.0,
        ratio,
        (volt / 230.0 - 1.0) * 5.0 if volt else 0.0,
        1.0 if volt else 0.0,
        min(cap / asof_cap, 4.0) / 2.0,
        1.0,
        (ratio - prev_ratio) if prev_ratio is not None else 0.0,
    ]


def features(s: Substation, i: int) -> tuple[np.ndarray, np.ndarray, float, date, float]:
    """History up to reading `i` -> (sequence [K, STEP_DIM], static [STATIC_DIM], capacity at the as-of, as-of date, last ratio)."""
    asof, _, asof_cap, _ = s.readings[i]
    lo = max(0, i - K + 1)
    seq = np.zeros((K, STEP_DIM), dtype=np.float32)
    prev = None
    rows = s.readings[lo:i + 1]
    for n, rd in enumerate(rows):
        seq[K - len(rows) + n] = _step(rd, prev, asof, asof_cap)
        prev = rd[1] / rd[2]
    first, last = s.readings[lo], s.readings[i]
    span = (last[0] - first[0]).days / YEAR
    slope = ((last[1] / last[2]) - (first[1] / first[2])) / span if span > 0.25 else 0.0
    cust = s.customers
    static = np.array([
        math.log(asof_cap) / 6.0,
        min(s.trafo_count, 3.0) / 3.0,
        math.log1p(cust) / 8.0 if cust is not None else 0.0,
        1.0 if cust is not None else 0.0,
        min((s.contracted_kva or 0.0) / asof_cap, 5.0) / 5.0 if s.contracted_kva is not None else 0.0,
        float(max(-1.0, min(1.0, slope))),
        len(rows) / K,
    ], dtype=np.float32)
    return seq, static, asof_cap, asof, last[1] / last[2]


@dataclass
class Samples:
    seq: np.ndarray
    static: np.ndarray
    unit: np.ndarray
    gap: np.ndarray
    y: np.ndarray
    last_ratio: np.ndarray
    target_date: list[date]
    unit_of: list[int]

    def __len__(self) -> int:
        return len(self.y)

    def take(self, idx: np.ndarray) -> 'Samples':
        return Samples(self.seq[idx], self.static[idx], self.unit[idx], self.gap[idx], self.y[idx], self.last_ratio[idx], [self.target_date[k] for k in idx], [self.unit_of[k] for k in idx])


def build_samples(subs: dict[str, Substation]) -> Samples:
    seqs, statics, units, gaps, ys, lasts, tdates, uof = [], [], [], [], [], [], [], []
    for s in subs.values():
        n = len(s.readings)
        if n < 2:
            continue
        for i in range(n - 1):
            seq, static, cap_i, asof, last_ratio = features(s, i)
            for j in range(i + 1, n):
                gap = (s.readings[j][0] - asof).days / YEAR
                if gap < MIN_GAP_YEARS or gap > MAX_GAP_YEARS:
                    continue
                seqs.append(seq)
                statics.append(static)
                units.append(s.unit_index)
                gaps.append(gap)
                ys.append(s.readings[j][1] / cap_i)
                lasts.append(last_ratio)
                tdates.append(s.readings[j][0])
                uof.append(s.unit_index)
    if not ys:
        return Samples(np.zeros((0, K, STEP_DIM), np.float32), np.zeros((0, STATIC_DIM), np.float32), np.zeros(0, np.int64), np.zeros(0, np.float32), np.zeros(0, np.float32), np.zeros(0, np.float32), [], [])
    return Samples(np.stack(seqs), np.stack(statics), np.array(units, np.int64), np.array(gaps, np.float32), np.array(ys, np.float32), np.array(lasts, np.float32), tdates, uof)


def split(samples: Samples) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    td = np.array([d.toordinal() for d in samples.target_date])
    train = np.where(td < TRAIN_END.toordinal())[0]
    val = np.where((td >= TRAIN_END.toordinal()) & (td < VAL_END.toordinal()))[0]
    test = np.where(td >= VAL_END.toordinal())[0]
    return train, val, test
