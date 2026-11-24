<?php

namespace App\Services\EisReports;

use PhpOffice\PhpSpreadsheet\Cell\Coordinate;
use PhpOffice\PhpSpreadsheet\IOFactory;

/**
 * Pembaca laporan bulanan EIS/AP2T (docs/88). Murni berkas: tidak menyentuh database. Jenis, unit (kode), dan bulan dibaca dari nama berkas `JENIS-KODEUNIT-BBTTTT.xls(x)` dan
 * dicocokkan dengan isi berkas (bulan, nama ULP/UP3); berkas dengan nama lain dikenali dari isinya (lihat parse()). Hasilnya baris bernama per jenis laporan; tata letak per tahun bisa berbeda (mis. baris tarif laporan 309), jadi baris disimpan
 * lengkap dengan nomor baris aslinya dan label, bukan dipetakan ke angka di sini.
 */
final class EisReportParser
{
    public const FAMILIES = ['309', '309EIS', 'AKHIEPERIODE_EIS', 'AKHIRBULAN_EIS', 'DIFI', 'GGNALL', 'GGNBERULANG', 'GGNNEGATIF', 'GGNPERJENIS', 'KLHALL', 'KLHBERULANG', 'KLHNEGATIF', 'PIUTANGLPB_EIS', 'TAGSUS', 'UMURPIUTANG'];

    private const MONTHS = ['januari' => 1, 'pebruari' => 2, 'februari' => 2, 'maret' => 3, 'april' => 4, 'mei' => 5, 'juni' => 6, 'juli' => 7, 'agustus' => 8, 'september' => 9, 'oktober' => 10, 'nopember' => 11, 'november' => 11, 'desember' => 12];

    /** @var list<list<mixed>> */
    private array $rows = [];

    /**
     * Jenis, unit, dan bulan diambil dari nama berkas bila berpola `JENIS-KODEUNIT-BBTTTT`; selain itu dari isi berkas (nama unduhan EIS apa adanya, mis. "Rekap (3).xls").
     * Yang tidak tertulis di isi (bulan pada 309EIS dan PIUTANGLPB_EIS, unit pada UMURPIUTANG) diambil dari $hints pilihan pengunggah; tanpa itu berkas ditolak.
     * `unit_source`: `nama` (kode dari nama berkas), `isi` (kode dari isi), `pilihan` (dari $hints), atau null (unit dibaca dari nama ULP/UP3 di isi).
     *
     * @param  array{unit_code?: ?string, period?: ?string}  $hints  period = YYYY-MM
     * @return array{family:string,file_unit_code:?string,unit_source:?string,content_units:array{ULP:?string,UP3:?string},period:string,summary:?array<string,float|null>,lines:list<array{line_no:int,group_label:?string,label:?string,code:?string,values:array<string,mixed>}>,warnings:list<string>}
     */
    public function parse(string $path, string $originalName, array $hints = []): array
    {
        $named = preg_match('/^([A-Za-z0-9_]+)-([A-Za-z0-9]{5})-(\d{2})(\d{4})\.xlsx?$/i', $originalName, $m) === 1;
        if ($named) {
            $family = strtoupper($m[1]);
            if (! in_array($family, self::FAMILIES, true)) {
                throw new EisReportException("Jenis laporan {$family} belum dikenal.");
            }
            $month = (int) $m[3];
            $year = (int) $m[4];
            if ($month < 1 || $month > 12 || $year < 2000 || $year > 2100) {
                throw new EisReportException('Bulan atau tahun pada nama berkas tidak valid.');
            }
        }
        try {
            $reader = IOFactory::createReaderForFile($path);
            $reader->setReadDataOnly(true);
            $this->rows = $reader->load($path)->getSheet(0)->toArray(null, true, false, false);
        } catch (\Throwable) {
            throw new EisReportException('Berkas tidak dapat dibaca sebagai lembar kerja Excel.');
        }
        $found = $this->contentPeriod();
        if ($named) {
            $period = sprintf('%04d-%02d-01', $year, $month);
            if ($found !== null && $found !== $period) {
                throw new EisReportException('Bulan di dalam berkas ('.substr($found, 0, 7).') berbeda dengan nama berkas ('.substr($period, 0, 7).').');
            }
            $unitCode = strtoupper($m[2]);
            $unitSource = 'nama';
        } else {
            $family = $this->detectFamily() ?? throw new EisReportException('Jenis laporan tidak dikenali dari isi berkas. Pastikan berkas adalah unduhan laporan EIS yang didukung, atau beri nama berpola JENIS-KODEUNIT-BBTTTT.');
            $hintPeriod = isset($hints['period']) && preg_match('/^(20\d{2})-(0[1-9]|1[0-2])$/', (string) $hints['period']) ? $hints['period'].'-01' : null;
            $period = $found ?? $hintPeriod ?? throw new EisReportException("Bulan laporan {$family} tidak tertulis di dalam berkas; pilih bulan pada form unggah atau beri nama berkas berpola JENIS-KODEUNIT-BBTTTT.");
            $unitCode = $this->contentUnitCode();
            $unitSource = $unitCode !== null ? 'isi' : null;
        }
        $contentUnits = $this->contentUnits($unitSource === null);
        // Pilihan unit hanya mengisi berkas yang sama sekali tidak menyebut unit, supaya satu pilihan tidak salah menempel pada berkas ULP lain dalam unggahan yang sama.
        if ($unitSource === null && $contentUnits['ULP'] === null && $contentUnits['UP3'] === null && ! empty($hints['unit_code'])) {
            $unitCode = strtoupper((string) $hints['unit_code']);
            $unitSource = 'pilihan';
        }
        if ($unitSource === null && $contentUnits['ULP'] === null && $contentUnits['UP3'] === null) {
            throw new EisReportException("Unit laporan {$family} tidak tertulis di dalam berkas; pilih unit pada form unggah atau beri nama berkas berpola JENIS-KODEUNIT-BBTTTT.");
        }

        $warnings = [];
        [$lines, $summary] = match ($family) {
            '309' => [$this->report309(), null],
            '309EIS' => [$this->flat(['unit', 'nomor', 'kode', 'keterangan', 'sumber_laporan', 'pembukuan'], [], 'keterangan', 'kode', 'UNIT'), null],
            'PIUTANGLPB_EIS' => [$this->flat(['unitup', 'golongan', 'skema_bayar', 'ket_piutang'], ['unitup', 'golongan', 'skema_bayar'], 'ket_piutang', 'skema_bayar', 'UNITUP'), null],
            'AKHIRBULAN_EIS' => [$this->flat(['thbllap', 'unitup', 'jenis_laporan', 'label'], [], 'label', 'jenis_laporan', 'THBLLAP'), null],
            'AKHIEPERIODE_EIS' => [$this->flat(['namaupi', 'namaap', 'namaup', 'kogol'], [], 'kogol', null, 'NAMAUPI'), null],
            'DIFI' => $this->difi(),
            'GGNALL' => [$this->ggnAll(), null],
            'KLHALL' => [$this->klhAll(), null],
            'GGNPERJENIS' => [$this->isV1Layout() ? $this->perJenisV1() : $this->perJenis(), null],
            'GGNBERULANG', 'GGNNEGATIF' => [$this->fixedByLetter('GGN'), null],
            'KLHBERULANG', 'KLHNEGATIF' => [$this->fixedByLetter('KLH'), null],
            'TAGSUS' => [$this->tagsus(), null],
            'UMURPIUTANG' => [$this->umurPiutang(), null],
        };
        if ($lines === []) {
            throw new EisReportException('Tidak ada baris data yang dikenali; tata letak berkas mungkin berbeda dari laporan EIS yang didukung.');
        }

        return ['family' => $family, 'file_unit_code' => $unitCode, 'unit_source' => $unitSource, 'content_units' => $contentUnits, 'period' => $period, 'summary' => $summary, 'lines' => $lines, 'warnings' => $warnings];
    }

    /** Jenis laporan dari isi: judul kolom tabel datar EIS atau judul laporan pada kepala. */
    private function detectFamily(): ?string
    {
        for ($r = 1; $r <= min(6, $this->rowCount()); $r++) {
            $heads = array_map(fn ($c) => strtoupper(trim((string) $c)), $this->rows[$r - 1]);
            $has = fn (string ...$names) => array_diff($names, $heads) === [];
            $family = match (true) {
                $has('UNIT', 'KODE', 'KETERANGAN', 'SUMBER_LAPORAN') => '309EIS',
                $has('NAMAUPI', 'NAMAUP', 'KOGOL') => 'AKHIEPERIODE_EIS',
                $has('UNITUPI', 'THBLLAP', 'JENIS_LAPORAN', 'KOGOL') => 'UMURPIUTANG',
                $has('THBLLAP', 'UNITUP', 'JENIS_LAPORAN') => 'AKHIRBULAN_EIS',
                $has('UNITUP', 'SKEMA_BAYAR', 'KET_PIUTANG') => 'PIUTANGLPB_EIS',
                default => null,
            };
            if ($family !== null) {
                return $family;
            }
        }
        $text = '';
        foreach (array_slice($this->rows, 0, 15) as $row) {
            foreach ($row as $v) {
                is_string($v) && $text .= ' '.$v;
            }
        }
        $text = strtoupper((string) preg_replace('/\s+/', ' ', $text));
        if (preg_match('/ANOMALI PENANGANAN PENGADUAN (GANGGUAN|KELUHAN)/', $text, $a)) {
            $prefix = $a[1] === 'GANGGUAN' ? 'GGN' : 'KLH';
            if (str_contains($text, 'RATING NEGATIF')) {
                return $prefix.'NEGATIF';
            }

            return str_contains($text, 'BERULANG') ? $prefix.'BERULANG' : null;
        }

        return match (true) {
            str_contains($text, 'LAPORAN PENJUALAN TENAGA LISTRIK') => '309',
            str_contains($text, 'LAPORAN SAIDI SAIFI') => 'DIFI',
            str_contains($text, 'TAGIHAN SUSULAN') => 'TAGSUS',
            str_contains($text, 'REKAPITULASI GANGGUAN ALL') => 'GGNALL',
            preg_match('/REKAPITULASI GANGGUAN (PER )?JENIS GANGGUAN/', $text) === 1 => 'GGNPERJENIS',
            str_contains($text, 'REKAPITULASI KELUHAN ALL') => 'KLHALL',
            default => null,
        };
    }

    /** Kode unit 5 karakter dari kolom unit tabel datar (UNIT, UNITUP, atau NAMAUP "51453 - JOMBANG"); null bila tidak ada (UNITUPI hanya kode induk). */
    private function contentUnitCode(): ?string
    {
        for ($r = 1; $r <= min(6, $this->rowCount()); $r++) {
            $heads = array_map(fn ($c) => strtoupper(trim((string) $c)), $this->rows[$r - 1]);
            foreach (['UNIT', 'UNITUP', 'NAMAUP'] as $h) {
                $i = array_search($h, $heads, true);
                if ($i === false) {
                    continue;
                }
                $v = $this->rows[$r][$i] ?? null;
                $v = is_float($v) && floor($v) === $v ? (string) (int) $v : trim((string) $v);
                if (preg_match('/^([A-Za-z0-9]{5})(?:\s*-.*)?$/', $v, $mm)) {
                    return strtoupper($mm[1]);
                }
            }
        }

        return null;
    }

    private function cell(int $row, string $col): mixed
    {
        $v = $this->rows[$row - 1][Coordinate::columnIndexFromString($col) - 1] ?? null;

        return is_string($v) ? trim($v) : $v;
    }

    private function text(int $row, string $col): ?string
    {
        $v = $this->cell($row, $col);

        return $v === null || $v === '' ? null : trim((string) $v);
    }

    private function num(mixed $v, string $locale = 'en'): ?float
    {
        if ($v === null) {
            return null;
        }
        if (is_int($v) || is_float($v)) {
            return (float) $v;
        }
        $s = str_replace(['%', '+', ' ', 'Rp'], '', trim((string) $v));
        if ($s === '' || $s === '-' || str_starts_with($s, '#')) {
            return null;
        }
        $s = $locale === 'id' ? str_replace(',', '.', str_replace('.', '', $s)) : str_replace(',', '', $s);

        return is_numeric($s) ? (float) $s : null;
    }

    /** "0 - 2 : 3 : 10" (hari - jam : menit : detik) menjadi menit. */
    private function minutes(mixed $v): ?float
    {
        if (is_string($v) && preg_match('/^\s*(\d+)\s*-\s*(\d+)\s*:\s*(\d+)\s*:\s*(\d+)\s*$/', $v, $m)) {
            return round($m[1] * 1440 + $m[2] * 60 + $m[3] + $m[4] / 60, 2);
        }

        return $this->num($v);
    }

    private function rowCount(): int
    {
        return count($this->rows);
    }

    /**
     * Bulan laporan dari isi (Y-m-01): kolom THBLLAP (YYYYMM) pada tabel datar, atau teks "Januari 2023", "1-Januari-2023 SD ...", "BULAN JANUARI TAHUN 2023" di kepala laporan.
     * Angka YYYYMM hanya dibaca di bawah judul THBLLAP supaya angka lain (mis. jumlah kWh) tidak tertebak sebagai bulan.
     */
    private function contentPeriod(): ?string
    {
        $months = 'januari|pebruari|februari|maret|april|mei|juni|juli|agustus|september|oktober|nopember|november|desember';
        foreach (array_slice($this->rows, 0, 16) as $i => $row) {
            foreach ($row as $c => $v) {
                if (is_string($v) && strtoupper(trim($v)) === 'THBLLAP') {
                    $below = $this->rows[$i + 1][$c] ?? null;
                    $s = is_int($below) || is_float($below) ? (string) (int) $below : trim((string) $below);
                    if (preg_match('/^(20\d{2})(0[1-9]|1[0-2])$/', $s, $mm)) {
                        return "{$mm[1]}-{$mm[2]}-01";
                    }
                }
                if (! is_string($v) || $v === '') {
                    continue;
                }
                if (preg_match('/\bbulan\s+('.$months.')\s+tahun\s+(20\d{2})/i', $v, $mm)
                    || preg_match('/(?:\d{1,2}\s*-\s*)?\b('.$months.')\b[\s-]+(20\d{2})/i', $v, $mm)) {
                    return sprintf('%04d-%02d-01', $mm[2], self::MONTHS[strtolower($mm[1])]);
                }
            }
        }

        return null;
    }

    /**
     * Nama ULP dan UP3 pada kepala laporan. $deep: bila kepala tidak menyebut ULP (tata letak lama rekap gangguan/keluhan), cari di tabel; dipakai hanya bila satu ULP saja yang muncul.
     *
     * @return array{ULP:?string,UP3:?string}
     */
    private function contentUnits(bool $deep = false): array
    {
        $out = ['ULP' => null, 'UP3' => null];
        foreach (array_slice($this->rows, 0, 10) as $row) {
            foreach ($row as $v) {
                if (! is_string($v)) {
                    continue;
                }
                foreach (['ULP', 'UP3'] as $t) {
                    if ($out[$t] === null && preg_match('/\b'.$t.'\s+([A-Za-z][A-Za-z .]*?)\s*$/', trim($v), $mm)) {
                        $out[$t] = strtoupper(trim($mm[1]));
                    }
                }
            }
        }
        if ($deep && $out['ULP'] === null) {
            $found = [];
            foreach (array_slice($this->rows, 10, 30) as $row) {
                foreach ($row as $v) {
                    if (is_string($v) && preg_match('/^(?:POSKO\s+)?ULP\s+([A-Za-z][A-Za-z .]*?)\s*$/i', trim($v), $mm)) {
                        $found[strtoupper(trim($mm[1]))] = true;
                    }
                }
            }
            count($found) === 1 && $out['ULP'] = array_key_first($found);
        }

        return $out;
    }

    /**
     * Rekap tunggakan pascabayar per jumlah lembar (umur, bulan) dan kogol (pivot EIS jenis "PERLEMBAR": UNITUPI, THBLLAP, JENIS_LAPORAN, LABEL = jumlah lembar, KOGOL, PLG, LBR, GABUNGAN, ...).
     * Sel gabungan (label lembar untuk beberapa kogol) diisi dari baris sebelumnya; baris subtotal dan total (tanpa KOGOL) tidak disimpan. Unit diambil dari nama berkas (isi hanya memuat UNITUPI).
     *
     * @return list<array{line_no:int,group_label:?string,label:?string,code:?string,values:array<string,mixed>}>
     */
    private function umurPiutang(): array
    {
        $lines = [];
        foreach ($this->flat(['unitupi', 'thbllap', 'jenis_laporan', 'label', 'kogol'], ['unitupi', 'thbllap', 'jenis_laporan', 'label'], 'label', 'kogol', 'UNITUPI') as $l) {
            if (! isset($l['values']['kogol']) || ! is_numeric($l['values']['label'] ?? null) || str_contains(strtoupper((string) ($l['values']['jenis_laporan'] ?? '')), 'TOTAL')) {
                continue;
            }
            $lines[] = $l;
        }

        return $lines;
    }

    /** Lembar 309: baris data setelah baris penomoran kolom (1, 2, 3 ...); nilai bernama per kolom. */
    private function report309(): array
    {
        $start = null;
        for ($r = 1; $r <= min(40, $this->rowCount()); $r++) {
            if ((string) $this->cell($r, 'B') === '1' && (string) $this->cell($r, 'F') === '2') {
                $start = $r + 1;
                break;
            }
        }
        if ($start === null) {
            return [];
        }
        $cols = ['F' => 'pelanggan', 'G' => 'daya_va', 'H' => 'kwh_jumlah', 'I' => 'kwh_lwbp', 'J' => 'kwh_wbp', 'K' => 'kvarh_lebih', 'L' => 'rp_beban', 'N' => 'rp_kwh', 'O' => 'rp_kvarh', 'P' => 'rp_ttlb', 'Q' => 'rp_jumlah'];
        $lines = [];
        $group = null;
        for ($r = $start; $r <= $this->rowCount(); $r++) {
            $label = $this->text($r, 'B');
            $v = [];
            foreach ($cols as $c => $name) {
                $n = $this->num($this->cell($r, $c));
                $n !== null && $v[$name] = $n;
            }
            if ($label === null || $v === []) {
                continue;
            }
            preg_match('/^(I|II|III|IV|V)$/', $label) || $group = $label;
            $lines[] = ['line_no' => $r, 'group_label' => $group, 'label' => $label, 'code' => null, 'values' => $v];
        }

        return $lines;
    }

    /**
     * Tabel datar dengan baris judul (nama kolom di baris judul), kolom teks tetap teks, kolom lain angka. Sel kosong pada $carry mengikuti baris di atasnya.
     *
     * @param  list<string>  $textCols
     * @param  list<string>  $carry
     */
    private function flat(array $textCols, array $carry, string $labelCol, ?string $codeCol, string $anchor): array
    {
        $head = null;
        for ($r = 1; $r <= min(6, $this->rowCount()); $r++) {
            if (strtoupper((string) $this->cell($r, 'A')) === $anchor) {
                $head = $r;
                break;
            }
        }
        if ($head === null) {
            return [];
        }
        $names = [];
        foreach ($this->rows[$head - 1] as $i => $h) {
            $h = strtolower(trim((string) $h));
            $h !== '' && $names[$i] = trim((string) preg_replace('/[^a-z0-9]+/', '_', $h), '_');
        }
        $lines = [];
        $last = [];
        for ($r = $head + 1; $r <= $this->rowCount(); $r++) {
            $v = [];
            foreach ($names as $i => $name) {
                $raw = $this->rows[$r - 1][$i] ?? null;
                $raw = is_string($raw) ? trim($raw) : $raw;
                if (in_array($name, $textCols, true)) {
                    $t = $raw === null || $raw === '' ? null : (string) (is_float($raw) && floor($raw) === $raw ? (int) $raw : $raw);
                    if ($t === null && in_array($name, $carry, true)) {
                        $t = $last[$name] ?? null;
                    }
                    $t !== null && $v[$name] = $t;
                    in_array($name, $carry, true) && $t !== null && $last[$name] = $t;
                } else {
                    $n = $this->num($raw);
                    $n !== null && $v[$name] = $n;
                }
            }
            $label = $v[$labelCol] ?? null;
            if ($label === null && isset($v['skema_bayar'])) {
                $label = $v['skema_bayar'];
            }
            if ($v === [] || ($label === null && count($v) <= count($carry))) {
                continue;
            }
            $lines[] = ['line_no' => $r, 'group_label' => null, 'label' => $label === null ? null : mb_substr(trim((string) $label), 0, 200), 'code' => $codeCol !== null && isset($v[$codeCol]) ? mb_substr((string) $v[$codeCol], 0, 40) : null, 'values' => $v];
        }

        return $lines;
    }

    /** Laporan SAIDI/SAIFI (DIFI): nilai pada kepala laporan (format angka Indonesia, koma desimal) dan tabel penyebab gangguan (titik desimal). */
    private function difi(): array
    {
        $summary = [];
        $head = null;
        for ($r = 1; $r <= min(30, $this->rowCount()); $r++) {
            $a = strtolower((string) $this->cell($r, 'A'));
            if (str_starts_with($a, 'jumlah pelanggan')) {
                $summary['pelanggan'] = $this->num($this->cell($r, 'B'), 'id');
            } elseif (str_starts_with($a, 'saidi')) {
                $summary['saidi_jam'] = $this->num($this->cell($r, 'B'), 'id');
                $summary['saidi_menit'] = $this->num($this->cell($r, 'D'), 'id');
            } elseif (str_starts_with($a, 'saifi')) {
                $summary['saifi_kali'] = $this->num($this->cell($r, 'B'), 'id');
            } elseif (str_starts_with(strtoupper((string) $this->cell($r, 'A')), 'NO. KODE')) {
                $head = $r;
                break;
            }
        }
        if ($head === null || ! isset($summary['saidi_jam'], $summary['saifi_kali'])) {
            return [[], $summary];
        }
        $cols = ['C' => 'jml_plg_padam', 'D' => 'jam_x_plg', 'E' => 'saidi_jam', 'F' => 'saifi_kali', 'G' => 'jumlah_gangguan', 'H' => 'lama_padam_jam', 'I' => 'kwh_tak_tersalurkan'];
        $lines = [];
        $group = null;
        for ($r = $head + 1; $r <= $this->rowCount(); $r++) {
            $code = $this->text($r, 'A');
            $label = $this->text($r, 'B');
            $v = [];
            foreach ($cols as $c => $name) {
                $n = $this->num($this->cell($r, $c));
                $n !== null && $v[$name] = $n;
            }
            if ($v === []) {
                $label !== null && $group = mb_substr($label, 0, 160);

                continue;
            }
            $lines[] = ['line_no' => $r, 'group_label' => $group, 'label' => $label === null ? null : mb_substr($label, 0, 200), 'code' => $code === null ? null : mb_substr($code, 0, 40), 'values' => $v];
        }

        return [$lines, $summary];
    }

    /**
     * Tabel dengan kolom tetap per huruf; baris data = baris setelah judul "Nama Unit" yang kolom A berisi nama dan kolom B angka.
     *
     * @param  array<string,string>  $cols  huruf kolom => nama nilai
     * @param  list<string>  $durations  huruf kolom berisi durasi "h - j : m : d" (disimpan dalam menit)
     * @param  list<string>  $counts  huruf kolom berisi angka cacah (tata letak lama: titik ribuan tanpa nol di belakang)
     */
    private function fixed(string $anchor, array $cols, array $durations, array $counts = []): array
    {
        $head = null;
        for ($r = 1; $r <= min(30, $this->rowCount()); $r++) {
            if (strcasecmp((string) $this->cell($r, 'A'), $anchor) === 0) {
                $head = $r;
                break;
            }
        }
        if ($head === null) {
            return [];
        }
        $lines = [];
        for ($r = $head + 1; $r <= $this->rowCount(); $r++) {
            $label = $this->text($r, 'A');
            if ($label === null || $this->num($this->cell($r, 'B')) === null) {
                continue;
            }
            $v = [];
            foreach ($cols as $c => $name) {
                $n = in_array($c, $durations, true) ? $this->minutes($this->cell($r, $c)) : (in_array($c, $counts, true) ? $this->count($this->cell($r, $c)) : $this->num($this->cell($r, $c)));
                $n !== null && $v[$name] = $n;
            }
            $lines[] = ['line_no' => $r, 'group_label' => null, 'label' => mb_substr($label, 0, 200), 'code' => null, 'values' => $v];
        }

        return $lines;
    }

    /** Rekap gangguan semua jenis: tata letak baru (kolom B..U) atau lama (kolom C..V dengan nomor urut). */
    private function ggnAll(): array
    {
        if ($this->isV1Layout()) {
            return $this->tableV1(['C' => 'total', 'D' => 'selesai', 'E' => 'selesai_pct', 'F' => 'in_progress', 'G' => 'in_progress_pct', 'H' => 'dispatch_rata_menit', 'I' => 'dispatch_maks_menit', 'J' => 'dispatch_min_menit', 'K' => 'dispatch_lewat_sla', 'L' => 'dispatch_dalam_sla',
                'M' => 'response_rata_menit', 'N' => 'response_maks_menit', 'O' => 'response_min_menit', 'P' => 'response_lewat_sla', 'Q' => 'response_dalam_sla', 'R' => 'recovery_rata_menit', 'S' => 'recovery_maks_menit', 'T' => 'recovery_min_menit', 'U' => 'recovery_lewat_sla', 'V' => 'recovery_dalam_sla'],
                ['I', 'J', 'N', 'O', 'S', 'T'], ['H', 'M', 'R'], 'B');
        }

        return $this->fixed('Nama Unit', ['B' => 'total', 'C' => 'selesai', 'D' => 'selesai_pct', 'E' => 'in_progress', 'F' => 'in_progress_pct', 'G' => 'dispatch_rata_menit', 'H' => 'dispatch_maks_menit', 'I' => 'dispatch_min_menit', 'J' => 'dispatch_lewat_sla', 'K' => 'dispatch_dalam_sla',
            'L' => 'response_rata_menit', 'M' => 'response_maks_menit', 'N' => 'response_min_menit', 'O' => 'response_lewat_sla', 'P' => 'response_dalam_sla', 'Q' => 'recovery_rata_menit', 'R' => 'recovery_maks_menit', 'S' => 'recovery_min_menit', 'T' => 'recovery_lewat_sla', 'U' => 'recovery_dalam_sla'],
            ['H', 'I', 'M', 'N', 'R', 'S']);
    }

    /** Rekap keluhan: rata-rata dalam jam (judul "Jam" pada tata letak lama), maksimum dan minimum dalam menit. */
    private function klhAll(): array
    {
        if ($this->isV1Layout()) {
            return $this->tableV1(['C' => 'total', 'D' => 'selesai', 'E' => 'selesai_pct', 'F' => 'in_progress', 'G' => 'in_progress_pct', 'H' => 'response_total_jam', 'I' => 'response_rata_jam', 'J' => 'response_maks_menit', 'K' => 'response_min_menit', 'L' => 'response_lewat_sla', 'M' => 'response_dalam_sla',
                'N' => 'selesai_total_jam', 'O' => 'selesai_rata_jam', 'P' => 'selesai_maks_menit', 'Q' => 'selesai_min_menit', 'R' => 'selesai_lewat_sla', 'S' => 'selesai_dalam_sla'], ['J', 'K', 'P', 'Q'], ['I', 'O'], 'B');
        }

        return $this->fixed('Nama Unit', ['B' => 'total', 'C' => 'selesai', 'D' => 'selesai_pct', 'E' => 'in_progress', 'F' => 'in_progress_pct', 'G' => 'response_rata_jam', 'H' => 'response_maks_menit', 'I' => 'response_min_menit', 'J' => 'response_lewat_sla', 'K' => 'response_dalam_sla',
            'L' => 'selesai_rata_jam', 'M' => 'selesai_maks_menit', 'N' => 'selesai_min_menit', 'O' => 'selesai_lewat_sla', 'P' => 'selesai_dalam_sla'], ['H', 'I', 'M', 'N']);
    }

    /** Tata letak lama (sampai sekitar awal 2026): baris judul "NO" dan nomor urut pada kolom A. */
    private function isV1Layout(): bool
    {
        for ($r = 1; $r <= min(16, $this->rowCount()); $r++) {
            if (strtoupper((string) $this->cell($r, 'A')) === 'NO' && in_array(strtoupper((string) $this->cell($r, 'B')), ['REGIONAL', 'KODE'], true)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Angka cacah pada tata letak lama ditulis dengan titik ribuan tanpa nol di belakang (3.37 = 3.370 = 3370, 2.152 = 2152), sebagai teks atau sebagai bilangan pecahan.
     */
    private function count(mixed $v): ?float
    {
        if (is_string($v) && preg_match('/^(\d{1,3})\.(\d{1,3})$/', trim($v), $m)) {
            return (float) ($m[1].str_pad($m[2], 3, '0'));
        }
        if ((is_float($v) || is_int($v)) && floor((float) $v) !== (float) $v) {
            return round((float) $v * 1000);      // sel numerik 3.37 yang sebenarnya 3.370
        }

        return $this->num($v);
    }

    /** Persen: "100.00%" apa adanya; pecahan 1 (tata letak lama) menjadi 100. */
    private function percent(mixed $v): ?float
    {
        if (is_string($v) && str_contains($v, '%')) {
            return $this->num($v);
        }
        $n = $this->num($v);

        return $n === null ? null : round($n * 100, 2);
    }

    /**
     * Tabel tata letak lama: baris data = kolom A berisi nomor urut; kolom label tetap; baris "Total" ikut disimpan (kode Total).
     *
     * @param  array<string,string>  $cols  huruf => nama; nama berakhiran _pct = persen, _sla atau total/selesai/in_progress/..._sla = cacah, selain itu rata-rata desimal
     * @param  list<string>  $durations
     * @param  list<string>  $averages
     */
    private function tableV1(array $cols, array $durations, array $averages, string $labelCol): array
    {
        $lines = [];
        $group = null;
        for ($r = 1; $r <= $this->rowCount(); $r++) {
            $a = $this->text($r, 'A');
            $total = $a !== null && strcasecmp($a, 'Total') === 0;
            if ($a === null || (! $total && ! is_numeric($a))) {
                continue;
            }
            $v = [];
            foreach ($cols as $c => $name) {
                $raw = $this->cell($r, $c);
                $n = in_array($c, $durations, true) ? $this->minutes($raw) : (str_ends_with($name, '_pct') ? $this->percent($raw) : (in_array($c, $averages, true) ? $this->num($raw) : $this->count($raw)));
                $n !== null && $v[$name] = $n;
            }
            if (! isset($v['total'])) {
                continue;
            }
            $lines[] = ['line_no' => $r, 'group_label' => $group, 'label' => $total ? 'Total' : mb_substr((string) $this->text($r, $labelCol), 0, 200), 'code' => $total ? 'Total' : null, 'values' => $v];
        }

        return $lines;
    }

    /** Rekap gangguan per jenis, tata letak lama: kolom B kode, C jenis, D..T nilai; baris "NNN ( ... )" menjadi judul kelompok. */
    private function perJenisV1(): array
    {
        $cols = ['D' => 'total', 'E' => 'selesai', 'F' => 'selesai_pct', 'G' => 'belum_selesai', 'H' => 'belum_selesai_pct', 'I' => 'response_total_menit', 'J' => 'response_rata_menit', 'K' => 'response_maks_menit', 'L' => 'response_min_menit', 'M' => 'response_lewat_sla', 'N' => 'response_dalam_sla',
            'O' => 'recovery_total_menit', 'P' => 'recovery_rata_menit', 'Q' => 'recovery_maks_menit', 'R' => 'recovery_min_menit', 'S' => 'recovery_lewat_sla', 'T' => 'recovery_dalam_sla'];
        $lines = [];
        $group = null;
        for ($r = 1; $r <= $this->rowCount(); $r++) {
            $a = $this->text($r, 'A');
            if ($a === null) {
                continue;
            }
            $total = strcasecmp($a, 'Total') === 0;
            if (! $total && ! is_numeric($a)) {
                preg_match('/^\d{3}\s*\(/', $a) && $group = mb_substr($a, 0, 160);

                continue;
            }
            $v = [];
            foreach ($cols as $c => $name) {
                $raw = $this->cell($r, $c);
                $n = in_array($c, ['K', 'L', 'Q', 'R'], true) ? $this->minutes($raw) : (str_ends_with($name, '_pct') ? $this->percent($raw) : (in_array($c, ['J', 'P'], true) ? $this->num($raw) : $this->count($raw)));
                $n !== null && $v[$name] = $n;
            }
            if (! isset($v['total'])) {
                continue;
            }
            $lines[] = ['line_no' => $r, 'group_label' => $group, 'label' => mb_substr((string) $this->text($r, 'C'), 0, 200), 'code' => $total ? 'Total' : $this->text($r, 'B'), 'values' => $v];
        }

        return $lines;
    }

    /**
     * Laporan berulang/rating negatif: kolom disimpan menurut huruf (c_B ... c_R); makna kolom ada pada docs/88. Kolom jumlah (GGN: B..L, KLH: B..I) dibaca sebagai angka cacah, karena berkas sampai
     * September 2025 menulisnya dengan titik ribuan tanpa nol di belakang ("3.14" = 3.140); kolom persen (GGN: M..R, KLH: J..L) dibaca apa adanya.
     *
     * @param  'GGN'|'KLH'  $kind
     */
    private function fixedByLetter(string $kind): array
    {
        $cols = [];
        foreach (range('B', 'R') as $c) {
            $cols[$c] = 'c_'.$c;
        }

        return $this->fixed('Nama Unit', $cols, [], range('B', $kind === 'GGN' ? 'L' : 'I'));
    }

    /** Rekap gangguan per jenis (peralatan): baris bertanda ": 111 (...)" menjadi judul kelompok. */
    private function perJenis(): array
    {
        $cols = ['C' => 'total', 'D' => 'selesai', 'E' => 'selesai_pct', 'F' => 'belum_selesai', 'G' => 'belum_selesai_pct', 'H' => 'response_total_menit', 'I' => 'response_rata_menit', 'J' => 'response_maks_menit', 'K' => 'response_min_menit', 'L' => 'response_lewat_sla', 'M' => 'response_dalam_sla',
            'N' => 'recovery_total_menit', 'O' => 'recovery_rata_menit', 'P' => 'recovery_maks_menit', 'Q' => 'recovery_min_menit', 'R' => 'recovery_lewat_sla', 'S' => 'recovery_dalam_sla'];
        $durations = ['J', 'K', 'P', 'Q'];
        $head = null;
        for ($r = 1; $r <= min(30, $this->rowCount()); $r++) {
            if (strcasecmp((string) $this->cell($r, 'A'), 'Kode') === 0) {
                $head = $r;
                break;
            }
        }
        if ($head === null) {
            return [];
        }
        $lines = [];
        $group = null;
        for ($r = $head + 1; $r <= $this->rowCount(); $r++) {
            $a = $this->text($r, 'A');
            if ($a !== null && str_starts_with($a, ':')) {
                $group = mb_substr(ltrim($a, ': '), 0, 160);

                continue;
            }
            if ($a === null || $this->num($this->cell($r, 'C')) === null) {
                continue;
            }
            $v = [];
            foreach ($cols as $c => $name) {
                $n = in_array($c, $durations, true) ? $this->minutes($this->cell($r, $c)) : $this->num($this->cell($r, $c));
                $n !== null && $v[$name] = $n;
            }
            $lines[] = ['line_no' => $r, 'group_label' => $a === 'Total' ? null : $group, 'label' => mb_substr((string) $this->text($r, 'B'), 0, 200), 'code' => mb_substr($a, 0, 40), 'values' => $v];
        }

        return $lines;
    }

    /** Tagihan susulan: hanya ringkasan per golongan (jumlah dan rupiah); nama, alamat, dan nomor pelanggan tidak dibaca. */
    private function tagsus(): array
    {
        $head = null;
        for ($r = 1; $r <= min(20, $this->rowCount()); $r++) {
            if (strtoupper((string) $this->cell($r, 'A')) === 'NO' && strtoupper((string) $this->cell($r, 'D')) === 'IDPEL') {
                $head = $r;
                break;
            }
        }
        if ($head === null) {
            return [];
        }
        $cols = ['L' => 'kwh', 'M' => 'rp_beban', 'N' => 'rp_kwh', 'P' => 'rp_ts', 'Z' => 'rp_total', 'AB' => 'rp_tunai', 'AC' => 'rp_angsuran'];
        $sum = [];
        $first = [];
        for ($r = $head + 1; $r <= $this->rowCount(); $r++) {
            if (! is_numeric($this->cell($r, 'A')) || ! preg_match('/^\d{12}$/', (string) $this->text($r, 'D'))) {
                continue;
            }
            $gol = $this->text($r, 'H') ?? 'TANPA GOLONGAN';
            $first[$gol] ??= $r;
            $sum[$gol]['jumlah'] = ($sum[$gol]['jumlah'] ?? 0) + 1;
            foreach ($cols as $c => $name) {
                $sum[$gol][$name] = ($sum[$gol][$name] ?? 0) + ($this->num($this->cell($r, $c)) ?? 0);
            }
        }
        ksort($sum);
        $lines = [];
        foreach ($sum as $gol => $v) {
            $lines[] = ['line_no' => $first[$gol], 'group_label' => null, 'label' => mb_substr((string) $gol, 0, 200), 'code' => null, 'values' => $v];
        }

        return $lines;
    }
}
