<?php

namespace App\Services\Inventory;

use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;

/**
 * Mirrors the material receipts (penerimaan) of ONE warehouse from MIMS, read-only (docs/82 §19.15): the deliveries to the warehouse (GET getDataPengirimanForPenerimaan, status_penerimaan DITERIMA = the goods are in
 * the warehouse) and, for received ones, the lines (GET getDataPenerimaanAll/{delivery document}). A delivery not yet received is kept as it is and picked up once it is received. Only deliveries inside the window
 * (`DISTRIVA_MIMS_ISSUE_DAYS`) are kept. It is history: the stock itself comes from the stock pull.
 */
class MimsReceiptSyncService
{
    /** @return array{status:string,message:?string,documents_new:int,lines:int} */
    public function syncWarehouse(object $wh, ?string $token, ?User $triggeredBy = null, ?int $days = null, ?string $from = null, ?string $to = null): array
    {
        $started = now();
        $finish = function (string $status, ?string $message, int $docs = 0, int $lines = 0) use ($wh, $started, $triggeredBy): array {
            DB::table('mims_receipt_sync_runs')->insert(['id' => (string) Str::uuid(), 'warehouse_id' => $wh->id, 'status' => $status, 'message' => $message === null ? null : mb_substr($message, 0, 1000), 'documents_new' => $docs, 'lines' => $lines,
                'triggered_by' => $triggeredBy?->getKey(), 'started_at' => $started, 'finished_at' => now()]);

            return ['status' => $status, 'message' => $message, 'documents_new' => $docs, 'lines' => $lines];
        };
        if ($wh->plant === null || $wh->stor_loc === null) {
            return $finish('SKIPPED', 'Gudang belum memiliki plant dan storage location ERP.');
        }
        $base = rtrim((string) config('distriva.mims.base_url'), '/');
        $make = fn (int $seconds) => Http::withHeaders(['auth-token' => (string) ($token ?? config('distriva.mims.auth_token')), 'Accept' => 'application/json'])->withOptions(['verify' => (bool) config('distriva.mims.verify_ssl')])->timeout($seconds);
        $http = fn () => $make((int) config('distriva.mims.mirror_timeout_seconds'));
        $one = fn () => $make((int) config('distriva.mims.detail_timeout_seconds'));
        $now = CarbonImmutable::now((string) config('distriva.business_timezone'));
        $since = $from ?? $now->subDays($days ?? (int) config('distriva.mims.issue_days'))->toDateString();
        $until = $to ?? $now->toDateString();
        try {
            $res = MimsStockSyncService::fetch($http, $base.strtr((string) config('distriva.mims.receipt_list_path'), ['{plant}' => rawurlencode((string) $wh->plant), '{stor_loc}' => rawurlencode((string) $wh->stor_loc), '{from}' => CarbonImmutable::parse($since)->format('d-m-Y'), '{to}' => CarbonImmutable::parse($until)->format('d-m-Y')]));
        } catch (\Throwable $e) {
            return $finish('FAILED', MimsStockSyncService::connectionMessage($e, 'mengambil daftar penerimaan'));
        }
        if (! $res->successful()) {
            return $finish('FAILED', 'MIMS menjawab status HTTP '.$res->status().($res->status() === 401 || $res->status() === 403 ? ' (token ditolak atau kedaluwarsa).' : '.'));
        }
        $headers = $res->json('data');
        if (! is_array($headers)) {
            return $finish('FAILED', 'Jawaban MIMS tidak memuat daftar penerimaan (data).');
        }
        $known = DB::table('mims_receipt_documents')->where('warehouse_id', $wh->id)->pluck('status', 'delivery_document');
        $docs = 0;
        $lines = 0;
        $skipped = [];
        $slow = 0;
        foreach ($headers as $h) {
            $h = (array) $h;
            $doc = trim((string) ($h['material_document'] ?? ''));
            $delivered = $this->date($h['tgl_pengiriman'] ?? $h['tgl_transaksi'] ?? null);
            $status = mb_strtoupper(trim((string) ($h['status_penerimaan'] ?? '')));
            if ($doc === '' || $delivered === null || $delivered < $since || $delivered > $until || $status === '' || (isset($known[$doc]) && $known[$doc] === $status)) {
                continue;
            }
            $received = null;
            $rows = [];
            $receiptDoc = $this->str($h['material_document_penerimaan'] ?? null, 30);
            if ($status === 'DITERIMA') {
                try {
                    $detail = MimsStockSyncService::fetch($one, $base.strtr((string) config('distriva.mims.receipt_detail_path'), ['{document}' => rawurlencode($doc)]));
                    $slow = 0;
                } catch (\Throwable $e) {
                    $skipped[] = 'dokumen '.$doc.': '.MimsStockSyncService::connectionMessage($e, 'mengambil detail penerimaan');
                    if (++$slow >= 2) {
                        return $finish($docs > 0 ? 'OK' : 'FAILED', 'MIMS tidak menjawab detail penerimaan dua kali berturut-turut ('.implode(' | ', array_slice($skipped, -2)).'). Sisanya ditarik pada penarikan berikutnya.', $docs, $lines);
                    }

                    continue;
                }
                if (in_array($detail->status(), [401, 403], true)) {
                    return $finish('FAILED', 'MIMS menjawab status HTTP '.$detail->status().' (token ditolak atau kedaluwarsa).', $docs, $lines);
                }
                if (! $detail->successful()) {
                    $skipped[] = 'dokumen '.$doc.': HTTP '.$detail->status();

                    continue;
                }
                $rows = (array) ($detail->json('Detail.data') ?? $detail->json('detail.data') ?? []);
                $received = $this->date($detail->json('Header.data.0.tgl_penerimaan') ?? $detail->json('header.data.0.tgl_penerimaan')) ?? $delivered;
                $receiptDoc ??= $this->str($detail->json('Header.data.0.material_document') ?? null, 30);
            }
            $lines += DB::transaction(function () use ($wh, $doc, $h, $status, $delivered, $received, $receiptDoc, $rows, $known): int {
                $values = ['receipt_document' => $receiptDoc, 'request_document' => $this->str($h['material_document_permintaan'] ?? null, 30), 'origin_stor_loc' => $this->str($h['stor_loc_asal'] ?? null, 10), 'origin_name' => $this->str($h['stor_loc_asal_name'] ?? null, 100),
                    'status' => $status, 'delivered_on' => $delivered, 'received_on' => $received, 'sap_document' => $this->str($h['mat_doc_sap'] ?? null, 30), 'fetched_at' => now()];
                if (isset($known[$doc])) {
                    DB::table('mims_receipt_documents')->where('delivery_document', $doc)->update($values);
                } else {
                    DB::table('mims_receipt_documents')->insert(['id' => (string) Str::uuid(), 'warehouse_id' => $wh->id, 'delivery_document' => $doc] + $values);
                }
                DB::table('mims_receipt_lines')->where('delivery_document', $doc)->delete();
                $count = 0;
                foreach ($rows as $row) {
                    $row = (array) $row;
                    $no = ltrim(trim((string) ($row['material_no'] ?? '')), '0');
                    $received = is_numeric($row['qty_penerimaan'] ?? null) ? (float) $row['qty_penerimaan'] : 0.0;
                    $sent = is_numeric($row['qty_pengiriman'] ?? null) ? (float) $row['qty_pengiriman'] : $received;
                    if ($no === '' || ($received <= 0 && $sent <= 0)) {
                        continue;
                    }
                    DB::table('mims_receipt_lines')->insert(['id' => (string) Str::uuid(), 'warehouse_id' => $wh->id, 'delivery_document' => $doc, 'material_no' => $no, 'material_name' => $this->str($row['material_desc'] ?? null, 255), 'quantity_sent' => $sent, 'quantity_received' => $received, 'unit' => $this->str($row['satuan'] ?? null, 30)]);
                    $count++;
                }

                return $count;
            });
            $docs += isset($known[$doc]) ? 0 : 1;
        }

        if ($skipped !== []) {
            $note = count($skipped).' dokumen dilewati ('.implode('; ', array_slice($skipped, 0, 3)).(count($skipped) > 3 ? '; …' : '').').';

            return $finish($docs > 0 ? 'OK' : 'FAILED', $note, $docs, $lines);
        }

        return $finish('OK', null, $docs, $lines);
    }

    private function date(mixed $v): ?string
    {
        $v = trim((string) $v);
        if ($v === '') {
            return null;
        }
        foreach (['d-m-Y', 'Y-m-d', 'Y-m-d H:i:s'] as $f) {
            $d = \DateTimeImmutable::createFromFormat('!'.$f, $v);
            if ($d !== false && $d->format($f) === $v) {
                return $d->format('Y-m-d');
            }
        }

        return null;
    }

    private function str(mixed $v, int $max): ?string
    {
        $v = trim((string) $v);

        return $v === '' ? null : mb_substr($v, 0, $max);
    }
}
