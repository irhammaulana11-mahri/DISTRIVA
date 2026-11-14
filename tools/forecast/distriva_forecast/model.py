"""Quantile GRU network shared by all substations."""
from __future__ import annotations

import numpy as np
import torch
from torch import nn

from .data import K, STATIC_DIM, STEP_DIM, Samples

QUANTILES = (0.1, 0.5, 0.9)


class LoadNet(nn.Module):
    def __init__(self, n_units: int, hidden: int = 32, unit_dim: int = 8) -> None:
        super().__init__()
        self.gru = nn.GRU(STEP_DIM, hidden, batch_first=True)
        self.unit = nn.Embedding(n_units + 1, unit_dim)
        self.head = nn.Sequential(nn.Linear(hidden + STATIC_DIM + unit_dim + 1, 64), nn.ReLU(), nn.Linear(64, 64), nn.ReLU(), nn.Linear(64, 3))

    def forward(self, seq: torch.Tensor, static: torch.Tensor, unit: torch.Tensor, gap: torch.Tensor) -> torch.Tensor:
        _, h = self.gru(seq)
        z = torch.cat([h[-1], static, self.unit(unit), (gap / 5.0).unsqueeze(1)], dim=1)
        o = self.head(z)
        mid = o[:, 1]
        lo = mid - nn.functional.softplus(o[:, 0])        # the quantiles can never cross
        hi = mid + nn.functional.softplus(o[:, 2])
        return torch.stack([lo, mid, hi], dim=1)


def pinball(pred: torch.Tensor, y: torch.Tensor) -> torch.Tensor:
    q = torch.tensor(QUANTILES, dtype=pred.dtype).unsqueeze(0)
    e = y.unsqueeze(1) - pred
    return torch.maximum(q * e, (q - 1) * e).mean()


def _tensors(s: Samples) -> tuple[torch.Tensor, ...]:
    return torch.from_numpy(s.seq), torch.from_numpy(s.static), torch.from_numpy(s.unit), torch.from_numpy(s.gap), torch.from_numpy(s.y)


def train(train_s: Samples, val_s: Samples | None, n_units: int, seed: int, epochs: int, fixed_epochs: int | None = None, batch: int = 1024, lr: float = 2e-3) -> tuple[LoadNet, int]:
    """Trains one network. With a validation set it keeps the best epoch (early stopping) and returns it; with `fixed_epochs` it trains exactly that long."""
    torch.manual_seed(seed)
    rng = np.random.default_rng(seed)
    net = LoadNet(n_units)
    opt = torch.optim.Adam(net.parameters(), lr=lr, weight_decay=1e-5)
    x = _tensors(train_s)
    n = len(train_s)
    best, best_state, best_epoch, patience = float('inf'), None, 0, 0
    total = fixed_epochs or epochs
    for epoch in range(1, total + 1):
        net.train()
        order = rng.permutation(n)
        for a in range(0, n, batch):
            idx = torch.from_numpy(order[a:a + batch])
            opt.zero_grad()
            loss = pinball(net(x[0][idx], x[1][idx], x[2][idx], x[3][idx]), x[4][idx])
            loss.backward()
            nn.utils.clip_grad_norm_(net.parameters(), 2.0)
            opt.step()
        if val_s is not None and fixed_epochs is None:
            v = evaluate_loss(net, val_s)
            if v < best - 1e-5:
                best, best_epoch, patience = v, epoch, 0
                best_state = {k: t.clone() for k, t in net.state_dict().items()}
            else:
                patience += 1
                if patience >= 6:
                    break
    if best_state is not None:
        net.load_state_dict(best_state)
    return net, (fixed_epochs or best_epoch or total)


@torch.no_grad()
def evaluate_loss(net: LoadNet, s: Samples) -> float:
    net.eval()
    t = _tensors(s)
    return float(pinball(net(t[0], t[1], t[2], t[3]), t[4]))


@torch.no_grad()
def predict(nets: list[LoadNet], seq: np.ndarray, static: np.ndarray, unit: np.ndarray, gap: np.ndarray) -> np.ndarray:
    """Mean quantiles of the ensemble, shape [N, 3] (ratio of load to capacity, never below 0)."""
    outs = []
    for net in nets:
        net.eval()
        outs.append(net(torch.from_numpy(seq), torch.from_numpy(static), torch.from_numpy(unit), torch.from_numpy(gap)).numpy())
    return np.clip(np.mean(outs, axis=0), 0.0, None)


def predict_samples(nets: list[LoadNet], s: Samples) -> np.ndarray:
    return predict(nets, s.seq, s.static, s.unit, s.gap)


__all__ = ['K', 'LoadNet', 'QUANTILES', 'evaluate_loss', 'pinball', 'predict', 'predict_samples', 'train']
