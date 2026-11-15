"""Train, evaluate on the test period, refit on everything, forecast the latest reading of every substation."""
from __future__ import annotations

import json
import time
from datetime import date, timedelta

import numpy as np
import torch

from . import data, gbm, metrics, model

GRID = [0.5 * k for k in range(1, 11)]            # 0.5 .. 5 years ahead
SHOWN = (1.0, 3.0, 5.0)
STALE_YEARS = 3.0


def _crossing(asof: date, q50: np.ndarray, last_ratio: float, threshold: float) -> dict:
    """First moment the median forecast reaches `threshold` (linear between grid points). `already` when the last reading is already above."""
    if last_ratio >= threshold:
        return {'state': 'already', 'date': asof.isoformat()}
    prev_h, prev_v = 0.0, last_ratio
    for h, v in zip(GRID, q50):
        if v >= threshold:
            frac = (threshold - prev_v) / max(v - prev_v, 1e-9)
            when = asof + timedelta(days=int(round((prev_h + frac * (h - prev_h)) * data.YEAR)))
            return {'state': 'forecast', 'date': when.isoformat()}
        prev_h, prev_v = h, v
    return {'state': 'none', 'date': None}


def widen(pred: np.ndarray, scale: float) -> np.ndarray:
    """Stretches the p10/p90 distances around the median by `scale` (the median itself does not move)."""
    out = pred.copy()
    out[..., 0] = np.clip(pred[..., 1] - scale * (pred[..., 1] - pred[..., 0]), 0.0, None)
    out[..., 2] = pred[..., 1] + scale * (pred[..., 2] - pred[..., 1])
    return out


def no_relief(pred: np.ndarray, last_ratio: np.ndarray) -> np.ndarray:
    """Scenario without intervention: the median never falls below the last reading, and the ranges stay around it."""
    out = pred.copy()
    out[..., 1] = np.maximum(pred[..., 1], last_ratio)
    out[..., 0] = np.minimum(pred[..., 0], out[..., 1])
    out[..., 2] = np.maximum(pred[..., 2], out[..., 1])
    return out


def calibrate(pred: np.ndarray, y: np.ndarray, target: float = 0.80) -> float:
    """Smallest scale (1.0 .. 3.0) with which the p10-p90 range covers `target` of the validation outcomes."""
    for k in range(0, 41):
        scale = 1.0 + 0.05 * k
        w = widen(pred, scale)
        if float(np.mean((y >= w[:, 0]) & (y <= w[:, 2]))) >= target:
            return scale
    return 3.0


def run(readings: str, substations: str, seeds: int = 3, epochs: int = 40, threads: int | None = None, log=print) -> dict:
    started = time.time()
    if threads:
        torch.set_num_threads(threads)
    subs, units = data.load(readings, substations)
    samples = data.build_samples(subs)
    tr, va, te = data.split(samples)
    log(f'gardu={len(subs)} samples={len(samples)} train={len(tr)} val={len(va)} test={len(te)}')
    if len(tr) < 500 or len(va) < 100:
        raise ValueError(f'Data pembacaan terlalu sedikit untuk melatih model (latih {len(tr)}, validasi {len(va)}).')

    # 1. honest evaluation of the candidates: train on the early period, stop on validation, pick on the validation outcomes, score the later test period
    eval_nets, best_epochs = [], []
    for k in range(seeds):
        net, ep = model.train(samples.take(tr), samples.take(va), len(units), seed=100 + k, epochs=epochs)
        eval_nets.append(net)
        best_epochs.append(ep)
        log(f'eval seed {k}: best epoch {ep}')
    val, test = samples.take(va), samples.take(te)
    eval_trees = gbm.train(samples.take(tr), val, seed=1)
    log(f'trees: {gbm.best_rounds(eval_trees)} rounds')
    gru_fn = lambda s: model.predict_samples(eval_nets, s)                                                      # noqa: E731
    gbm_fn = lambda s: gbm.predict(eval_trees, s.seq, s.static, s.unit, s.gap)                                  # noqa: E731
    candidates = {'gru': gru_fn, 'gbm': gbm_fn, 'ensemble': lambda s: (gru_fn(s) + gbm_fn(s)) / 2.0}
    scales, scored, shown = {}, {}, {}
    for name, fn in candidates.items():
        pv = fn(val)
        scales[name] = calibrate(pv, val.y)                                                                     # the ranges are widened until they cover 80 % of the validation outcomes
        adj = lambda s_, p_: no_relief(widen(p_, scales[name]), s_.last_ratio)                                  # noqa: E731
        scored[name] = float(np.mean(np.abs(adj(val, pv)[:, 1] - val.y)))
        shown[name] = {'val_mae_pp': round(scored[name] * 100, 2), 'range_scale': round(scales[name], 2)}
        if len(te):
            pt = adj(test, fn(test))
            shown[name]['test_mae_pp'] = round(float(np.mean(np.abs(pt[:, 1] - test.y)) * 100), 2)
            shown[name]['test_coverage_p10_p90'] = round(float(np.mean((test.y >= pt[:, 0]) & (test.y <= pt[:, 2]))), 4)
    chosen = min(scored, key=scored.get)
    scale = scales[chosen]
    log(f'candidates {shown} -> {chosen}')
    report = metrics.report(no_relief(widen(candidates[chosen](test), scale), test.last_ratio), test.y, test.last_ratio, test.gap) if len(te) else {'all': {'n': 0}, 'by_horizon': {}}
    final_epochs = max(3, int(round(float(np.mean(best_epochs)))))

    # 2. production models: the chosen recipe on all the data, for as many epochs / rounds as the evaluation needed
    final_nets = [model.train(samples, None, len(units), seed=200 + k, epochs=final_epochs, fixed_epochs=final_epochs)[0] for k in range(seeds)] if chosen in ('gru', 'ensemble') else []
    final_trees = gbm.train(samples, None, seed=2, rounds=gbm.best_rounds(eval_trees)) if chosen in ('gbm', 'ensemble') else []

    # 3. forecast every substation from its latest reading
    ids, seqs, statics, unit_idx, asofs, caps, lasts, counts = [], [], [], [], [], [], [], []
    for s in subs.values():
        if not s.readings:
            continue
        seq, static, cap, asof, last_ratio = data.features(s, len(s.readings) - 1)
        ids.append(s.sid)
        seqs.append(seq)
        statics.append(static)
        unit_idx.append(s.unit_index)
        asofs.append(asof)
        caps.append(cap)
        lasts.append(last_ratio)
        counts.append(min(len(s.readings), data.K))
    n = len(ids)
    grid = np.array(GRID, dtype=np.float32)
    rep = lambda a, dt: np.repeat(np.stack(a) if isinstance(a[0], np.ndarray) else np.array(a, dtype=dt), len(grid), axis=0)      # noqa: E731
    args = (rep(seqs, np.float32), rep(statics, np.float32), rep(unit_idx, np.int64), np.tile(grid, n))
    parts = ([model.predict(final_nets, *args)] if final_nets else []) + ([gbm.predict(final_trees, *args)] if final_trees else [])
    pred = widen(np.mean(parts, axis=0).reshape(n, len(grid), 3), scale)
    pred = no_relief(pred, np.array(lasts, dtype=np.float32).reshape(n, 1))
    pred[:, :, 1] = np.maximum.accumulate(pred[:, :, 1], axis=1)               # without intervention the median does not turn back down with the horizon
    pred[:, :, 0] = np.minimum(pred[:, :, 0], pred[:, :, 1])
    pred[:, :, 2] = np.maximum(pred[:, :, 2], pred[:, :, 1])
    results = []
    for k in range(n):
        asof = asofs[k]
        item = {'substation_id': ids[k], 'capacity_kva': round(float(caps[k]), 3), 'last_reading_on': asof.isoformat(), 'last_ratio': round(float(lasts[k]), 4), 'history_readings': counts[k],
                'stale': (date.today() - asof).days / data.YEAR > STALE_YEARS, 'horizons': {}}
        for h in SHOWN:
            g = GRID.index(h)
            item['horizons'][str(int(h))] = {'p10': round(float(pred[k, g, 0]), 4), 'p50': round(float(pred[k, g, 1]), 4), 'p90': round(float(pred[k, g, 2]), 4)}
        item['exceed_80'] = _crossing(asof, pred[k, :, 1], float(lasts[k]), 0.8)
        item['exceed_100'] = _crossing(asof, pred[k, :, 1], float(lasts[k]), 1.0)
        results.append(item)

    return {
        'model': {'name': {'gru': 'GRU-kuantil (ansambel)', 'gbm': 'Pohon gradient boosting (LightGBM)', 'ensemble': 'Gabungan GRU-kuantil dan LightGBM'}[chosen], 'chosen': chosen, 'candidates': shown, 'version': '2', 'framework': f'torch {torch.__version__}, lightgbm {gbm.lgb.__version__}', 'seeds': seeds, 'epochs_eval': best_epochs, 'epochs_final': final_epochs,
                  'target': 'beban kVA dibagi kapasitas trafo pada pembacaan terakhir', 'scenario': 'tanpa sisipan atau pecah beban (beban tidak turun)', 'quantiles': list(model.QUANTILES), 'history_readings': data.K, 'range_scale': round(scale, 2)},
        'window': {'first_reading': min(r[0] for s in subs.values() for r in s.readings).isoformat(), 'last_reading': max(r[0] for s in subs.values() for r in s.readings).isoformat(),
                   'train_targets_before': data.TRAIN_END.isoformat(), 'validation_until': data.VAL_END.isoformat()},
        'counts': {'substations': len(subs), 'forecast_substations': n, 'samples': len(samples), 'train': int(len(tr)), 'validation': int(len(va)), 'test': int(len(te))},
        'metrics': report,
        'results': results,
        'seconds': round(time.time() - started, 1),
    }


def write(result: dict, path: str) -> None:
    with open(path, 'w', encoding='utf-8') as fh:
        json.dump(result, fh, ensure_ascii=False)
