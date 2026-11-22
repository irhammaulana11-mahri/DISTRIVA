<?php

namespace App\Services\Outages;

use App\Exceptions\AssignmentRuleViolation;
use Carbon\CarbonImmutable;

/**
 * Membaca CSV "Analisa gangguan penyulang dan recloser": mencari baris judul (TANGGAL dan PENYULANG), memetakan kolom menurut namanya, dan merapikan nilai yang tidak seragam
 * (tanggal bahasa Inggris atau Indonesia, jam H:MM, lama padam H:MM, angka berkoma ribuan atau desimal, galat sheet #REF!/#NUM!/#N/A). Baris tanpa tanggal, jam, atau penyulang ditolak dengan alasan.
 */
class OutageSheetParser
{
    private const MONTHS = ['januari' => 'January', 'februari' => 'February', 'maret' => 'March', 'april' => 'April', 'mei' => 'May', 'juni' => 'June', 'juli' => 'July', 'agustus' => 'August', 'agu' => 'Aug', 'september' => 'September', 'oktober' => 'October', 'okt' => 'Oct', 'november' => 'November', 'nopember' => 'November', 'desember' => 'December', 'des' => 'Dec'];

    /**
     * @return array{rows:list<array<string,mixed>>,invalid:list<array{line:int,reason:string}>,read:int}
     */
    public function parse(string $csv, string $timezone): array
    {
        $h = fopen('php://temp', 'r+');
        fwrite($h, ltrim($csv, "\xEF\xBB\xBF"));
        rewind($h);
        $map = null;
        $line = 0;
        $rows = [];
        $invalid = [];
        $read = 0;
        while (($r = fgetcsv($h, 0, ',', '"', '')) !== false) {
            $line++;
            if ($map === null) {
                if ($line > 60) {
                    break;
                }
                $try = $this->headerMap($r);
                $try !== null && $map = $try;

                continue;
            }
            if (! array_filter($r, fn ($c) => trim((string) $c) !== '')) {
                continue;
            }
            $read++;
            $get = fn (string $k) => isset($map[$k], $r[$map[$k]]) ? trim((string) $r[$map[$k]]) : '';
            $row = $this->row($get, $timezone);
            if (is_string($row)) {
                $invalid[] = ['line' => $line, 'reason' => $row];

                continue;
            }
            $rows[] = $row;
        }
        fclose($h);
        if ($map === null) {
            throw new AssignmentRuleViolation('Baris judul tidak ditemukan: sheet harus punya kolom TANGGAL dan PENYULANG.');
        }

        return ['rows' => $rows, 'invalid' => $invalid, 'read' => $read];
    }

    /** @param array<int,?string> $r @return array<string,int>|null */
    private function headerMap(array $r): ?array
    {
        $norm = array_map(fn ($c) => $this->key((string) $c), $r);
        if (! in_array('TANGGAL', $norm, true) || ! in_array('PENYULANG', $norm, true)) {
            return null;
        }
        $map = [];
        foreach ($norm as $i => $k) {
            $k !== '' && ! isset($map[$k]) && $map[$k] = $i;
        }

        return $map;
    }

    private function key(string $s): string
    {
        return strtoupper(preg_replace('/\s*([\/(),])\s*/', '$1', trim(preg_replace('/\s+/', ' ', $s))) ?? '');
    }

    /** @return array<string,mixed>|string */
    private function row(callable $get, string $tz): array|string
    {
        $feeder = $get('PENYULANG');
        if ($feeder === '' || str_starts_with($feeder, '#')) {
            return 'penyulang kosong';
        }
        $date = $this->date($get('TGL TRIP')) ?? $this->date($get('TANGGAL'));
        if ($date === null) {
            return 'tanggal tidak terbaca';
        }
        $time = $this->time($get('JAM'));
        if ($time === null) {
            return 'jam tidak terbaca';
        }
        $occurred = CarbonImmutable::createFromFormat('Y-m-d H:i', $date.' '.$time, $tz);
        $minutes = $this->duration($get('LAMA PADAM'));
        if ($minutes === null) {
            $nd = $this->date($get('TGL NORMAL'));
            $nt = $this->time($get('NORMAL'));
            if ($nd !== null && $nt !== null) {
                $diff = CarbonImmutable::createFromFormat('Y-m-d H:i', $nd.' '.$nt, $tz)->diffInMinutes($occurred, true);
                $minutes = $diff <= 7 * 1440 ? (float) $diff : null;
            }
        }
        $type = strtoupper($get('TEMPORER/PERMANEN'));
        $device = $get('PMT/RECLOSER');
        $deviceU = strtoupper($device);
        $zone = $get('ZONA');
        $section = $get('SECTION');
        $clean = fn (string $v, int $max) => $v === '' || str_starts_with($v, '#') ? null : mb_substr($v, 0, $max);

        return [
            'occurred_at' => $occurred, 'duration_minutes' => $minutes, 'restored_at' => $minutes === null ? null : $occurred->addSeconds((int) round($minutes * 60)),
            'rayon' => $clean($get('RAYON'), 60), 'gi_name' => mb_substr($get('GI') === '' || str_starts_with($get('GI'), '#') ? '-' : $get('GI'), 0, 100), 'feeder_name' => mb_substr($feeder, 0, 100),
            'device_text' => $clean($device, 60), 'device_group' => str_contains($deviceU, 'REC') ? 'RECLOSER' : (str_contains($deviceU, 'PMT') ? 'PMT' : 'OTHER'),
            'outage_type' => str_contains($type, 'PERMANEN') ? 'PERMANEN' : (str_contains($type, 'TEMPOR') ? 'TEMPORER' : null),
            'load_before_a' => $this->num($get('BEBAN SEBELUM')), 'current_r' => $this->num($get('R')), 'current_s' => $this->num($get('S')), 'current_t' => $this->num($get('T')), 'current_n' => $this->num($get('N')),
            'ens_kwh' => $this->num($get('ENS')), 'relay' => $clean($get('RELAY'), 60), 'cause' => $clean($get('PENYEBAB'), 2000), 'weather' => $clean($get('CUACA'), 80),
            'category' => $clean($get('KATEGORI'), 80), 'fault_code' => $clean($get('KODE GANGGUAN'), 160), 'incident_code' => $clean($get('KODE'), 80),
            'zone' => $clean($zone, 20), 'section' => $clean($section, 20), 'construction' => $clean($get('KONSTRUKSI'), 80), 'coordinates' => $clean($get('KOORDINAT(X,Y)'), 80),
        ];
    }

    private function date(string $v): ?string
    {
        $v = trim($v);
        if ($v === '' || str_starts_with($v, '#')) {
            return null;
        }
        $v = preg_replace_callback('/[A-Za-z]+/', fn ($m) => self::MONTHS[strtolower($m[0])] ?? $m[0], $v) ?? $v;
        foreach (['d F Y', 'd M Y', 'Y-m-d', 'd/m/Y', 'd-m-Y', 'j F Y', 'j M Y'] as $f) {
            $d = \DateTimeImmutable::createFromFormat('!'.$f, $v);
            $e = \DateTimeImmutable::getLastErrors();
            if ($d !== false && ($e === false || ($e['warning_count'] === 0 && $e['error_count'] === 0))) {
                return $d->format('Y-m-d');
            }
        }

        return null;
    }

    private function time(string $v): ?string
    {
        return preg_match('/^(\d{1,2}):(\d{2})(?::\d{2})?$/', trim($v), $m) && (int) $m[1] < 24 && (int) $m[2] < 60 ? sprintf('%02d:%02d', $m[1], $m[2]) : null;
    }

    private function duration(string $v): ?float
    {
        if (! preg_match('/^(\d{1,3}):(\d{2})(?::(\d{2}))?$/', trim($v), $m) || (int) $m[2] > 59) {
            return null;
        }
        $minutes = (int) $m[1] * 60 + (int) $m[2] + (isset($m[3]) ? (int) $m[3] / 60 : 0);

        return $minutes <= 7 * 1440 ? round($minutes, 2) : null;
    }

    private function num(string $v): ?float
    {
        $v = trim(str_replace(' ', '', $v));
        if ($v === '' || str_starts_with($v, '#') || ! preg_match('/^-?[\d.,]+$/', $v)) {
            return null;
        }
        $v = preg_match('/^-?\d{1,3}(,\d{3})+(\.\d+)?$/', $v) ? str_replace(',', '', $v) : (preg_match('/^-?\d{1,3}(\.\d{3})+(,\d+)?$/', $v) ? str_replace(',', '.', str_replace('.', '', $v)) : str_replace(',', '.', $v));

        return is_numeric($v) ? (float) $v : null;
    }
}
