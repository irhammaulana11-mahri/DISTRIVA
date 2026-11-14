"""Evaluation of the substation-load forecasts on the time-based test set (docs/11 section 6)."""
from __future__ import annotations

import numpy as np

BUCKETS = (('0.1-1 tahun', 0.1, 1.0), ('1-3 tahun', 1.0, 3.0), ('3-6 tahun', 3.0, 6.1))


def _block(pred: np.ndarray, y: np.ndarray, last: np.ndarray) -> dict:
    if len(y) == 0:
        return {'n': 0}
    p10, p50, p90 = pred[:, 0], pred[:, 1], pred[:, 2]
    err = p50 - y
    overload = y >= 1.0
    flagged_p50 = p50 >= 1.0
    flagged_p90 = p90 >= 1.0
    tp50 = int(np.sum(overload & flagged_p50))
    out = {
        'n': int(len(y)),
        'mae_pp': round(float(np.mean(np.abs(err)) * 100), 2),                     # percentage points of capacity
        'wape': round(float(np.sum(np.abs(err)) / max(np.sum(np.abs(y)), 1e-9)), 4),
        'bias_pp': round(float(np.mean(err) * 100), 2),                            # > 0 = over-forecast
        'coverage_p10_p90': round(float(np.mean((y >= p10) & (y <= p90))), 4),     # about 0.80 when the ranges are honest
        'overload_actual': int(np.sum(overload)),
        'overload_recall_p50': round(tp50 / max(int(np.sum(overload)), 1), 4),
        'overload_precision_p50': round(tp50 / max(int(np.sum(flagged_p50)), 1), 4),
        'overload_recall_p90': round(int(np.sum(overload & flagged_p90)) / max(int(np.sum(overload)), 1), 4),
        # yardstick only: the last reading carried forward (never offered as a forecast)
        'persistence_mae_pp': round(float(np.mean(np.abs(last - y)) * 100), 2),
        'persistence_wape': round(float(np.sum(np.abs(last - y)) / max(np.sum(np.abs(y)), 1e-9)), 4),
    }
    out['mae_gain_vs_persistence_pct'] = round((1 - out['mae_pp'] / out['persistence_mae_pp']) * 100, 1) if out['persistence_mae_pp'] > 0 else None
    return out


def report(pred: np.ndarray, y: np.ndarray, last: np.ndarray, gap: np.ndarray) -> dict:
    result = {'all': _block(pred, y, last), 'by_horizon': {}}
    for label, lo, hi in BUCKETS:
        m = (gap >= lo) & (gap < hi)
        result['by_horizon'][label] = _block(pred[m], y[m], last[m])
    return result
