<?php

namespace App\Services\Nko;

use Illuminate\Support\Facades\DB;

/**
 * Menentukan realisasi kumulatif (Januari sampai bulan berjalan) tiap indikator untuk satu unit: masukan manual bila ada, selain itu dari sumber sistem.
 * Sumber sistem saat ini: SAIDI, SAIFI, dan ENS dari laporan DIFI yang diunggah (jumlah bulanan Januari sampai bulan berjalan; ENS dari baris "TOTAL KELOMPOK Distribusi", kWh menjadi MWh).
 * Sumber sistem hanya dipakai bila laporan DIFI semua bulan Januari sampai bulan berjalan tersedia; bila tidak, indikator dibiarkan kosong sampai laporan atau masukan manual ada (docs/90).
 */
class NkoRealizationResolver
{
    /** kode indikator => jenis sumber sistem */
    public const SYSTEM_CODES = ['saidi' => 'saidi_menit', 'saifi' => 'saifi_kali', 'ens' => 'ens_mwh'];

    /**
     * @return array<string, array{value: float, source: string, manual: ?float, system: ?float, note: ?string}> menurut kode indikator
     */
    public function resolve(string $unitId, int $year, int $month): array
    {
        $out = [];
        $system = $this->systemValues($unitId, $year, $month);
        foreach ($system as $code => $v) {
            $out[$code] = ['value' => $v, 'source' => 'SISTEM', 'manual' => null, 'system' => $v, 'note' => null];
        }
        $manual = DB::table('kpi_manual_inputs')->where('organizational_unit_id', $unitId)->where('period', sprintf('%04d-%02d-01', $year, $month))->get(['definition_code', 'value', 'note']);
        foreach ($manual as $m) {
            $out[$m->definition_code] = ['value' => (float) $m->value, 'source' => 'MANUAL', 'manual' => (float) $m->value, 'system' => $out[$m->definition_code]['system'] ?? null, 'note' => $m->note];
        }

        return $out;
    }

    /**
     * @return array<string, float>
     */
    public function systemValues(string $unitId, int $year, int $month): array
    {
        $files = DB::table('eis_report_files')->where('family', 'DIFI')->where('status', 'AKTIF')->where('organizational_unit_id', $unitId)
            ->whereBetween('period', ["{$year}-01-01", sprintf('%04d-%02d-01', $year, $month)])->get(['id', 'summary']);
        if ($files->count() !== $month) {
            return [];
        }
        $saidi = 0.0;
        $saifi = 0.0;
        $ensKwh = 0.0;
        foreach ($files as $f) {
            $summary = json_decode($f->summary ?? '{}', true) ?: [];
            if (! isset($summary['saidi_menit'], $summary['saifi_kali'])) {
                return [];
            }
            $saidi += (float) $summary['saidi_menit'];
            $saifi += (float) $summary['saifi_kali'];
            $line = DB::table('eis_report_lines')->where('file_id', $f->id)->where('label', 'TOTAL KELOMPOK Distribusi')->value('values');
            if ($line === null) {
                return [];
            }
            $ensKwh += (float) (json_decode($line, true)['kwh_tak_tersalurkan'] ?? 0);
        }

        return ['saidi' => $saidi, 'saifi' => $saifi, 'ens' => $ensKwh / 1000];
    }
}
