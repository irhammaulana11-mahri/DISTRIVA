<?php

namespace App\Services\Inventory;

use Illuminate\Support\Facades\DB;

/**
 * Who supplies each material: PLN (PLN/MDU material, taken from a warehouse) or VENDOR (priced in the RAB, supplied by the vendor under the SPK). Read from the latest RAB run of the
 * package (the frozen basis); with no RAB run yet, from the price book valid today. A material that cannot be found is simply missing from the result (unknown).
 */
class MaterialSupplier
{
    /**
     * @param  list<string>  $khsIds
     * @return array<string,'PLN'|'VENDOR'>
     */
    public static function of(string $packageId, array $khsIds): array
    {
        $run = DB::table('rab_runs')->where('mto_package_id', $packageId)->orderByDesc('run_number')->value('id');
        $status = $run !== null
            ? DB::table('rab_run_lines')->where('rab_run_id', $run)->whereIn('khs_item_id', $khsIds)->whereNotNull('material_status')->pluck('material_status', 'khs_item_id')
            : (function () use ($khsIds) {
                $today = now(config('distriva.business_timezone'))->toDateString();
                $book = DB::table('price_books')->where('status', 'APPROVED')->where('valid_from', '<=', $today)->where(fn ($q) => $q->whereNull('valid_until')->orWhere('valid_until', '>=', $today))->value('id');

                return $book === null ? collect() : DB::table('price_book_items')->where('price_book_id', $book)->whereIn('khs_item_id', $khsIds)->pluck('material_status', 'khs_item_id');
            })();

        return $status->map(fn ($st) => $st === 'PRICED' ? 'VENDOR' : 'PLN')->all();
    }
}
