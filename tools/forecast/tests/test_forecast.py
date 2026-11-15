import csv
import os
import random
import sys
import tempfile
import unittest
from datetime import date, timedelta

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from distriva_forecast import data, pipeline  # noqa: E402


def write_csv(path, header, rows):
    with open(path, 'w', newline='', encoding='utf-8') as fh:
        w = csv.writer(fh)
        w.writerow(header)
        w.writerows(rows)


class DataTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.sub = os.path.join(self.dir, 's.csv')
        self.rd = os.path.join(self.dir, 'r.csv')
        write_csv(self.sub, ['substation_id', 'unit_id', 'capacity_kva', 'transformer_count', 'customers', 'contracted_kva'], [['a', 'u1', '100', '1', '80', '120'], ['b', 'u2', '50', '1', '', '']])

    def test_cleaning_keeps_one_reading_per_day_and_drops_noise(self):
        write_csv(self.rd, ['substation_id', 'measured_on', 'load_kva', 'capacity_kva', 'end_voltage_v'], [
            ['a', '2024-01-01', '50', '100', '220'], ['a', '2024-01-01', '60', '100', ''],      # same day: the last wins
            ['a', '2025-01-01', '900', '100', ''],                                                # 900 % of capacity: noise, dropped
            ['a', '2025-06-01', '70', '100', '215'], ['b', '2024-01-01', '', '50', ''],        # no load: dropped
        ])
        subs, units = data.load(self.rd, self.sub)
        self.assertEqual([(r[0].isoformat(), r[1]) for r in subs['a'].readings], [('2024-01-01', 60.0), ('2025-06-01', 70.0)])
        self.assertEqual(subs['b'].readings, [])
        self.assertEqual(units, ['u1', 'u2'])

    def test_samples_pair_every_later_reading_with_its_history_and_never_look_ahead(self):
        rows = [['a', (date(2022, 1, 1) + timedelta(days=200 * k)).isoformat(), str(40 + 5 * k), '100', ''] for k in range(6)]
        write_csv(self.rd, ['substation_id', 'measured_on', 'load_kva', 'capacity_kva', 'end_voltage_v'], rows)
        subs, _ = data.load(self.rd, self.sub)
        s = data.build_samples(subs)
        self.assertEqual(len(s), 15)                                              # 6 readings: 5+4+3+2+1 pairs
        first = int(np.argmin(s.gap))
        self.assertAlmostEqual(float(s.y[first]), 0.45, places=2)                 # target = the next reading / capacity at the as-of
        self.assertEqual(float(s.seq[0][:-1].sum()), 0.0)                         # the first as-of has one reading of history: the rest is padding
        self.assertEqual(float(s.seq[0][-1][5]), 1.0)                             # mask of the real step

    def test_time_split_follows_the_target_date(self):
        rows = [['a', d, '50', '100', ''] for d in ('2023-01-01', '2024-09-01', '2025-09-01', '2026-03-01')]
        write_csv(self.rd, ['substation_id', 'measured_on', 'load_kva', 'capacity_kva', 'end_voltage_v'], rows)
        subs, _ = data.load(self.rd, self.sub)
        s = data.build_samples(subs)
        tr, va, te = data.split(s)
        self.assertTrue(all(s.target_date[i] < data.TRAIN_END for i in tr))
        self.assertTrue(all(data.TRAIN_END <= s.target_date[i] < data.VAL_END for i in va))
        self.assertTrue(all(s.target_date[i] >= data.VAL_END for i in te))
        self.assertEqual(len(tr) + len(va) + len(te), len(s))


class PipelineHelpersTest(unittest.TestCase):
    def test_crossing_interpolates_and_reports_already_or_none(self):
        asof = date(2026, 1, 1)
        q50 = np.array([0.5, 0.7, 0.9, 1.1] + [1.2] * 6)
        c = pipeline._crossing(asof, q50, 0.4, 1.0)
        self.assertEqual(c['state'], 'forecast')
        self.assertTrue(date(2027, 7, 1) < date.fromisoformat(c['date']) <= date(2028, 1, 2))        # between 1.5 and 2 years
        self.assertEqual(pipeline._crossing(asof, q50, 1.05, 1.0), {'state': 'already', 'date': '2026-01-01'})
        self.assertEqual(pipeline._crossing(asof, np.full(10, 0.3), 0.3, 1.0), {'state': 'none', 'date': None})

    def test_widening_keeps_the_median_and_calibration_reaches_the_target(self):
        rng = np.random.default_rng(0)
        y = rng.normal(0.5, 0.2, 5000)
        pred = np.stack([np.full(5000, 0.4), np.full(5000, 0.5), np.full(5000, 0.6)], axis=1)      # far too narrow
        scale = pipeline.calibrate(pred, y)
        w = pipeline.widen(pred, scale)
        self.assertGreater(scale, 1.5)
        self.assertTrue(np.allclose(w[:, 1], pred[:, 1]))
        self.assertGreaterEqual(float(np.mean((y >= w[:, 0]) & (y <= w[:, 2]))), 0.8)


class PipelineSmokeTest(unittest.TestCase):
    def test_a_tiny_run_returns_ordered_nonnegative_ranges_for_every_substation(self):
        random.seed(1)
        d = tempfile.mkdtemp()
        srows, rrows = [], []
        for n in range(260):
            cap = random.choice([50, 100, 160, 250])
            base = random.uniform(0.2, 0.9)
            srows.append([f's{n}', f'u{n % 3}', cap, 1, random.randint(10, 200), random.randint(20, 300)])
            for k in range(9):
                day = date(2022, 3, 1) + timedelta(days=int(k * 190 + random.randint(-20, 20)))
                ratio = base + 0.03 * k + random.gauss(0, 0.05)
                rrows.append([f's{n}', day.isoformat(), round(max(ratio, 0.05) * cap, 2), cap, ''])
        write_csv(os.path.join(d, 's.csv'), ['substation_id', 'unit_id', 'capacity_kva', 'transformer_count', 'customers', 'contracted_kva'], srows)
        write_csv(os.path.join(d, 'r.csv'), ['substation_id', 'measured_on', 'load_kva', 'capacity_kva', 'end_voltage_v'], rrows)
        out = pipeline.run(os.path.join(d, 'r.csv'), os.path.join(d, 's.csv'), seeds=1, epochs=2, threads=2, log=lambda m: None)

        self.assertEqual(out['counts']['forecast_substations'], 260)
        self.assertEqual(len(out['results']), 260)
        for r in out['results']:
            for h in ('1', '3', '5'):
                q = r['horizons'][h]
                self.assertTrue(0.0 <= q['p10'] <= q['p50'] <= q['p90'])
            self.assertIn(r['exceed_100']['state'], ('already', 'forecast', 'none'))
        self.assertGreater(out['metrics']['all']['n'], 0)
        self.assertIn('persistence_mae_pp', out['metrics']['all'])


class NoReliefTest(unittest.TestCase):
    def test_a_big_drop_or_capacity_change_is_an_intervention_and_cuts_the_targets(self):
        d = date(2024, 1, 1)
        rd = lambda k, load, cap: (d + timedelta(days=200 * k), load, cap, None)  # noqa: E731
        self.assertTrue(data.is_intervention(rd(0, 80, 100), rd(1, 40, 100)))        # pecah beban: 80 % -> 40 %
        self.assertTrue(data.is_intervention(rd(0, 80, 100), rd(1, 85, 160)))        # trafo replaced
        self.assertFalse(data.is_intervention(rd(0, 80, 100), rd(1, 70, 100)))       # a normal dip
        self.assertFalse(data.is_intervention(rd(0, 20, 100), rd(1, 5, 100)))        # low load is never "relief"
        sub = data.Substation('a', 1, 100.0, 1.0, None, None, [rd(0, 60, 100), rd(1, 66, 100), rd(2, 30, 100), rd(3, 33, 100)])
        s = data.build_samples({'a': sub})
        # targets reachable: 0->1 only from reading 0; reading 1 cannot see 2 or 3 (relief in between); reading 2 -> 3
        self.assertEqual(len(s), 2)

    def test_the_forecast_never_falls_below_the_last_reading_nor_turns_down_with_the_horizon(self):
        pred = np.array([[[0.5, 0.6, 0.9], [0.4, 0.5, 0.8], [0.3, 0.7, 1.0]]])         # one gardu, three horizons
        out = pipeline.no_relief(pred, np.array([[0.85]], dtype=np.float32))
        self.assertTrue(np.all(out[0, :, 1] >= 0.85))
        self.assertTrue(np.all(out[0, :, 0] <= out[0, :, 1]) and np.all(out[0, :, 2] >= out[0, :, 1]))


if __name__ == '__main__':
    unittest.main()
