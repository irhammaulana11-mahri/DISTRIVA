import csv
import math
import os
import random
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from distriva_forecast import monthly  # noqa: E402

HEADER = ['series_id', 'kind', 'unit_id', 'item_code', 'item_label', 'month', 'value']


def write_series(path, rows):
    with open(path, 'w', newline='', encoding='utf-8') as fh:
        w = csv.writer(fh)
        w.writerow(HEADER)
        w.writerows(rows)


def months(first_year, first_month, n):
    out = []
    y, m = first_year, first_month
    for _ in range(n):
        out.append(f'{y:04d}-{m:02d}')
        m += 1
        if m == 13:
            y, m = y + 1, 1
    return out


def synthetic(n_months, units=4, items=3, seed=1):
    random.seed(seed)
    rows = []
    for u in range(units):
        for kind in ('CUSTOMERS_ADDED', 'VA_ADDED'):
            base = random.uniform(20, 80)
            for i, mo in enumerate(months(2023, 1, n_months)):
                v = base * (1 + 0.2 * math.sin(2 * math.pi * i / 12)) + 0.5 * i + random.gauss(0, 3)
                rows.append([f'{kind}|u{u}', kind, f'u{u}', '', f'{kind} u{u}', mo, round(max(v, 0), 2)])
        for k in range(items):
            base = random.uniform(5, 40)
            for i, mo in enumerate(months(2023, 1, n_months)):
                v = 0 if random.random() < 0.15 else base * (1 + 0.3 * math.cos(2 * math.pi * i / 12)) + random.gauss(0, 2)
                rows.append([f'MATERIAL_ISSUE|u{u}|m{k}', 'MATERIAL_ISSUE', f'u{u}', f'm{k}', f'Material {k}', mo, round(max(v, 0), 2)])
    return rows


class LoadTest(unittest.TestCase):
    def test_months_after_the_cutoff_are_ignored_and_gaps_become_zero_from_the_first_month_of_the_kind(self):
        d = tempfile.mkdtemp()
        p = os.path.join(d, 's.csv')
        write_series(p, [['a', 'CUSTOMERS_ADDED', 'u1', '', 'A', '2024-01', 5], ['a', 'CUSTOMERS_ADDED', 'u1', '', 'A', '2024-04', 7], ['a', 'CUSTOMERS_ADDED', 'u1', '', 'A', '2024-09', 99],
                         ['b', 'CUSTOMERS_ADDED', 'u2', '', 'B', '2023-11', 3]])
        series, info = monthly.load(p, '2024-05')
        a = next(s for s in series if s.sid == 'a')
        self.assertEqual(len(a.values), 7)                                        # from the kind's first month (2023-11) to the cutoff (2024-05)
        self.assertEqual([float(a.values[i]) for i in (0, 1, 2, 3, 5, 6)], [0.0, 0.0, 5.0, 0.0, 7.0, 0.0])
        self.assertEqual(a.values.sum(), 12.0)                                    # 2024-09 is after the cutoff
        self.assertEqual(info['coverage']['CUSTOMERS_ADDED']['months'], 7)
        self.assertEqual(info['coverage']['MATERIAL_ISSUE']['months'], 0)

    def test_a_series_needs_enough_months_and_enough_activity(self):
        d = tempfile.mkdtemp()
        p = os.path.join(d, 's.csv')
        rows = [['long', 'VA_ADDED', 'u', '', 'x', m, 10] for m in months(2022, 1, 30)] + [['sparse', 'VA_ADDED', 'u', '', 'y', m, 1 if i == 3 else 0] for i, m in enumerate(months(2022, 1, 30))]
        write_series(p, rows)
        series, _ = monthly.load(p, '2024-06')
        by = {s.sid: s for s in series}
        self.assertTrue(by['long'].sufficient)
        self.assertFalse(by['sparse'].sufficient)                                 # one active month only


class RunTest(unittest.TestCase):
    def test_too_little_history_is_reported_not_forecast(self):
        d = tempfile.mkdtemp()
        p = os.path.join(d, 's.csv')
        write_series(p, synthetic(8))
        out = monthly.run(p, '2023-08', seeds=1, epochs=2, threads=2, log=lambda m: None)
        self.assertEqual(out['status'], 'INSUFFICIENT')
        self.assertEqual(out['results'], [])
        self.assertIn('Riwayat belum cukup', out['message'])
        self.assertEqual(out['counts']['sufficient_series'], 0)
        self.assertEqual(out['coverage']['VA_ADDED']['months'], 8)

    def test_enough_history_gives_ordered_nonnegative_ranges_for_every_sufficient_series(self):
        d = tempfile.mkdtemp()
        p = os.path.join(d, 's.csv')
        write_series(p, synthetic(40))
        out = monthly.run(p, '2026-04', seeds=1, epochs=3, threads=2, log=lambda m: None)
        self.assertEqual(out['status'], 'SUCCEEDED')
        self.assertEqual(len(out['results']), 4 * 5)
        for r in out['results']:
            self.assertEqual(len(r['months']), 12)
            self.assertEqual(r['months'][0]['month'], '2026-05')
            for m in r['months']:
                self.assertTrue(0 <= m['p10'] <= m['p50'] <= m['p90'])
            self.assertAlmostEqual(r['totals']['3']['p50'], sum(m['p50'] for m in r['months'][:3]), places=2)
        self.assertGreater(out['metrics']['all']['n'], 0)
        self.assertIn('persistence_wape', out['metrics']['all'])


if __name__ == '__main__':
    unittest.main()
