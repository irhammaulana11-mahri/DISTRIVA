<?php

namespace App\Services\EisReports;

use App\Models\User;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use PhpOffice\PhpSpreadsheet\Cell\DataType;
use PhpOffice\PhpSpreadsheet\Spreadsheet;

/**
 * Penarikan "Laporan SAIDI SAIFI SE004" bulanan dari APKT (jenis impor DIFI, docs/88): per ULP per bulan, GraphQL APKT dipanggil dengan token sesi yang ditempel pemakai,
 * hasilnya (pohon kelompok > sub kelompok > fasilitas > sub fasilitas > peralatan) disusun menjadi Excel bertata letak sama dengan ekspor APKT, lalu masuk lewat impor laporan EIS
 * yang sama (idempoten menurut sidik isi; unit dan bulan sama menggantikan versi lama). Laporan "Kumulatif" sengaja tidak dipakai: itu akumulasi sejak Januari.
 */
class ApktSaidiSaifiSync
{
    private const QUERY = <<<'GQL'
query get($cmd: LaporanSaidiSaifiSE004CmdInput) {
  getLaporanSaidiSaifiSE004(cmd: $cmd) {
    status message
    data {
      kelompok { id nama totalKelompok_jumlahPelangganPadam totalKelompok_jumlahTotalPelanggan totalKelompok_jamXJumlahPelangganPadam totalKelompok_saidi totalKelompok_saidiPelanggan totalKelompok_saifi totalKelompok_jumlahGangguan totalKelompok_lamaPadam totalKelompok_kwhLoss
        subKelompok { id nama totalSubKelompok_jumlahPelangganPadam totalSubKelompok_jumlahTotalPelanggan totalSubKelompok_jamXJumlahPelangganPadam totalSubKelompok_saidi totalSubKelompok_saidiPelanggan totalSubKelompok_saifi totalSubKelompok_jumlahGangguan totalSubKelompok_lamaPadam totalSubKelompok_kwhLoss
          fasilitas { id nama totalFasilitas_jumlahPelangganPadam totalFasilitas_jumlahTotalPelanggan totalFasilitas_jamXJumlahPelangganPadam totalFasilitas_saidi totalFasilitas_saidiPelanggan totalFasilitas_saifi totalFasilitas_jumlahGangguan totalFasilitas_lamaPadam totalFasilitas_kwhLoss
            subFasilitas { id nama totalSubFasilitas_jumlahPelangganPadam totalSubFasilitas_jumlahTotalPelanggan totalSubFasilitas_jamXJumlahPelangganPadam totalSubFasilitas_saidi totalSubFasilitas_saidiPelanggan totalSubFasilitas_saifi totalSubFasilitas_jumlahGangguan totalSubFasilitas_lamaPadam totalSubFasilitas_kwhLoss
              equipment { id nama jumlahPelangganPadam jumlahTotalPelanggan jamXJumlahPelangganPadam saidi saidiPelanggan saifi jumlahGangguan lamaPadam kwhLoss } } } } }
      totalKeseluruhan { jumlahPelangganPadam jumlahTotalPelanggan jamXJumlahPelangganPadam saidi saidiPelanggan saifi jumlahGangguan lamaPadam kwhLoss } } } }
GQL;

    private const MONTHS = ['Januari', 'Pebruari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'Nopember', 'Desember'];

    private const LOG_LIMIT = 30000;

    public function __construct(private readonly EisReportImportService $importer) {}

    /** Token yang ditempel pemakai (dengan atau tanpa awalan "Bearer ") atau null bila bentuknya tidak masuk akal. */
    public static function cleanToken(?string $raw): ?string
    {
        $t = trim((string) preg_replace('/^\s*Bearer\s+/i', '', (string) $raw));

        return preg_match('/^[A-Za-z0-9._~+\/=-]{16,600}$/', $t) === 1 ? $t : null;
    }

    /**
     * Menjalankan satu run APKT sampai selesai. Token dibaca dari `options.token_encrypted` dan tidak pernah ditulis ke log.
     *
     * @param  callable(string): void  $flush  dipanggil dengan log terbaru
     * @return array{0: int, 1: string} kode keluar (0 = semua berkas masuk) dan log
     */
    public function run(object $run, callable $flush): array
    {
        $o = (array) json_decode((string) $run->options, true);
        $log = '';
        $last = 0.0;
        $say = function (string $line) use (&$log, &$last, $flush): void {
            $log = $this->tail($log.$line."\n");
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
        $user = User::query()->find($run->started_by);
        $codes = $run->units === null ? [] : (array) json_decode((string) $run->units, true);
        $ulps = DB::table('organizational_units')->where('unit_type', 'ULP')->where('is_active', true)->when($codes !== [], fn ($q) => $q->whereIn('code', $codes))->orderBy('code')->get(['code', 'name']);
        $months = $this->months((string) $o['from_month'], (string) $o['to_month']);
        $say(sprintf('Penarikan Laporan SAIDI SAIFI SE004 dari APKT: %d ULP x %d bulan (%s s.d. %s).', $ulps->count(), count($months), $months[0] ?? '-', end($months) ?: '-'));

        $counts = ['BARU' => 0, 'DIGANTIKAN' => 0, 'DUPLIKAT' => 0, 'SUDAH_DIGANTIKAN' => 0];
        $failed = 0;
        $deadline = microtime(true) + (float) config('distriva.eis_sync.timeout_seconds');
        foreach ($months as $ym) {
            foreach ($ulps as $ulp) {
                $label = sprintf('%s %s', $ulp->name, $ym);
                if (microtime(true) > $deadline) {
                    $say("GAGAL  {$label}: waktu penarikan habis.");
                    $failed++;

                    continue;
                }
                try {
                    $data = $this->fetch($token, (string) $ulp->code, (int) substr($ym, 0, 4), (int) substr($ym, 5, 2));
                    $res = $this->importData($data, $ulp, $ym, $user);
                    $counts[$res['status']] = ($counts[$res['status']] ?? 0) + 1;
                    $say(sprintf('%-11s %s (%d baris)', $res['status'], $label, $res['lines']));
                } catch (ApktTokenRejected $e) {
                    $say("GAGAL  {$label}: {$e->getMessage()}");
                    $say('Penarikan dihentikan: tempel token APKT yang baru lalu ulangi.');

                    return [1, $log];
                } catch (EisReportException $e) {
                    $failed++;
                    $say("DITOLAK {$label}: {$e->getMessage()}");
                } catch (\Throwable $e) {
                    $failed++;
                    $say("GAGAL  {$label}: {$e->getMessage()}");
                }
                usleep((int) config('distriva.apkt.pause_ms') * 1000);
            }
        }
        $in = $counts['BARU'] + $counts['DIGANTIKAN'] + $counts['DUPLIKAT'] + $counts['SUDAH_DIGANTIKAN'];
        $say(sprintf('Selesai: %d berkas masuk DISTRIVA (baru %d, menggantikan %d, duplikat %d); %d gagal atau ditolak.', $in, $counts['BARU'], $counts['DIGANTIKAN'], $counts['DUPLIKAT'] + $counts['SUDAH_DIGANTIKAN'], $failed));

        return [$failed === 0 ? 0 : 1, $log];
    }

    /**
     * @return array<string, mixed> `data` laporan (kelompok dan totalKeseluruhan)
     *
     * @throws ApktTokenRejected token ditolak APKT (HTTP 401/403)
     */
    public function fetch(string $token, string $ulpCode, int $year, int $month): array
    {
        $cfg = config('distriva.apkt');
        $payload = ['query' => self::QUERY, 'variables' => ['cmd' => ['idUid' => [$cfg['id_uid']], 'idUp3' => [$cfg['id_up3']], 'idUlp' => [(int) $ulpCode], 'bulan' => $month, 'tahun' => $year, 'idEquipment' => 0]]];
        $http = Http::withHeaders(['Authorization' => 'Bearer '.$token, 'Origin' => $cfg['origin'], 'Referer' => rtrim((string) $cfg['origin'], '/').'/', 'X-Client-UTC' => 'UTC+07:00', 'Accept' => 'application/json'])
            ->timeout((int) $cfg['timeout_seconds'])->retry(2, 1000, fn ($e) => $e instanceof ConnectionException, throw: false);
        $res = $http->post((string) $cfg['graphql_url'], $payload);
        if (in_array($res->status(), [401, 403], true)) {
            throw new ApktTokenRejected('token APKT ditolak (HTTP '.$res->status().'); kemungkinan sudah kedaluwarsa atau sesi APKT ditutup.');
        }
        $json = $res->json();
        $out = $json['data']['getLaporanSaidiSaifiSE004'] ?? null;
        $errMessage = (string) ($json['errors'][0]['message'] ?? '');
        if (preg_match('/unauthor|token|expired|kedaluwarsa|forbidden/i', $errMessage) === 1 && $out === null) {
            throw new ApktTokenRejected('token APKT ditolak: '.mb_substr($errMessage, 0, 120));
        }
        if (! $res->ok() || ! is_array($out) || ($out['status'] ?? false) !== true || ! is_array($out['data'] ?? null)) {
            throw new \RuntimeException('HTTP '.$res->status().': '.mb_substr((string) ($errMessage ?: ($out['message'] ?? $res->body())), 0, 200));
        }
        $data = $out['data'];
        if (empty($data['kelompok']) || empty($data['totalKeseluruhan'])) {
            throw new \RuntimeException('laporan kosong (tidak ada kelompok atau total keseluruhan)');
        }

        return $data;
    }

    /** @param  array<string, mixed>  $data */
    private function importData(array $data, object $ulp, string $ym, ?User $user): array
    {
        $year = (int) substr($ym, 0, 4);
        $month = (int) substr($ym, 5, 2);
        $path = tempnam(sys_get_temp_dir(), 'apkt');
        try {
            $this->workbook($data, $this->ulpHeader((string) $ulp->name), $month, $year)->save($path);

            return $this->importer->import($path, sprintf('DIFI-%s-%02d%04d.xlsx', $ulp->code, $month, $year), $user);
        } finally {
            @unlink($path);
        }
    }

    private function ulpHeader(string $name): string
    {
        $n = strtoupper(trim($name));

        return str_starts_with($n, 'ULP ') ? $n : 'ULP '.$n;
    }

    /**
     * Excel bertata letak sama dengan ekspor APKT (judul "LAPORAN SAIDI SAIFI"), tanpa tanggal cetak supaya isi sama menghasilkan sidik sama.
     *
     * @param  array<string, mixed>  $data
     */
    public function workbook(array $data, string $ulpHeader, int $month, int $year): XlsxFile
    {
        $t = $data['totalKeseluruhan'] ?? [];
        $rows = [
            ['PT. PLN (PERSERO)'], [], ['UNIT INDUK : '.config('distriva.apkt.name_uid')], ['UNIT PELAKSANA PELAYANAN PELANGGAN : '.config('distriva.apkt.name_up3')], ['UNIT LAYANAN PELANGGAN : '.$ulpHeader], [],
            ['LAPORAN SAIDI SAIFI'], [self::MONTHS[$month - 1].' '.$year], [],
            ['Jumlah Pelanggan : ', $this->idNum($t['jumlahTotalPelanggan'] ?? 0, 0), '(Plg)'], [],
            ['SAIDI : ', $this->idNum($t['saidi'] ?? 0, 4), '(Jam/Plg)', $this->idNum($t['saidiPelanggan'] ?? 0, 4), '(Menit/Plg)'],
            ['SAIFI : ', $this->idNum($t['saifi'] ?? 0, 4), '(Kali/Plg)'], [],
            [],
            ["NO. KODE\n(a)", "PENYEBAB GANGGUAN\n(b)", "JML PLG PADAM\n(c)", "JAM X JML PELANGGAN PADAM\n(d)", "SAIDI (JAM)\n(e)=(d)/(plg)", "SAIFI (KALI)\n(f)=(c)/(plg)", "JUMLAH GANGGUAN (KALI)\n(h)", "LAMA PADAM (JAM)\n(i)", "KWH TAK TERSALURKAN\n(j)"],
        ];
        array_push($rows, ...$this->tableRows($data));

        $sheet = new Spreadsheet;
        $ws = $sheet->getActiveSheet();
        $ws->setTitle('LAPORAN SAIDI SAIFI');
        foreach ($rows as $ri => $row) {
            foreach ($row as $ci => $v) {
                if ($v === null || $v === '') {
                    continue;
                }
                $coord = chr(65 + $ci).($ri + 1);
                is_int($v) || is_float($v) ? $ws->setCellValueExplicit($coord, $v, DataType::TYPE_NUMERIC) : $ws->setCellValueExplicit($coord, (string) $v, DataType::TYPE_STRING);
            }
        }

        return new XlsxFile($sheet);
    }

    /**
     * Baris tabel dari pohon GraphQL, urutan sama dengan Excel APKT: KELOMPOK > SUB KELOMPOK > FASILITAS > SUB FASILITAS > peralatan, lalu subtotal dan total tiap tingkat.
     *
     * @param  array<string, mixed>  $data
     * @return list<list<mixed>>
     */
    private function tableRows(array $data): array
    {
        $dash = array_fill(0, 7, '-');
        $vals = fn (array $o, string $p): array => array_map(fn ($k) => $o[$p.$k] ?? 0, ['jumlahPelangganPadam', 'jamXJumlahPelangganPadam', 'saidi', 'saifi', 'jumlahGangguan', 'lamaPadam', 'kwhLoss']);
        $rows = [];
        foreach ($data['kelompok'] ?? [] as $k) {
            $rows[] = [$k['id'], 'KELOMPOK '.$k['nama'], ...$dash];
            foreach ($k['subKelompok'] ?? [] as $s) {
                $rows[] = [$s['id'], 'SUB KELOMPOK '.$s['nama'], ...$dash];
                foreach ($s['fasilitas'] ?? [] as $f) {
                    $rows[] = [$f['id'], 'FASILITAS '.$f['nama'], ...$dash];
                    foreach ($f['subFasilitas'] ?? [] as $sf) {
                        $rows[] = [$sf['id'], 'SUB FASILITAS '.$sf['nama'], ...$dash];
                        foreach ($sf['equipment'] ?? [] as $e) {
                            $rows[] = [$e['id'], $e['nama'], ...$vals($e, '')];
                        }
                        $rows[] = [null, 'SUB TOTAL SUB FASILITAS '.$sf['nama'], ...$vals($sf, 'totalSubFasilitas_')];
                    }
                    $rows[] = [null, 'SUB TOTAL FASILITAS '.$f['nama'], ...$vals($f, 'totalFasilitas_')];
                }
                $rows[] = [null, 'TOTAL SUB KELOMPOK '.$s['nama'], ...$vals($s, 'totalSubKelompok_')];
            }
            $rows[] = [null, 'TOTAL KELOMPOK '.$k['nama'], ...$vals($k, 'totalKelompok_')];
        }
        isset($data['totalKeseluruhan']) && $rows[] = [null, 'TOTAL KESELURUHAN', ...$vals($data['totalKeseluruhan'], '')];

        return $rows;
    }

    /** Angka format Indonesia pada kepala laporan: titik ribuan, koma desimal. */
    private function idNum(mixed $v, int $dec): string
    {
        return number_format((float) $v, $dec, ',', '.');
    }

    /** @return list<string> */
    private function months(string $from, string $to): array
    {
        $out = [];
        for ($d = new \DateTimeImmutable($from.'-01'); $d->format('Y-m') <= $to; $d = $d->modify('+1 month')) {
            $out[] = $d->format('Y-m');
        }

        return $out;
    }

    private function tail(string $log): string
    {
        return strlen($log) > self::LOG_LIMIT ? '…'.substr($log, -self::LOG_LIMIT) : $log;
    }
}
