<?php

namespace App\Services\Nko;

use App\Models\User;
use Illuminate\Contracts\Filesystem\Filesystem;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * Unggah dan persetujuan workbook definisi NKO (docs/93 tahap 5): unggahan hanya disimpan beserta pratinjau perubahannya; definisi berganti setelah disetujui orang lain.
 * Pemanggil mengotorisasi lebih dulu.
 */
class NkoDefinitionUploadService
{
    /** membaca workbook realisasi memerlukan kira-kira 200 MB */
    private const MEMORY_BYTES = 536_870_912;

    public function __construct(private readonly NkoDefinitionImportService $importer, private readonly NkoDefinitionCheckService $checker, private readonly NkoMappingCheckService $mappings) {}

    /**
     * Pemeriksaan tanpa menyimpan (docs/93 §10); `report.can_upload` menentukan apakah unggahan diterima.
     *
     * @return array<string, mixed>
     */
    public function check(UploadedFile $file, int $year): array
    {
        return $this->inspect($file->getRealPath(), $year)['report'];
    }

    /** @throws NkoRuleException 422 beserta hasil pemeriksaan bila workbook tidak lolos */
    public function upload(UploadedFile $file, int $year, string $note, User $actor): string
    {
        ['report' => $report, 'book' => $book] = $this->inspect($file->getRealPath(), $year);
        if (! $report['can_upload']) {
            throw new NkoRuleException('Workbook belum dapat diunggah: '.$report['errors'][0].(count($report['errors']) > 1 ? ' (dan '.(count($report['errors']) - 1).' masalah lain)' : ''), 422, $report);
        }
        if (DB::table('kpi_definition_uploads')->where('year', $year)->where('status', 'MENUNGGU')->exists()) {
            throw new NkoRuleException("Masih ada unggahan definisi {$year} yang menunggu persetujuan. Putuskan atau batalkan dulu.", 409);
        }

        $id = (string) Str::uuid7();
        $key = "nko-workbooks/{$id}.xlsx";
        $this->disk()->put($key, $file->getContent());
        DB::table('kpi_definition_uploads')->insert([
            'id' => $id, 'year' => $year, 'source_name' => mb_substr($file->getClientOriginalName(), 0, 200), 'file_key' => $key,
            'base_sets' => json_encode($this->baseSets($book)), 'changes' => json_encode($report['changes'], JSON_UNESCAPED_UNICODE),
            'check_report' => json_encode(array_diff_key($report, ['changes' => true]), JSON_UNESCAPED_UNICODE), 'note' => $note,
            'uploaded_by' => $actor->id, 'uploaded_at' => now(), 'created_at' => now(), 'updated_at' => now(),
        ]);

        return $id;
    }

    /** @return array{status: string, sets: list<array<string, mixed>>, mapping: ?array<string, mixed>} */
    public function decide(string $id, bool $approve, ?string $note, User $actor): array
    {
        return DB::transaction(function () use ($id, $approve, $note, $actor) {
            $upload = $this->pending($id);
            if ($upload->uploaded_by === $actor->id) {
                throw new NkoRuleException('Pengunggah tidak boleh memutus unggahannya sendiri.', 403);
            }
            if (! $approve) {
                if (trim((string) $note) === '') {
                    throw new NkoRuleException('Alasan penolakan wajib diisi.');
                }
                $this->close($upload, 'DITOLAK', $note, $actor, keepFile: false);

                return ['status' => 'DITOLAK', 'sets' => [], 'mapping' => null];
            }

            $path = tempnam(sys_get_temp_dir(), 'nko');
            try {
                $content = $this->disk()->get($upload->file_key);
                if ($content === null) {
                    throw new NkoRuleException('Berkas unggahan tidak ditemukan di penyimpanan. Batalkan lalu unggah ulang.', 409);
                }
                file_put_contents($path, $content);
                ['report' => $report, 'book' => $book] = $this->inspect($path, (int) $upload->year);
                if (! $report['can_upload']) {
                    throw new NkoRuleException('Workbook tidak lolos pemeriksaan ulang: '.implode(' ', $report['errors']), 409, $report);
                }
                if ($this->baseSets($book) != json_decode($upload->base_sets, true)) {
                    throw new NkoRuleException('Definisi aktif sudah berubah sejak pratinjau dibuat. Batalkan lalu unggah ulang.', 409);
                }
                $result = $this->importer->import($path, $upload->source_name, $actor, $book);
            } finally {
                @unlink($path);
            }
            $this->close($upload, 'DISETUJUI', $note, $actor, keepFile: true);

            return ['status' => 'DISETUJUI', 'sets' => $result['sets'], 'mapping' => $this->mappings->check($result['year'])];
        });
    }

    public function cancel(string $id, User $actor): void
    {
        DB::transaction(function () use ($id, $actor) {
            $upload = $this->pending($id);
            if ($upload->uploaded_by !== $actor->id) {
                throw new NkoRuleException('Hanya pengunggah yang dapat membatalkan.', 403);
            }
            $this->close($upload, 'DIBATALKAN', null, $actor, keepFile: false);
        });
    }

    private function pending(string $id): object
    {
        $upload = DB::table('kpi_definition_uploads')->where('id', $id)->lockForUpdate()->first();
        if ($upload === null) {
            throw new NkoRuleException('Unggahan tidak ditemukan.', 404);
        }
        if ($upload->status !== 'MENUNGGU') {
            throw new NkoRuleException("Unggahan sudah berstatus {$upload->status}.", 409);
        }

        return $upload;
    }

    private function close(object $upload, string $status, ?string $note, User $actor, bool $keepFile): void
    {
        DB::table('kpi_definition_uploads')->where('id', $upload->id)->update([
            'status' => $status, 'decision_note' => $note, 'decided_by' => $actor->id, 'decided_at' => now(), 'updated_at' => now(), 'file_key' => $keepFile ? $upload->file_key : null,
        ]);
        if (! $keepFile) {
            DB::afterCommit(fn () => $this->disk()->delete($upload->file_key));
        }
    }

    /** @return array{report: array<string, mixed>, book: ?array<string, mixed>} */
    private function inspect(string $path, int $year): array
    {
        $this->raiseMemoryLimit();

        return $this->checker->check($path, $year);
    }

    /**
     * @param  array<string, mixed>  $book
     * @return array<string, ?string> tingkat => id set aktif
     */
    private function baseSets(array $book): array
    {
        return array_map(fn (array $plan) => $plan['active']?->id, $book['levels']);
    }

    /** hanya menaikkan; batas yang sudah lebih longgar dibiarkan */
    private function raiseMemoryLimit(): void
    {
        $limit = ini_parse_quantity((string) ini_get('memory_limit'));
        if ($limit > 0 && $limit < self::MEMORY_BYTES) {
            ini_set('memory_limit', (string) self::MEMORY_BYTES);
        }
    }

    private function disk(): Filesystem
    {
        return Storage::disk((string) config('distriva.documents_disk', 'documents'));
    }
}
