<?php

namespace App\Services\Outages;

use App\Exceptions\AssignmentRuleViolation;
use Illuminate\Support\Facades\Http;

/**
 * Mengunduh satu tab Google Sheet sebagai CSV (sheet harus dapat dibaca siapa saja yang punya tautan). Hanya docs.google.com lewat HTTPS; ID dan gid divalidasi.
 * ID dan alamat tidak pernah dimasukkan ke pesan galat atau log (tautan sheet dianggap tidak untuk disebar).
 */
class OutageSheetClient
{
    /** @return array{sheet_id:string,gid:?string} dari alamat Google Sheet atau ID mentah */
    public static function parse(string $input): array
    {
        $in = trim($input);
        if (preg_match('#^https?://docs\.google\.com/spreadsheets/d/([A-Za-z0-9_-]{20,100})#', $in, $m)) {
            preg_match('/[#?&]gid=(\d+)/', $in, $g);

            return ['sheet_id' => $m[1], 'gid' => $g[1] ?? null];
        }
        if (preg_match('/^[A-Za-z0-9_-]{20,100}$/', $in)) {
            return ['sheet_id' => $in, 'gid' => null];
        }
        throw new AssignmentRuleViolation('Alamat Google Sheet tidak dikenali: tempel alamat dari peramban (docs.google.com/spreadsheets/d/...).');
    }

    public function fetchCsv(string $sheetId, int $gid): string
    {
        if (! preg_match('/^[A-Za-z0-9_-]{20,100}$/', $sheetId)) {
            throw new AssignmentRuleViolation('ID Google Sheet tidak valid.');
        }
        $url = "https://docs.google.com/spreadsheets/d/{$sheetId}/export?format=csv&gid={$gid}";
        try {
            $r = Http::timeout((int) config('distriva.outage.timeout_seconds', 120))->retry(2, 1500, throw: false)
                ->withOptions(['allow_redirects' => ['max' => 5, 'protocols' => ['https']]])->withHeaders(['Accept' => 'text/csv'])->get($url);
        } catch (\Throwable) {
            throw new AssignmentRuleViolation('Tidak dapat menghubungi Google Sheet; periksa jaringan server.');
        }
        if ($r->status() === 404 || $r->status() === 403 || $r->status() === 401) {
            throw new AssignmentRuleViolation("Tab (gid {$gid}) tidak dapat dibaca (HTTP {$r->status()}): periksa bahwa sheet dapat dibuka siapa saja yang punya tautan dan bahwa gid-nya benar.");
        }
        if (! $r->successful()) {
            throw new AssignmentRuleViolation("Google Sheet menjawab HTTP {$r->status()}.");
        }
        $body = $r->body();
        if (strlen($body) > (int) config('distriva.outage.max_bytes', 30 * 1024 * 1024)) {
            throw new AssignmentRuleViolation('Berkas sheet terlalu besar.');
        }
        if (stripos(ltrim($body), '<!doctype html') === 0 || stripos(ltrim($body), '<html') === 0) {
            throw new AssignmentRuleViolation("Tab (gid {$gid}) tidak mengembalikan CSV (kemungkinan sheet tidak dibagikan publik).");
        }

        return $body;
    }
}
