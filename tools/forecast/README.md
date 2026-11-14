# Forecast DISTRIVA (deep learning)

Forecast service of docs/11 (decision D-005: Python). **Deep learning only** (owner, Nov 2026): the models are PyTorch networks; nothing else forecasts.

## Beban gardu (`run_gardu_load.py`)
One neural network shared by all substations (the per-substation history is only ~10 readings): a GRU over the last readings plus static features (capacity, customers and
contracted power, ULP embedding) and the forecast horizon, trained with a **quantile (pinball) loss** so every forecast is a range (p10 / p50 / p90). The target is the
load in kVA divided by the transformer capacity at the time of the last reading (robust to a transformer being replaced).

Laravel (`php artisan distriva:forecast-run`) exports the data to CSV, calls this script, and imports `result.json`. The script never touches the database and holds no secret.

```
.venv/bin/python run_gardu_load.py --readings readings.csv --substations substations.csv --out result.json [--seeds 3] [--epochs 40] [--fast]
```

Evaluation is time-based (train: targets before 2024-07-01, validation: until 2025-06-30, test: after), reported as MAE (percentage points of capacity), WAPE, bias, coverage of the
p10-p90 range and overload recall. "Persistence" (the last reading carried forward) is shown **only as a yardstick** for the network, never as a forecast.

Tests: `.venv/bin/python -m unittest discover -s tests`.
