<?php

namespace App\Services\EisReports;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;

/**
 * Penarikan per ULP per bulan dari APKT. RPT dan RCT: WO gangguan (monalisaJumlahDurasiRptRctGangguan, dua kali per bulan: parameter 0 = semua laporan (dengan clear temper) dan 1 = tanpa clear temper;
 * kolom `clear_temper` bernilai true untuk dengan clear temper) dan WO keluhan (monalisaJumlahDurasiRptRctKeluhan, satu kali per bulan, tanpa varian clear temper). Anomali pengaduan gangguan (dua query per bulan: berulang dan rating negatif, rentang tanggal bulan itu).
 * Satu permintaan memuat semua ULP di bawah UP3 (idUlp kosong). Hasil disimpan di apkt_rpt_rct_records atau apkt_rpt_rct_keluhan_records (bulan, ULP, dan jenis sama menggantikan yang lama); hanya nilai bulan berjalan
 * yang dipakai, kumulatif tahun berjalan dihitung dari bulanan.
 */
class ApktRptRctSync
{
    private const FIELDS = 'nama_regional id_uid nama_uid id_up3 nama_up3 id_ulp nama_ulp total_durasi_response_time_bulan_ini count_durasi_response_time_bulan_ini avg_durasi_response_time_bulan_ini total_durasi_recovery_time_bulan_ini count_durasi_recovery_time_bulan_ini avg_durasi_recovery_time_bulan_ini total_durasi_response_time_tahun_ini count_durasi_response_time_tahun_ini avg_durasi_response_time_tahun_ini total_durasi_recovery_time_tahun_ini count_durasi_recovery_time_tahun_ini avg_durasi_recovery_time_tahun_ini';

    /** @var array<string, array{field: string, table: string, label: string}> */
    private const DATASETS = [
        'rpt-rct-gangguan' => ['field' => 'monalisaJumlahDurasiRptRctGangguan', 'table' => 'apkt_rpt_rct_records', 'label' => 'WO gangguan'],
        'rpt-rct-keluhan' => ['field' => 'monalisaJumlahDurasiRptRctKeluhan', 'table' => 'apkt_rpt_rct_keluhan_records', 'label' => 'WO keluhan'],
        'anomali-gangguan' => ['field' => null, 'table' => 'apkt_anomali_gangguan_records', 'label' => 'anomali pengaduan gangguan'],
    ];

    /** Dataset anomali gangguan: jenis => nama query APKT. */
    private const ANOMALI_QUERIES = ['BERULANG' => 'anomaliPenangananPengaduanGangguanUnitBerulang', 'NEGATIF' => 'anomaliPenangananPengaduanGangguanUnitRatingNegatif'];

    private const ANOMALI_FIELDS = ['wo_cc123', 'wo_pln_mobile', 'wo_loket', 'wo_lainnya', 'wo_total', 'anomali_pln_mobile_marking', 'anomali_pln_mobile_non_marking', 'anomali_cc123_marking', 'anomali_cc123_non_marking', 'total_anomali_marking', 'total_anomali_non_marking'];

    private const LOG_LIMIT = 30000;

    public function __construct(private readonly ApktSaidiSaifiSync $saidi) {}

    /**
     * Menjalankan satu run RPT/RCT sampai selesai. Token dibaca dari `options.token_encrypted` dan tidak pernah ditulis ke log.
     *
     * @param  callable(string): void  $flush
     * @return array{0: int, 1: string} kode keluar dan log
     */
    public function run(object $run, callable $flush): array
    {
        $o = (array) json_decode((string) $run->options, true);
        $dataset = array_key_exists((string) ($o['dataset'] ?? ''), self::DATASETS) ? (string) $o['dataset'] : 'rpt-rct-gangguan';
        $log = '';
        $last = 0.0;
        $say = function (string $line) use (&$log, &$last, $flush): void {
            $log = strlen($log.$line."\n") > self::LOG_LIMIT ? '…'.substr($log.$line."\n", -self::LOG_LIMIT) : $log.$line."\n";
            if (microtime(true) - $last > 2) {
                $last = microtime(true);
                $flush($log);
            }
        };
        try {
            $token = Crypt::decryptString((string) ($o['token_encrypted'] ?? ''));
        } catch (\Throwable) {
            $say('GAGAL: token APKT tidak tersedia pada penarikan ini.');

            return [1, $log];
        }
        $codes = $run->units === null ? [] : (array) json_decode((string) $run->units, true);
        $ulps = DB::table('organizational_units')->where('unit_type', 'ULP')->where('is_active', true)->when($codes !== [], fn ($q) => $q->whereIn('code', $codes))->get(['id', 'code', 'name'])->keyBy(fn ($u) => (string) (int) $u->code);
        $months = [];
        for ($d = new \DateTimeImmutable($o['from_month'].'-01'); $d->format('Y-m') <= $o['to_month']; $d = $d->modify('+1 month')) {
            $months[] = $d->format('Y-m');
        }
        $variants = match ($dataset) {
            'rpt-rct-gangguan' => [0, 1],
            'anomali-gangguan' => ['BERULANG', 'NEGATIF'],
            default => [null],
        };
        $say(sprintf('Penarikan %s %s dari APKT: %d bulan (%s s.d. %s)%s.', $dataset === 'anomali-gangguan' ? 'anomali' : 'RPT/RCT', str_replace('anomali ', '', self::DATASETS[$dataset]['label']), count($months), $months[0] ?? '-', end($months) ?: '-', $dataset === 'rpt-rct-gangguan' ? ', tanpa dan dengan clear temper' : ''));

        $failed = 0;
        $stored = 0;
        $accepted = false;
        $deadline = microtime(true) + (float) config('distriva.eis_sync.timeout_seconds');
        foreach ($months as $ym) {
            foreach ($variants as $variant) {      // gangguan: parameter APKT 0 = "Semua Laporan" (dengan clear temper), 1 = "Laporan Tanpa Clear Tamper"; keluhan: tanpa varian; anomali: jenis BERULANG atau NEGATIF
                $label = match (true) {
                    is_string($variant) => sprintf('%s %s', $ym, $variant === 'BERULANG' ? 'berulang' : 'rating negatif'),
                    $variant === null => $ym,
                    default => sprintf('%s %s', $ym, $variant === 0 ? 'dengan clear temper' : 'tanpa clear temper'),
                };
                if (microtime(true) > $deadline) {
                    $say("GAGAL  {$label}: waktu penarikan habis.");
                    $failed++;

                    continue;
                }
                try {
                    $rows = $this->fetch($token, (int) substr($ym, 0, 4), (int) substr($ym, 5, 2), $variant, $dataset);
                    $n = $this->store($dataset, $rows, $ulps, $ym, $variant, (string) $run->id);
                    $stored += $n;
                    $accepted = true;
                    $say(sprintf('%-11s %s (%d ULP)', 'TERSIMPAN', $label, $n));
                } catch (ApktTokenRejected $e) {
                    $say("GAGAL  {$label}: {$e->getMessage()}");
                    $say('Penarikan dihentikan: tempel token APKT yang baru lalu ulangi.');
                    $this->saidi->recordSavedToken($run, $o, $token, true);

                    return [1, $log];
                } catch (\Throwable $e) {
                    $failed++;
                    $say("GAGAL  {$label}: {$e->getMessage()}");
                }
                usleep((int) config('distriva.apkt.pause_ms') * 1000);
            }
        }
        $accepted && $this->saidi->recordSavedToken($run, $o, $token, false);
        $say(sprintf('Selesai: %d data ULP tersimpan; %d permintaan gagal.', $stored, $failed));

        return [$failed === 0 ? 0 : 1, $log];
    }

    /**
     * @return list<array<string, mixed>> baris per ULP
     *
     * @throws ApktTokenRejected token ditolak APKT
     */
    public function fetch(string $token, int $year, int $month, int|string|null $clearTemper = null, string $dataset = 'rpt-rct-gangguan'): array
    {
        $cfg = config('distriva.apkt');
        $field = $dataset === 'anomali-gangguan' ? self::ANOMALI_QUERIES[(string) $clearTemper] : self::DATASETS[$dataset]['field'];
        $variables = ['namaRegional' => '', 'idUid' => [$cfg['id_uid']], 'idUp3' => [$cfg['id_up3']], 'idUlp' => []];
        $dataset === 'anomali-gangguan' ? $variables += ['dateFrom' => sprintf('%04d-%02d-01', $year, $month), 'dateTo' => date('Y-m-t', (int) strtotime(sprintf('%04d-%02d-01', $year, $month)))] : $variables += ['bulan' => $month, 'tahun' => $year];
        $query = $dataset === 'anomali-gangguan'
            ? sprintf('query %1$s($dateFrom: Date!, $dateTo: Date!, $namaRegional: String!, $idUlp: [Int], $idUid: [Int], $idUp3: [Int]) { %1$s(dateFrom: $dateFrom, dateTo: $dateTo, namaRegional: $namaRegional, idUlp: $idUlp, idUid: $idUid, idUp3: $idUp3) { id_uid nama_uid id_up3 nama_up3 id_ulp nama_ulp %2$s } }', $field, implode(' ', self::ANOMALI_FIELDS))
            : ($dataset === 'rpt-rct-gangguan'
            ? sprintf('query %1$s($namaRegional: String, $idUlp: [Int], $idUid: [Int], $idUp3: [Int], $bulan: Int, $tahun: Int, $clearTemper: Int) { %1$s(namaRegional: $namaRegional, idUlp: $idUlp, idUid: $idUid, idUp3: $idUp3, bulan: $bulan, tahun: $tahun, clearTemper: $clearTemper) { %2$s } }', $field, self::FIELDS)
            : sprintf('query %1$s($bulan: Int!, $tahun: Int!, $namaRegional: String!, $idUlp: [Int], $idUid: [Int], $idUp3: [Int]) { %1$s(bulan: $bulan, tahun: $tahun, namaRegional: $namaRegional, idUlp: $idUlp, idUid: $idUid, idUp3: $idUp3) { %2$s } }', $field, self::FIELDS));
        $dataset === 'rpt-rct-gangguan' && $variables['clearTemper'] = $clearTemper ?? 0;
        $payload = ['query' => $query, 'variables' => $variables];
        $res = Http::withHeaders(['Authorization' => 'Bearer '.$token, 'Origin' => $cfg['eis_origin'], 'Referer' => rtrim((string) $cfg['eis_origin'], '/').'/', 'X-Client-UTC' => 'UTC+07:00', 'Accept' => 'application/json'])
            ->timeout((int) $cfg['timeout_seconds'])->retry(2, 1000, fn ($e) => $e instanceof ConnectionException, throw: false)->post((string) $cfg['monalisa_url'], $payload);
        if (in_array($res->status(), [401, 403], true)) {
            throw new ApktTokenRejected('token APKT ditolak (HTTP '.$res->status().'); kemungkinan sudah kedaluwarsa atau sesi APKT ditutup.');
        }
        $json = $res->json();
        $rows = $json['data'][$field] ?? null;
        $errMessage = (string) ($json['errors'][0]['message'] ?? '');
        if (preg_match('/unauthor|token|expired|kedaluwarsa|forbidden/i', $errMessage) === 1 && $rows === null) {
            throw new ApktTokenRejected('token APKT ditolak: '.mb_substr($errMessage, 0, 120));
        }
        if (! $res->ok() || ! is_array($rows)) {
            throw new \RuntimeException('HTTP '.$res->status().': '.mb_substr($errMessage ?: $res->body(), 0, 200));
        }

        return array_values($rows);
    }

    /**
     * @param  list<array<string, mixed>>  $rows
     * @param  Collection<string, object>  $ulps  ULP yang boleh ditarik, kunci = kode ULP tanpa nol di depan (id_ulp APKT)
     */
    private function store(string $dataset, array $rows, $ulps, string $ym, int|string|null $variant, string $runId): int
    {
        $n = 0;
        foreach ($rows as $r) {
            $ulp = $ulps->get((string) (int) ($r['id_ulp'] ?? 0));
            if ($ulp === null) {
                continue;
            }
            $row = ['id' => (string) Str::uuid(), 'organizational_unit_id' => $ulp->id, 'period' => $ym.'-01', 'sync_run_id' => $runId, 'created_at' => now(), 'updated_at' => now()];
            $keys = ['organizational_unit_id', 'period'];
            if ($dataset === 'anomali-gangguan') {
                $row['jenis'] = (string) $variant;
                $keys[] = 'jenis';
                foreach (self::ANOMALI_FIELDS as $field) {
                    $row[$field] = (int) ($r[$field] ?? 0);
                }
                $update = [...self::ANOMALI_FIELDS, 'sync_run_id', 'updated_at'];
            } else {
                $row += ['rpt_total' => (float) ($r['total_durasi_response_time_bulan_ini'] ?? 0), 'rpt_count' => (int) ($r['count_durasi_response_time_bulan_ini'] ?? 0),
                    'rct_total' => (float) ($r['total_durasi_recovery_time_bulan_ini'] ?? 0), 'rct_count' => (int) ($r['count_durasi_recovery_time_bulan_ini'] ?? 0)];
                if ($variant !== null) {
                    $row['clear_temper'] = $variant === 0;
                    $keys[] = 'clear_temper';
                }
                $update = ['rpt_total', 'rpt_count', 'rct_total', 'rct_count', 'sync_run_id', 'updated_at'];
            }
            DB::table(self::DATASETS[$dataset]['table'])->upsert([$row], $keys, $update);
            $n++;
        }

        return $n;
    }
}
