<?php

namespace App\Services\Nko;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use InvalidArgumentException;

/**
 * Usulan dan persetujuan aturan realisasi NKO (docs/93 tahap 4). Aturan hanya berubah lewat persetujuan, dan pengusul tidak boleh memutus usulannya sendiri. Pemanggil mengotorisasi lebih dulu.
 */
class NkoRuleProposalService
{
    public const MODES = ['SISTEM', 'SISTEM_BOLEH_KOREKSI', 'MANUAL'];

    private const INPUT_CODE = '/^[a-z][a-z0-9_]{1,59}$/';

    public function __construct(private readonly NkoRealizationRules $rules) {}

    /**
     * Periksa isi aturan; dipakai saat mengusulkan, menyetujui, dan pratinjau.
     *
     * @param  array{definition_code: string, mode: string, formula: ?string, inputs: list<array{code: string, name: string, unit_label: ?string}>, effective_from: string, replaces_code: ?string}  $rule  `effective_from` = tanggal 1 bulan
     * @return list<string> pesan galat; kosong bila sah
     */
    public function errors(array $rule): array
    {
        $errors = [];
        $year = (int) substr($rule['effective_from'], 0, 4);
        $month = (int) substr($rule['effective_from'], 5, 2);
        $needsRealisasi = DB::table('kpi_definitions as d')->join('kpi_definition_sets as s', 's.id', '=', 'd.set_id')->where('s.year', $year)->where('s.status', 'AKTIF')
            ->where('d.code', $rule['definition_code'])->whereNotNull('d.source_sheet')->where('d.source_sheet', '<>', '')->exists();
        if (! $needsRealisasi) {
            $errors[] = "Indikator {$rule['definition_code']} tidak ada di definisi NKO {$year} atau tidak membutuhkan realisasi.";
        }
        if (! in_array($rule['mode'], self::MODES, true)) {
            $errors[] = 'Mode harus salah satu dari: '.implode(', ', self::MODES).'.';
        }
        if ($rule['replaces_code'] !== null && ($rule['replaces_code'] === $rule['definition_code'] || ! isset($this->rules->forPeriod($year, $month)[$rule['replaces_code']]))) {
            $errors[] = 'Kode yang digantikan harus indikator lain yang sudah punya aturan.';
        }
        $formula = trim((string) $rule['formula']);
        if ($rule['mode'] === 'MANUAL') {
            return $formula === '' && $rule['inputs'] === [] ? $errors : [...$errors, 'Mode MANUAL tidak memakai rumus atau masukan.'];
        }
        if ($formula === '') {
            return [...$errors, 'Rumus wajib diisi.'];
        }
        try {
            $used = NkoFormula::parse($formula)->variables();
        } catch (InvalidArgumentException $e) {
            return [...$errors, $e->getMessage()];
        }

        $declared = array_column($rule['inputs'], 'code');
        if (count($declared) !== count(array_unique($declared))) {
            $errors[] = 'Kode masukan tidak boleh kembar.';
        }
        foreach ($declared as $code) {
            if (! preg_match(self::INPUT_CODE, $code) || isset(NkoSourceCatalog::QUANTITIES[$code]) || isset(NkoFormula::FUNCTIONS[$code]) || DB::table('kpi_definitions')->where('code', $code)->exists()) {
                $errors[] = "Kode masukan \"{$code}\" tidak sah: huruf kecil, angka, garis bawah, dan tidak sama dengan nama besaran, fungsi, atau indikator.";
            }
            if (! in_array($code, $used, true)) {
                $errors[] = "Masukan \"{$code}\" tidak dipakai rumus.";
            }
        }
        $unknown = array_diff($used, array_keys(NkoSourceCatalog::QUANTITIES), $declared);
        if ($unknown !== []) {
            $errors[] = 'Nama tidak dikenal pada rumus: '.implode(', ', $unknown).'.';
        }

        return $errors;
    }

    /** @param  array<string, mixed>  $rule  seperti `errors()` ditambah is_validated, flag_when_negative, reason */
    public function propose(array $rule, User $actor): string
    {
        $this->assertValid($rule);
        $pending = DB::table('kpi_rule_proposals')->where('definition_code', $rule['definition_code'])->where('effective_from', $rule['effective_from'])->where('status', 'MENUNGGU')->exists();
        if ($pending) {
            throw new NkoRuleException('Masih ada usulan yang menunggu untuk indikator dan bulan berlaku ini.', 409);
        }
        $id = (string) Str::uuid7();
        DB::table('kpi_rule_proposals')->insert([
            'id' => $id, 'definition_code' => $rule['definition_code'], 'mode' => $rule['mode'], 'formula' => $rule['mode'] === 'MANUAL' ? null : trim($rule['formula']),
            'inputs' => $rule['inputs'] === [] ? null : json_encode($rule['inputs'], JSON_UNESCAPED_UNICODE), 'is_validated' => $rule['is_validated'], 'flag_when_negative' => $rule['flag_when_negative'],
            'effective_from' => $rule['effective_from'], 'replaces_code' => $rule['replaces_code'], 'reason' => $rule['reason'], 'status' => 'MENUNGGU',
            'proposed_by' => $actor->id, 'proposed_at' => now(), 'created_at' => now(), 'updated_at' => now(),
        ]);

        return $id;
    }

    /** @return array{status: string, copied_inputs: int} `copied_inputs` = masukan manual kode lama yang disalin ke kode baru */
    public function decide(string $id, bool $approve, ?string $note, User $actor): array
    {
        return DB::transaction(function () use ($id, $approve, $note, $actor) {
            $p = $this->pending($id);
            if ($p->proposed_by === $actor->id) {
                throw new NkoRuleException('Pengusul tidak boleh memutus usulannya sendiri.', 409);
            }
            if (! $approve && trim((string) $note) === '') {
                throw new NkoRuleException('Alasan penolakan wajib diisi.');
            }
            $copied = 0;
            if ($approve) {
                $inputs = json_decode($p->inputs ?? '[]', true);
                $this->assertValid(['definition_code' => $p->definition_code, 'mode' => $p->mode, 'formula' => $p->formula, 'inputs' => $inputs, 'effective_from' => $p->effective_from, 'replaces_code' => $p->replaces_code]);   // definisi bisa sudah berubah sejak diusulkan
                $this->activate($p);
                $copied = $p->replaces_code === null ? 0 : $this->copyManualInputs($p->replaces_code, $p->definition_code, $p->effective_from);
            }
            $status = $approve ? 'DISETUJUI' : 'DITOLAK';
            DB::table('kpi_rule_proposals')->where('id', $id)->update(['status' => $status, 'decided_by' => $actor->id, 'decided_at' => now(), 'decision_note' => $note, 'updated_at' => now()]);

            return ['status' => $status, 'copied_inputs' => $copied];
        });
    }

    public function cancel(string $id, User $actor): void
    {
        DB::transaction(function () use ($id, $actor) {
            if ($this->pending($id)->proposed_by !== $actor->id) {
                throw new NkoRuleException('Hanya pengusul yang dapat membatalkan usulan ini.', 409);
            }
            DB::table('kpi_rule_proposals')->where('id', $id)->update(['status' => 'DIBATALKAN', 'decided_by' => $actor->id, 'decided_at' => now(), 'updated_at' => now()]);
        });
    }

    private function pending(string $id): object
    {
        $p = DB::table('kpi_rule_proposals')->where('id', $id)->lockForUpdate()->first();
        if ($p === null) {
            throw new NkoRuleException('Data tidak ditemukan.', 404);
        }
        if ($p->status !== 'MENUNGGU') {
            throw new NkoRuleException("Usulan sudah berstatus {$p->status}.", 409);
        }

        return $p;
    }

    private function assertValid(array $rule): void
    {
        $errors = $this->errors($rule);
        if ($errors !== []) {
            throw new NkoRuleException(implode(' ', $errors));
        }
    }

    private function activate(object $p): void
    {
        $key = ['definition_code' => $p->definition_code, 'effective_from' => $p->effective_from];
        $data = ['mode' => $p->mode, 'formula' => $p->formula, 'inputs' => $p->inputs, 'is_validated' => $p->is_validated, 'flag_when_negative' => $p->flag_when_negative, 'replaces_code' => $p->replaces_code, 'updated_at' => now()];
        DB::table('kpi_realization_rules')->where($key)->exists()
            ? DB::table('kpi_realization_rules')->where($key)->update($data)
            : DB::table('kpi_realization_rules')->insert($key + $data + ['id' => (string) Str::uuid7(), 'created_at' => now()]);
    }

    /** salin (bukan pindah) masukan manual kode lama sejak bulan berlaku; yang sudah ada pada kode baru tidak ditimpa */
    private function copyManualInputs(string $from, string $to, string $effectiveFrom): int
    {
        $rows = DB::table('kpi_manual_inputs')->where('definition_code', $from)->where('period', '>=', $effectiveFrom)->get();
        $copied = 0;
        foreach ($rows as $row) {
            $copied += DB::table('kpi_manual_inputs')->insertOrIgnore(['id' => (string) Str::uuid7(), 'definition_code' => $to] + array_diff_key((array) $row, ['id' => null, 'definition_code' => null]));
        }

        return $copied;
    }
}
