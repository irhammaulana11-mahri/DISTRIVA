"""Gradient-boosted trees (LightGBM) for the substation load: one model per quantile on the same samples as the GRU."""
from __future__ import annotations

import numpy as np
import lightgbm as lgb

from .data import Samples

ALPHAS = (0.1, 0.5, 0.9)


def table(seq: np.ndarray, static: np.ndarray, unit: np.ndarray, gap: np.ndarray) -> np.ndarray:
    """One row per sample: the K readings of history, the static numbers, the unit and the horizon in years."""
    return np.hstack([seq.reshape(len(seq), -1), static, unit.reshape(-1, 1).astype(np.float32), gap.reshape(-1, 1)]).astype(np.float32)


def samples_table(s: Samples) -> np.ndarray:
    return table(s.seq, s.static, s.unit, s.gap)


def train(train_s: Samples, val_s: Samples | None, seed: int = 0, rounds: int = 600) -> list[lgb.Booster]:
    """One booster per quantile; early stopping on the validation samples when given."""
    x = samples_table(train_s)
    boosters = []
    for a in ALPHAS:
        params = {'objective': 'quantile', 'alpha': a, 'learning_rate': 0.05, 'num_leaves': 31, 'min_data_in_leaf': 100, 'feature_fraction': 0.8, 'bagging_fraction': 0.8, 'bagging_freq': 1,
                  'lambda_l2': 1.0, 'seed': seed, 'verbose': -1, 'num_threads': 4}
        dtrain = lgb.Dataset(x, train_s.y)
        valid = [lgb.Dataset(samples_table(val_s), val_s.y)] if val_s is not None and len(val_s) else None
        cb = [lgb.early_stopping(30, verbose=False)] if valid else []
        boosters.append(lgb.train(params, dtrain, num_boost_round=rounds, valid_sets=valid, callbacks=cb))
    return boosters


def predict(boosters: list[lgb.Booster], seq: np.ndarray, static: np.ndarray, unit: np.ndarray, gap: np.ndarray) -> np.ndarray:
    """Quantiles [N, 3] ordered p10 <= p50 <= p90, never below 0."""
    x = table(seq, static, unit, gap)
    out = np.stack([b.predict(x, num_iteration=b.best_iteration or None) for b in boosters], axis=1)
    out = np.sort(out, axis=1)
    return np.clip(out, 0.0, None).astype(np.float32)


def best_rounds(boosters: list[lgb.Booster]) -> int:
    return int(np.mean([b.best_iteration or b.current_iteration() for b in boosters]))
