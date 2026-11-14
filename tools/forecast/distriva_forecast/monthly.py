"""Monthly demand forecasts by deep learning: new customers, added contracted power (VA) and material consumption, per ULP.

series.csv  series_id, kind (CUSTOMERS_ADDED | VA_ADDED | MATERIAL_ISSUE), unit_id, item_code, item_label, month (YYYY-MM), value
            Only complete months; months without a row are zero from the first month of that kind's data up to the cutoff.

One quantile GRU is shared by all the series (the series are scaled by their own level, so a material of 10 pieces and a ULP of 3,000 kVA learn from each other). A series is forecast only when
it has enough history (MIN_MONTHS months, MIN_NONZERO months with activity): with less, the run says so instead of inventing numbers.
"""
from __future__ import annotations

import csv
import math
import time
from dataclasses import dataclass

import numpy as np
import torch
from torch import nn

L = 12                       # months of history
H = 12                       # months forecast
MIN_MONTHS = 24
MIN_NONZERO = 6
MIN_WINDOWS = 150
MAX_RATIO = 10.0
KINDS = ('CUSTOMERS_ADDED', 'VA_ADDED', 'MATERIAL_ISSUE')
QUANTILES = (0.1, 0.5, 0.9)
STEP_DIM = 5                 # ratio, sin month, cos month, zero flag, previous-year ratio
STATIC_DIM = 6


def month_index(m: str) -> int:
    y, mo = m.split('-')
    return int(y) * 12 + int(mo) - 1


def month_label(i: int) -> str:
    return f'{i // 12:04d}-{i % 12 + 1:02d}'


@dataclass
class Series:
    sid: str
    kind: str
    unit: str
    item: str
    label: str
    start: int
    values: np.ndarray                  # one value per month from `start` to the cutoff
    unit_index: int = 0

    @property
    def end(self) -> int:
        return self.start + len(self.values) - 1

    @property
    def sufficient(self) -> bool:
        return len(self.values) >= MIN_MONTHS and int(np.count_nonzero(self.values)) >= MIN_NONZERO


def load(path: str, cutoff: str) -> tuple[list[Series], dict]:
    last = month_index(cutoff)
    rows: dict[str, dict] = {}
    kind_start: dict[str, int] = {}
    with open(path, newline='', encoding='utf-8') as fh:
        for r in csv.DictReader(fh):
            mi = month_index(r['month'])
            if mi > last or r['kind'] not in KINDS:
                continue
            s = rows.setdefault(r['series_id'], {'kind': r['kind'], 'unit': r['unit_id'], 'item': r['item_code'], 'label': r['item_label'], 'm': {}})
            s['m'][mi] = s['m'].get(mi, 0.0) + float(r['value'] or 0)
            kind_start[r['kind']] = min(kind_start.get(r['kind'], mi), mi)
    units: dict[str, int] = {}
    out = []
    for sid, s in rows.items():
        start = kind_start[s['kind']]
        vals = np.zeros(last - start + 1, dtype=np.float64)
        for mi, v in s['m'].items():
            vals[mi - start] = v
        out.append(Series(sid, s['kind'], s['unit'], s['item'], s['label'], start, vals, units.setdefault(s['unit'], len(units) + 1)))
    coverage = {k: {'months': (last - kind_start[k] + 1) if k in kind_start else 0, 'first_month': month_label(kind_start[k]) if k in kind_start else None,
                    'series': sum(1 for s in out if s.kind == k), 'sufficient_series': sum(1 for s in out if s.kind == k and s.sufficient)} for k in KINDS}
    return out, {'coverage': coverage, 'units': len(units)}


def _window(s: Series, origin: int) -> tuple[np.ndarray, np.ndarray, float]:
    """History of the L months before `origin` (a month index) -> [L, STEP_DIM], static, scale."""
    hist = s.values[origin - s.start - L: origin - s.start]
    mean = float(hist.mean())
    scale = mean if mean > 0 else max(float(s.values.mean()), 1e-6)
    seq = np.zeros((L, STEP_DIM), dtype=np.float32)
    for k in range(L):
        mi = origin - L + k
        prev = s.values[mi - 12 - s.start] if mi - 12 >= s.start else None
        seq[k] = [min(hist[k] / scale, MAX_RATIO), math.sin(2 * math.pi * (mi % 12) / 12), math.cos(2 * math.pi * (mi % 12) / 12), 1.0 if hist[k] == 0 else 0.0,
                  min(prev / scale, MAX_RATIO) if prev is not None else 0.0]
    static = np.zeros(STATIC_DIM, dtype=np.float32)
    static[KINDS.index(s.kind)] = 1.0
    static[3] = min(math.log1p(scale) / 10.0, 2.0)
    static[4] = float(np.count_nonzero(s.values)) / len(s.values)
    static[5] = min(len(s.values) / 60.0, 1.0)
    return seq, static, scale


@dataclass
class Windows:
    seq: np.ndarray
    static: np.ndarray
    unit: np.ndarray
    y: np.ndarray            # [N, H] ratio to the scale
    mask: np.ndarray         # [N, H] 1 where the month exists in the data
    scale: np.ndarray
    origin: np.ndarray
    last_mean: np.ndarray    # yardstick: the mean of the history window as the forecast for every month

    def __len__(self) -> int:
        return len(self.origin)

    def take(self, idx: np.ndarray) -> 'Windows':
        return Windows(self.seq[idx], self.static[idx], self.unit[idx], self.y[idx], self.mask[idx], self.scale[idx], self.origin[idx], self.last_mean[idx])


def build_windows(series: list[Series]) -> Windows:
    seqs, statics, units, ys, masks, scales, origins, lasts = [], [], [], [], [], [], [], []
    for s in series:
        for origin in range(s.start + L, s.end + 1):         # the origin month is the first month to forecast
            seq, static, scale = _window(s, origin)
            y = np.zeros(H, dtype=np.float32)
            m = np.zeros(H, dtype=np.float32)
            for h in range(H):
                i = origin + h - s.start
                if i < len(s.values):
                    y[h] = min(s.values[i] / scale, MAX_RATIO)
                    m[h] = 1.0
            seqs.append(seq)
            statics.append(static)
            units.append(s.unit_index)
            ys.append(y)
            masks.append(m)
            scales.append(scale)
            origins.append(origin)
            lasts.append(float(seq[:, 0].mean()))
    if not origins:
        e = np.zeros((0,), np.float32)
        return Windows(np.zeros((0, L, STEP_DIM), np.float32), np.zeros((0, STATIC_DIM), np.float32), np.zeros(0, np.int64), np.zeros((0, H), np.float32), np.zeros((0, H), np.float32), e, np.zeros(0, np.int64), e)
    return Windows(np.stack(seqs), np.stack(statics), np.array(units, np.int64), np.stack(ys), np.stack(masks), np.array(scales, np.float32), np.array(origins, np.int64), np.array(lasts, np.float32))


class DemandNet(nn.Module):
    def __init__(self, n_units: int, hidden: int = 32) -> None:
        super().__init__()
        self.gru = nn.GRU(STEP_DIM, hidden, batch_first=True)
        self.unit = nn.Embedding(n_units + 1, 6)
        self.head = nn.Sequential(nn.Linear(hidden + STATIC_DIM + 6, 64), nn.ReLU(), nn.Linear(64, H * 3))

    def forward(self, seq, static, unit):
        _, h = self.gru(seq)
        o = self.head(torch.cat([h[-1], static, self.unit(unit)], dim=1)).view(-1, H, 3)
        mid = o[..., 1]
        return torch.stack([mid - nn.functional.softplus(o[..., 0]), mid, mid + nn.functional.softplus(o[..., 2])], dim=2)


def pinball(pred: torch.Tensor, y: torch.Tensor, mask: torch.Tensor) -> torch.Tensor:
    q = torch.tensor(QUANTILES, dtype=pred.dtype).view(1, 1, 3)
    e = y.unsqueeze(2) - pred
    loss = torch.maximum(q * e, (q - 1) * e).mean(dim=2) * mask
    return loss.sum() / mask.sum().clamp(min=1.0)


def _t(w: Windows):
    return torch.from_numpy(w.seq), torch.from_numpy(w.static), torch.from_numpy(w.unit), torch.from_numpy(w.y), torch.from_numpy(w.mask)


def train(tr: Windows, va: Windows | None, n_units: int, seed: int, epochs: int, fixed: int | None = None, batch: int = 256) -> tuple[DemandNet, int]:
    torch.manual_seed(seed)
    rng = np.random.default_rng(seed)
    net = DemandNet(n_units)
    opt = torch.optim.Adam(net.parameters(), lr=3e-3, weight_decay=1e-4)
    x = _t(tr)
    best, state, best_epoch, wait = float('inf'), None, 0, 0
    for epoch in range(1, (fixed or epochs) + 1):
        net.train()
        order = rng.permutation(len(tr))
        for a in range(0, len(tr), batch):
            i = torch.from_numpy(order[a:a + batch])
            opt.zero_grad()
            loss = pinball(net(x[0][i], x[1][i], x[2][i]), x[3][i], x[4][i])
            loss.backward()
            nn.utils.clip_grad_norm_(net.parameters(), 2.0)
            opt.step()
        if va is not None and fixed is None and len(va):
            net.eval()
            with torch.no_grad():
                v = _t(va)
                score = float(pinball(net(v[0], v[1], v[2]), v[3], v[4]))
            if score < best - 1e-5:
                best, best_epoch, wait, state = score, epoch, 0, {k: t.clone() for k, t in net.state_dict().items()}
            else:
                wait += 1
                if wait >= 8:
                    break
    if state is not None:
        net.load_state_dict(state)
    return net, (fixed or best_epoch or epochs)


@torch.no_grad()
def predict(nets: list[DemandNet], w: Windows) -> np.ndarray:
    outs = []
    for n in nets:
        n.eval()
        outs.append(n(torch.from_numpy(w.seq), torch.from_numpy(w.static), torch.from_numpy(w.unit)).numpy())
    return np.clip(np.mean(outs, axis=0), 0.0, None)          # [N, H, 3] ratios


def evaluate(pred: np.ndarray, w: Windows) -> dict:
    """MAE/WAPE/bias in the units of the series, coverage of p10-p90, against the yardstick 'the mean of the last 12 months'."""
    def block(hs: slice) -> dict:
        m = w.mask[:, hs] > 0
        if not m.any():
            return {'n': 0}
        y = (w.y[:, hs] * w.scale[:, None])[m]
        p = {q: (pred[:, hs, i] * w.scale[:, None])[m] for i, q in enumerate(('p10', 'p50', 'p90'))}
        base = (np.repeat(w.last_mean[:, None], w.y[:, hs].shape[1], axis=1) * w.scale[:, None])[m]
        err = p['p50'] - y
        return {'n': int(m.sum()), 'wape': round(float(np.abs(err).sum() / max(np.abs(y).sum(), 1e-9)), 4), 'bias_pct': round(float(err.sum() / max(np.abs(y).sum(), 1e-9) * 100), 2),
                'coverage_p10_p90': round(float(np.mean((y >= p['p10']) & (y <= p['p90']))), 4),
                'persistence_wape': round(float(np.abs(base - y).sum() / max(np.abs(y).sum(), 1e-9)), 4)}
    out = {'all': block(slice(0, H)), 'by_horizon': {'1-3 bulan': block(slice(0, 3)), '4-6 bulan': block(slice(3, 6)), '7-12 bulan': block(slice(6, 12))}}
    a = out['all']
    if a.get('n'):
        a['wape_gain_vs_persistence_pct'] = round((1 - a['wape'] / a['persistence_wape']) * 100, 1) if a['persistence_wape'] > 0 else None
    return out


def run(series_path: str, cutoff: str, seeds: int = 3, epochs: int = 120, threads: int | None = None, log=print) -> dict:
    started = time.time()
    if threads:
        torch.set_num_threads(threads)
    series, info = load(series_path, cutoff)
    eligible = [s for s in series if s.sufficient]
    base = {'cutoff': cutoff, 'coverage': info['coverage'], 'counts': {'series': len(series), 'sufficient_series': len(eligible)}, 'model': {'name': 'GRU-kuantil bulanan (ansambel)', 'version': '1', 'framework': f'torch {torch.__version__}',
            'history_months': L, 'horizon_months': H, 'min_months': MIN_MONTHS, 'min_active_months': MIN_NONZERO, 'quantiles': list(QUANTILES), 'seeds': seeds}}
    windows = build_windows(eligible)
    last = month_index(cutoff)
    tr = np.where(windows.origin < last - 11)[0] if len(windows) else np.zeros(0, int)
    va = np.where((windows.origin >= last - 11) & (windows.origin < last - 5))[0] if len(windows) else np.zeros(0, int)
    te = np.where(windows.origin >= last - 5)[0] if len(windows) else np.zeros(0, int)
    log(f'series={len(series)} sufficient={len(eligible)} windows={len(windows)} train={len(tr)} val={len(va)} test={len(te)}')
    if not eligible or len(tr) < MIN_WINDOWS or len(va) < 10:
        base['status'] = 'INSUFFICIENT'
        base['message'] = (f'Riwayat belum cukup: butuh seri dengan minimal {MIN_MONTHS} bulan riwayat dan {MIN_NONZERO} bulan beraktivitas. Seri memenuhi: {len(eligible)} dari {len(series)}; '
                           f'jendela latih {len(tr)} (butuh {MIN_WINDOWS}). Tarik riwayat yang lebih panjang lalu jalankan ulang.')
        base['results'] = []
        base['seconds'] = round(time.time() - started, 1)
        return base

    units = max(s.unit_index for s in eligible)
    nets, epochs_used = [], []
    for k in range(seeds):
        net, ep = train(windows.take(tr), windows.take(va), units, 300 + k, epochs)
        nets.append(net)
        epochs_used.append(ep)
    test = windows.take(te)
    metrics = evaluate(predict(nets, test), test) if len(te) else {'all': {'n': 0}, 'by_horizon': {}}
    final_epochs = max(5, int(round(float(np.mean(epochs_used)))))
    finals = [train(windows, None, units, 400 + k, final_epochs, fixed=final_epochs)[0] for k in range(seeds)]

    # forecast origin = the month after the cutoff: use a one-step-extended copy of each series (the new month is unknown, the window only needs the L months before it)
    pad = []
    for s in eligible:
        ext = Series(s.sid, s.kind, s.unit, s.item, s.label, s.start, np.concatenate([s.values, [0.0]]), s.unit_index)
        seq, static, scale = _window(ext, last + 1)
        pad.append((s, seq, static, scale))
    fw = Windows(np.stack([p[1] for p in pad]), np.stack([p[2] for p in pad]), np.array([p[0].unit_index for p in pad], np.int64), np.zeros((len(pad), H), np.float32), np.zeros((len(pad), H), np.float32),
                 np.array([p[3] for p in pad], np.float32), np.full(len(pad), last + 1, np.int64), np.zeros(len(pad), np.float32))
    pred = predict(finals, fw)
    results = []
    for k, (s, _, _, scale) in enumerate(pad):
        months = []
        for h in range(H):
            q = pred[k, h] * scale
            months.append({'month': month_label(last + 1 + h), 'p10': round(float(q[0]), 3), 'p50': round(float(q[1]), 3), 'p90': round(float(q[2]), 3)})
        tail = s.values[-12:]
        results.append({'series_id': s.sid, 'kind': s.kind, 'unit_id': s.unit or None, 'item_code': s.item or None, 'item_label': s.label or None, 'history_months': len(s.values),
                        'last_12_months': round(float(tail.sum()), 3), 'months': months,
                        'totals': {str(n): {key: round(sum(m[key] for m in months[:n]), 3) for key in ('p10', 'p50', 'p90')} for n in (3, 6, 12)}})
    base.update({'status': 'SUCCEEDED', 'metrics': metrics, 'results': results, 'seconds': round(time.time() - started, 1)})
    base['model'].update({'epochs_eval': epochs_used, 'epochs_final': final_epochs})
    base['counts'].update({'windows': len(windows), 'train': int(len(tr)), 'validation': int(len(va)), 'test': int(len(te))})
    return base
