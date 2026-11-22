<?php

namespace App\Services\Authorization;

use Illuminate\Database\Query\Builder;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * The UP3 / ULP filter of the list screens: `unit_id` = one unit, `up3_id` = a UP3 together with the ULPs below it. It only narrows what the actor's scope already allows
 * (call it after the scope has been applied); a unit outside the scope simply yields nothing.
 */
final class UnitFilter
{
    /** @return array<string,list<string>> */
    public static function rules(): array
    {
        return ['unit_id' => ['nullable', 'uuid'], 'up3_id' => ['nullable', 'uuid']];
    }

    /** @param Builder $q @param string $column the unit column of the listed rows, e.g. a.organizational_unit_id */
    public static function apply($q, Request $request, string $column): void
    {
        $request->filled('unit_id') && $q->where($column, $request->query('unit_id'));
        $request->filled('up3_id') && $q->whereIn($column, DB::table('organizational_units')->where('id', $request->query('up3_id'))->orWhere('parent_id', $request->query('up3_id'))->select('id'));
    }
}
