<?php

namespace App\Services\Nko;

use App\Models\User;
use Illuminate\Contracts\Filesystem\Filesystem;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Throwable;

/**
 * Unggah dan persetujuan workbook definisi NKO (docs/93 tahap 5): unggahan hanya disimpan beserta pratinjau perubahannya; definisi berganti setelah disetujui orang lain.
 * Pemanggil mengotorisasi lebih dulu.
 */
class NkoDefinitionUploadService
{
    /** membaca workbook realisasi memerlukan kira-kira 200 MB */
    private const MEMORY_BYTES = 536_870_912;

    public function __construct(private readonly NkoDefinitionImportService $importer, private readonly NkoDefinitionDiffService $differ, private readonly NkoMappingCheckService $mappings) {}

    public function upload(UploadedFile $file, string $note, User $actor): string
    {
        $book = $this->analyze($file->getRealPath());
        if (array_intersect(array_column($book['levels'], 'status'), ['BARU', 'DIGANTIKAN']) === []) {
            throw new NkoRuleException('Isi workbook ini sudah pernah dimuat; tidak ada yang berubah.');
        }
        if (DB::table('kpi_definition_uploads')->where('year', $book['year'])->where('status', 'MENUNGGU')->exists()) {
            throw new NkoRuleException("Masih ada unggahan definisi {$book['year']} yang menunggu persetujuan. Putuskan atau batalkan dulu.", 409);
        }

        $id = (string) Str::uuid7();
        $key = "nko-workbooks/{$id}.xlsx";
        $this->disk()->put($key, $file->getContent());
        DB::table('kpi_definition_uploads')->insert([
            'id' => $id, 'year' => $book['year'], 'source_name' => mb_substr($file->getClientOriginalName(), 0, 200), 'file_key' => $key,
            'base_sets' => json_encode($this->baseSets($book)), 'changes' => json_encode($this->differ->diff($book), JSON_UNESCAPED_UNICODE), 'note' => $note,
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
                if ($this->baseSets($this->analyze($path)) != json_decode($upload->base_sets, true)) {
                    throw new NkoRuleException('Definisi aktif sudah berubah sejak pratinjau dibuat. Batalkan lalu unggah ulang.', 409);
                }
                $result = $this->importer->import($path, $upload->source_name, $actor);
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

    /** @return array<string, mixed> */
    private function analyze(string $path): array
    {
        $this->raiseMemoryLimit();
        try {
            return $this->importer->analyze($path);
        } catch (NkoImportException $e) {
            throw new NkoRuleException($e->getMessage());
        } catch (Throwable $e) {
            report($e);
            throw new NkoRuleException('Berkas tidak dapat dibaca sebagai workbook NKO (.xlsx).');
        }
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
