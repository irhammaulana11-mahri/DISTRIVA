<?php

namespace App\Services\Analytics;

use PhpOffice\PhpSpreadsheet\Cell\Coordinate;
use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Writer\Xlsx;

/**
 * Unduhan Excel satu metrik pengusahaan (docs/91): lembar yang sama dengan layar, dari respons analisa yang sama (angka identik dengan yang tampil), ditambah prakiraan bila tersedia.
 */
class BusinessMetricWorkbook
{
    /**
     * @param  array<string, mixed>  $d  hasil BusinessTrendBuilder::build() beserta kunci `unit`
     * @param  array<string, mixed>|null  $forecast  hasil BusinessForecastService::forecast()
     */
    public function write(array $d, ?array $forecast, string $path): void
    {
        $ss = new Spreadsheet;
        $sheet = $ss->getActiveSheet();
        $sheet->setTitle('Ringkasan');
        $rows = [['Metrik', $d['metric']['name']], ['Sumber', $d['metric']['source']], ['Unit', $d['unit']['name'].' ('.$d['unit']['unit_type'].')'], ['Rentang', $d['from'].' s.d. '.$d['to']], ['ULP digabung', $d['units_expected']], [], ['Seri', 'Satuan', 'Terakhir', 'Bulan lalu', 'MoM %', 'Bulan sama tahun lalu', 'YoY %', 'Kumulatif tahun berjalan', 'Kumulatif tahun lalu', 'Kumulatif %']];
        foreach ($d['summary'] as $i => $s) {
            $rows[] = [$d['series'][$i]['name'], $d['series'][$i]['unit'], $s['latest'], $s['previous_month'], $s['mom_pct'], $s['same_month_last_year'], $s['yoy_pct'], $s['ytd'], $s['ytd_previous_year'], $s['ytd_pct']];
        }
        $this->put($sheet, $rows, 6);

        $ws = $ss->createSheet();
        $ws->setTitle('Seri');
        $head = ['Bulan', 'ULP melapor'];
        foreach ($d['series'] as $s) {
            $head[] = $s['name'].' ('.$s['unit'].')';
            $head[] = $s['name'].' tahun lalu';
        }
        $rows = [$head];
        foreach ($d['months'] as $i => $m) {
            $row = [$m, ($d['units_reporting'][$i] ?? '').'/'.$d['units_expected']];
            foreach ($d['series'] as $s) {
                $row[] = $s['values'][$i];
                $row[] = $s['previous_year'][$i];
            }
            $rows[] = $row;
        }
        $this->put($ws, $rows, 0);

        $ws = $ss->createSheet();
        $ws->setTitle('Rincian');
        $rows = [];
        foreach (['breakdown' => 'Rincian', 'breakdown_secondary' => 'Rincian kedua'] as $key => $title) {
            if ($d[$key] === null) {
                continue;
            }
            $rows[] = [$title.': '.$d[$key]['dimension'].' ('.$d[$key]['period'].')'];
            $rows[] = ['', 'Nilai', 'Porsi %', 'Bulan sama tahun lalu', 'YoY %'];
            foreach ($d[$key]['rows'] as $r) {
                $rows[] = [$r['key'], $r['value'], $r['share_pct'], $r['same_month_last_year'], $r['yoy_pct']];
            }
            $rows[] = [];
        }
        if ($d['matrix'] !== null) {
            $rows[] = ['Matriks: '.$d['matrix']['rows_dimension'].' x '.$d['matrix']['columns_dimension']];
            $rows[] = array_merge([''], $d['matrix']['columns']);
            foreach ($d['matrix']['rows'] as $i => $r) {
                $rows[] = array_merge([$r], $d['matrix']['values'][$i]);
            }
        }
        $rows === [] && $rows[] = ['Metrik ini tidak punya rincian.'];
        $this->put($ws, $rows, 0);

        if ($d['comparison'] !== []) {
            $ws = $ss->createSheet();
            $ws->setTitle('Perbandingan ULP');
            $rows = [['ULP', 'Terakhir', 'YoY %', 'Kumulatif']];
            foreach ($d['comparison'] as $c) {
                $rows[] = [$c['unit_name'], $c['latest'], $c['yoy_pct'], $c['ytd']];
            }
            $this->put($ws, $rows, 0);
        }

        foreach ($d['reconciliations'] ?? [] as $rec) {
            $ws = $ss->createSheet();
            $ws->setTitle(substr('Rekonsiliasi '.$rec['key'], 0, 31));
            $rows = [[$rec['official_name'].' lawan '.$rec['companion_name'].' ('.$rec['unit'].')'], [$rec['note']], [], ['Bulan', 'Resmi', 'Pendamping', 'Selisih (pendamping - resmi)', 'ULP dibandingkan']];
            foreach ($rec['monthly'] as $m) {
                $rows[] = [$m['month'], $m['official_net'], $m['companion'], $m['difference'], $m['units_compared']];
            }
            if ($rec['ytd'] !== null) {
                $y = $rec['ytd'];
                $rows[] = [];
                $rows[] = ['Kumulatif '.$y['base_month'].' s.d. '.$y['to_month'], $y['official_net'], $y['companion'], $y['difference'], $y['units_compared'].'/'.$y['units_expected']];
                isset($y['previous_year']) && $rows[] = ['Kumulatif tahun lalu '.$y['previous_year']['base_month'].' s.d. '.$y['previous_year']['to_month'], $y['previous_year']['official_net'], $y['previous_year']['companion'], $y['previous_year']['difference'], $y['previous_year']['units_compared']];
            }
            $this->put($ws, $rows, 3);
        }

        if ($d['companions'] !== null) {
            $ws = $ss->createSheet();
            $ws->setTitle('Pendamping');
            $head = ['Bulan'];
            foreach ($d['companions']['series'] as $s) {
                $head[] = $s['name'].' ('.$s['unit'].')';
            }
            $rows = [[$d['companions']['source']], $head];
            foreach ($d['months'] as $i => $m) {
                $rows[] = array_merge([$m], array_map(fn ($s) => $s['values'][$i], $d['companions']['series']));
            }
            $this->put($ws, $rows, 1);
        }

        if ($forecast !== null && $forecast['status'] === 'OK') {
            $ws = $ss->createSheet();
            $ws->setTitle('Prakiraan');
            $rows = [['Prakiraan 12 bulan (model musiman, rentang p10-p90 dari uji mundur)']];
            foreach ($forecast['series'] as $s) {
                $rows[] = [];
                $rows[] = [$s['name'].' ('.$s['unit'].')'];
                if ($s['status'] !== 'OK') {
                    $rows[] = [$s['message']];

                    continue;
                }
                $rows[] = ['Bulan', 'p10', 'p50', 'p90'];
                foreach ($s['forecast'] as $f) {
                    $rows[] = [$f['month'], $f['p10'], $f['p50'], $f['p90']];
                }
                foreach ($s['insights'] as $i) {
                    $rows[] = [strtoupper($i['level']).': '.$i['text']];
                }
            }
            $this->put($ws, $rows, 0);
        }

        $ws = $ss->createSheet();
        $ws->setTitle('Catatan');
        $rows = [['Tingkat', 'Catatan']];
        foreach ($d['insights'] as $i) {
            $rows[] = [$i['level'], $i['text']];
        }
        $rows[] = [];
        $rows[] = ['Kelengkapan', 'Bulan laporan belum masuk per ULP'];
        foreach ($d['coverage']['missing'] as $m) {
            $rows[] = [$m['unit_name'] ?? $m['unit_id'], implode(', ', $m['months'])];
        }
        $this->put($ws, $rows, 0);
        $ss->setActiveSheetIndex(0);
        (new Xlsx($ss))->save($path);
    }

    /**
     * Menulis baris-baris ke lembar; nilai teks sebagai teks, angka sebagai angka (tanpa pemformatan spreadsheet yang mengubah isi), judul kolom ditebalkan.
     *
     * @param  list<list<mixed>>  $rows
     */
    private function put($ws, array $rows, int $headerRow): void
    {
        foreach ($rows as $r => $row) {
            foreach (array_values($row) as $c => $v) {
                if ($v === null || $v === '') {
                    continue;
                }
                $cell = $ws->getCell([$c + 1, $r + 1]);
                is_int($v) || is_float($v) ? $cell->setValue($v) : $cell->setValueExplicit((string) $v, 's');
            }
        }
        if ($rows !== [] && isset($rows[$headerRow])) {
            $last = $ws->getHighestColumn();
            $ws->getStyle('A'.($headerRow + 1).':'.$last.($headerRow + 1))->getFont()->setBold(true);
        }
        for ($c = 1, $max = Coordinate::columnIndexFromString($ws->getHighestColumn()); $c <= $max; $c++) {
            $ws->getColumnDimensionByColumn($c)->setAutoSize(true);
        }
    }
}
