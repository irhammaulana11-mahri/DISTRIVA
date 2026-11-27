<?php

namespace App\Console\Commands;

use App\Services\Inventory\MimsStockSyncService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Http;

/**
 * Satu permintaan baca daftar storage location sebuah plant MIMS dengan token tersimpan milik pengguna. Jawabannya disimpan di folder privat untuk diperiksa;
 * token tidak dicetak dan tidak disimpan. Tidak mengubah data DISTRIVA.
 */
class MimsStorlocProbeCommand extends Command
{
    private const PATH = '/project-i-agodist-api//func_getstorloc_bylogin/{plant}&{type}/';

    protected $signature = 'distriva:mims-storloc-probe {plant : mis. 5118} {--user= : email pengguna yang menyimpan token MIMS (kosong: token yang terakhir berhasil)} {--type=8}';

    protected $description = 'Membaca daftar storage location satu plant dari MIMS (hanya baca).';

    public function handle(): int
    {
        $plant = (string) $this->argument('plant');
        $type = (string) $this->option('type');
        if (! preg_match('/^\d{4}$/', $plant) || ! preg_match('/^\d{1,3}$/', $type)) {
            $this->error('Plant harus 4 angka dan type angka.');

            return self::FAILURE;
        }
        $query = DB::table('user_mims_tokens as t')->join('users as u', 'u.id', '=', 't.user_id');
        $row = $this->option('user') !== null
            ? $query->where('u.email', (string) $this->option('user'))->first(['t.token_encrypted', 'u.name'])
            : $query->where('t.last_result', 'OK')->orderByDesc('t.last_used_at')->first(['t.token_encrypted', 'u.name']);
        if ($row === null) {
            $this->error('Token MIMS tersimpan tidak ditemukan (simpan token di halaman Tarik Stok MIMS dulu).');

            return self::FAILURE;
        }
        $token = Crypt::decryptString($row->token_encrypted);
        $url = rtrim((string) config('distriva.mims.base_url'), '/').strtr(self::PATH, ['{plant}' => $plant, '{type}' => $type]);
        $this->line("Memakai token tersimpan milik {$row->name}. GET {$url}");
        try {
            $res = Http::withHeaders(['auth-token' => $token, 'Accept' => 'application/json'])->withOptions(['verify' => (bool) config('distriva.mims.verify_ssl')])
                ->timeout((int) config('distriva.mims.timeout_seconds'))->get($url);
        } catch (\Throwable $e) {
            $this->error(MimsStockSyncService::connectionMessage($e));

            return self::FAILURE;
        }
        $body = str_replace($token, '[token]', $res->body());
        $this->line('HTTP '.$res->status().', '.strlen($body).' byte.');
        if (! $res->successful()) {
            $this->error(in_array($res->status(), [401, 403], true) ? 'Token ditolak atau kedaluwarsa.' : 'MIMS menolak permintaan.');

            return self::FAILURE;
        }
        File::ensureDirectoryExists(storage_path('app/private/mims'), 0700);
        $file = storage_path("app/private/mims/storloc-{$plant}.json");
        File::put($file, $body);
        $json = json_decode($body, true);
        // bentuk jawaban: {gudang: {data: [...]}}; baris tanpa storage location ("PILIH") bukan gudang
        $items = array_values(array_filter((array) data_get($json, 'gudang.data', []), fn ($item) => ! empty($item['stor_loc'])));
        $this->line('Disimpan: '.$file);
        $this->line('Kunci jawaban: '.(is_array($json) ? implode(', ', array_slice(array_map('strval', array_keys($json)), 0, 15)) : 'bukan JSON'));
        $this->line('Gudang: '.count($items));
        foreach (array_slice($items, 0, 3) as $item) {
            $this->line('  '.json_encode($item, JSON_UNESCAPED_UNICODE));
        }

        return self::SUCCESS;
    }
}
