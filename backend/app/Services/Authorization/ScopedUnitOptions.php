<?php

namespace App\Services\Authorization;

use App\Models\User;
use Illuminate\Support\Facades\DB;

/** UP3 and ULP choices a user may pick in a filter, by role and scope (global, UP3, or ULP). */
class ScopedUnitOptions
{
    public function __construct(private readonly ApplicationAuthorizer $authorizer) {}

    /**
     * @return array{scope:string,up3_units:list<array<string,mixed>>,ulp_units:list<array<string,mixed>>,default_up3_id:string,default_unit_id:string}
     */
    public function for(User $actor, string $permission): array
    {
        $scope = $this->authorizer->authorizeScope($actor, $permission);

        // 1. SYS_ADMIN / Global Unrestricted
        if ($scope['unrestricted']) {
            $up3s = DB::table('organizational_units')
                ->where('unit_type', 'UP3')
                ->where('is_active', true)
                ->orderBy('code')
                ->get(['id', 'code', 'name'])
                ->all();

            $ulps = DB::table('organizational_units as u')
                ->leftJoin('organizational_units as p', 'p.id', '=', 'u.parent_id')
                ->where('u.unit_type', 'ULP')
                ->where('u.is_active', true)
                ->orderBy('u.code')
                ->select([
                    'u.id',
                    'u.code',
                    'u.name',
                    'u.parent_id',
                    'p.code as parent_code',
                    'p.name as parent_name',
                ])
                ->get()
                ->all();

            return [
                'scope' => 'GLOBAL',
                'up3_units' => $up3s,
                'ulp_units' => $ulps,
                'default_up3_id' => '',
                'default_unit_id' => '',
            ];
        }

        // 2. Scoped users: Check whether UP3 or ULP level
        $scopedUnitIds = $scope['units'];
        $assignedUp3 = null;
        $assignedUlp = null;

        foreach ($this->authorizer->effectiveAssignments($actor) as $assignment) {
            $u = $assignment->organizationalUnit;
            if ($u === null || $assignment->role?->name === 'VENDOR') {
                continue;
            }
            if ($u->unit_type === 'UP3') {
                $assignedUp3 = $u;
                break;
            }
            if ($u->unit_type === 'ULP') {
                $assignedUlp = $u;
            }
        }

        // Case A: User assigned at UP3 level
        if ($assignedUp3 !== null) {
            $up3s = [
                [
                    'id' => $assignedUp3->getKey(),
                    'code' => $assignedUp3->code,
                    'name' => $assignedUp3->name,
                ],
            ];

            $ulps = DB::table('organizational_units as u')
                ->where('u.parent_id', $assignedUp3->getKey())
                ->where('u.unit_type', 'ULP')
                ->where('u.is_active', true)
                ->whereIn('u.id', $scopedUnitIds)
                ->orderBy('u.code')
                ->select([
                    'u.id',
                    'u.code',
                    'u.name',
                    'u.parent_id',
                ])
                ->get()
                ->map(fn ($r) => [
                    'id' => $r->id,
                    'code' => $r->code,
                    'name' => $r->name,
                    'parent_id' => $r->parent_id,
                    'parent_code' => $assignedUp3->code,
                    'parent_name' => $assignedUp3->name,
                ])
                ->all();

            return [
                'scope' => 'UP3',
                'up3_units' => $up3s,
                'ulp_units' => $ulps,
                'default_up3_id' => $assignedUp3->getKey(),
                'default_unit_id' => '',
            ];
        }

        // Case B: User assigned at ULP level
        $ulpQuery = DB::table('organizational_units as u')
            ->leftJoin('organizational_units as p', 'p.id', '=', 'u.parent_id')
            ->where('u.unit_type', 'ULP')
            ->whereIn('u.id', $scopedUnitIds)
            ->where('u.is_active', true)
            ->select([
                'u.id',
                'u.code',
                'u.name',
                'u.parent_id',
                'p.code as parent_code',
                'p.name as parent_name',
            ])
            ->get();

        $up3sMap = [];
        $ulps = [];
        foreach ($ulpQuery as $row) {
            $ulps[] = [
                'id' => $row->id,
                'code' => $row->code,
                'name' => $row->name,
                'parent_id' => $row->parent_id,
                'parent_code' => $row->parent_code,
                'parent_name' => $row->parent_name,
            ];
            if ($row->parent_id && ! isset($up3sMap[$row->parent_id])) {
                $up3sMap[$row->parent_id] = [
                    'id' => $row->parent_id,
                    'code' => $row->parent_code ?? '',
                    'name' => $row->parent_name ?? 'UP3 Terkait',
                ];
            }
        }

        return [
            'scope' => 'ULP',
            'up3_units' => array_values($up3sMap),
            'ulp_units' => $ulps,
            'default_up3_id' => array_values($up3sMap)[0]['id'] ?? '',
            'default_unit_id' => $ulps[0]['id'] ?? '',
        ];
    }
}
