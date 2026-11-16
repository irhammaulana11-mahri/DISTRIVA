<?php

namespace App\Http\Controllers\Admin;

use App\Exceptions\AdministrationDenied;
use App\Exceptions\AssignmentRuleViolation;
use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\AssignRoleRequest;
use App\Models\OrganizationalUnit;
use App\Models\Role;
use App\Models\User;
use App\Models\UserRoleAssignment;
use App\Services\Authorization\AccountStatusService;
use App\Services\Authorization\AdministrationAuthorizer;
use App\Services\Authorization\AssignmentWriteService;
use App\Services\MfaService;
use App\Services\Notifications\DeliveryReport;
use App\Services\OrganizationalUnitWriteService;
use App\Services\UserProvisioningService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;

class AdminController extends Controller
{
    public function __construct(private readonly AdministrationAuthorizer $authorizer) {}

    /** What the UI may offer. Pure convenience: every action is re-authorized server-side. */
    public function access(Request $request): JsonResponse
    {
        $actor = $request->user();
        $systemWritesOpen = app(MfaService::class)->satisfied($actor);
        $can = [];
        $write = [];

        foreach (array_keys((array) config('distriva_permissions.foundation')) as $key) {
            $scope = $this->authorizer->scopeFor($actor, $key);
            $can[$key] = $scope['unrestricted'] || $scope['units'] !== [];
            $write[$key] = $can[$key] && (! $scope['unrestricted'] || $systemWritesOpen);
        }

        return response()->json(['can' => $can, 'can_write' => $write]);
    }

    public function roles(Request $request): JsonResponse
    {
        $scope = $this->authorizer->authorizeView($request->user(), 'role_assignments.assign');
        $query = Role::query()->where('guard_name', config('distriva.authorization_guard'))->orderBy('name');
        if (! $scope['unrestricted']) {
            $query->whereNotIn('name', (array) config('distriva_permissions.up3_admin_forbidden_roles'));
        }

        return response()->json(['data' => $query->get(['id', 'name'])->map(fn (Role $r) => ['id' => $r->getKey(), 'name' => $r->name])->all()]);
    }

    public function user(Request $request, string $user): JsonResponse
    {
        $scope = $this->authorizer->authorizeView($request->user(), 'users.view');
        $target = User::query()
            ->with(['roleAssignments' => fn ($q) => $q->where('is_active', true)->with(['role', 'organizationalUnit'])])
            ->find($user);

        $visible = $target !== null && ($scope['unrestricted'] || UserRoleAssignment::query()
            ->where('user_id', $target->getKey())->whereIn('organizational_unit_id', $scope['units'])->exists());

        if (! $visible) {
            return response()->json(['message' => 'Data tidak ditemukan.'], 404);
        }

        return response()->json(['data' => $this->userView($target)]);
    }

    public function units(Request $request): JsonResponse
    {
        $scope = $this->run(fn () => $this->authorizer->authorizeView($request->user(), 'organizational_units.view'));
        $request->validate([
            'unit_type' => ['nullable', 'string', Rule::in(['UP3', 'ULP'])],
            'search' => ['nullable', 'string', 'max:100'],
        ]);

        $query = OrganizationalUnit::query()->with('parent:id,code,name')->orderBy('unit_type')->orderBy('code');
        if (! $scope['unrestricted']) {
            $query->whereIn('id', $scope['units']); // scope before paginate/count
        }

        if ($request->filled('unit_type')) {
            $query->where('unit_type', $request->query('unit_type'));
        }
        if ($request->filled('search')) {
            $term = '%'.str_replace(['%', '_'], ['\%', '\_'], $request->query('search')).'%';
            $query->where(fn ($q) => $q->where('name', 'ilike', $term)->orWhere('code', 'ilike', $term));
        }

        return $this->page($query->paginate($this->perPage($request)), fn (OrganizationalUnit $u) => [
            'id' => $u->getKey(),
            'code' => $u->code,
            'name' => $u->name,
            'unit_type' => $u->unit_type,
            'parent_id' => $u->parent_id,
            'parent_name' => $u->parent?->name,
            'parent_code' => $u->parent?->code,
            'address' => $u->address,
            'is_active' => (bool) $u->is_active,
        ]);
    }

    public function unit(Request $request, string $unit): JsonResponse
    {
        $scope = $this->run(fn () => $this->authorizer->authorizeView($request->user(), 'organizational_units.view'));
        $target = OrganizationalUnit::query()->with(['parent:id,code,name', 'children:id,parent_id,code,name,unit_type,is_active'])->find($unit);

        $visible = $target !== null && ($scope['unrestricted'] || in_array($target->getKey(), $scope['units'], true));

        if (! $visible) {
            return response()->json(['message' => 'Data tidak ditemukan.'], 404);
        }

        $histories = DB::table('organizational_unit_histories')
            ->leftJoin('users', 'users.id', '=', 'organizational_unit_histories.changed_by')
            ->where('organizational_unit_id', $target->getKey())
            ->orderByDesc('changed_at')
            ->get([
                'organizational_unit_histories.id',
                'organizational_unit_histories.old_code',
                'organizational_unit_histories.new_code',
                'organizational_unit_histories.old_name',
                'organizational_unit_histories.new_name',
                'organizational_unit_histories.old_unit_type',
                'organizational_unit_histories.new_unit_type',
                'organizational_unit_histories.old_is_active',
                'organizational_unit_histories.new_is_active',
                'organizational_unit_histories.reason',
                'organizational_unit_histories.changed_at',
                'users.name as changer_name',
                'users.email as changer_email',
            ]);

        return response()->json([
            'data' => [
                'id' => $target->getKey(),
                'code' => $target->code,
                'name' => $target->name,
                'unit_type' => $target->unit_type,
                'parent_id' => $target->parent_id,
                'parent_name' => $target->parent?->name,
                'parent_code' => $target->parent?->code,
                'address' => $target->address,
                'is_active' => (bool) $target->is_active,
                'created_at' => $target->created_at?->toISOString(),
                'children' => $target->children->map(fn ($c) => [
                    'id' => $c->getKey(),
                    'code' => $c->code,
                    'name' => $c->name,
                    'unit_type' => $c->unit_type,
                    'is_active' => (bool) $c->is_active,
                ])->all(),
                'histories' => $histories->map(fn ($h) => [
                    'id' => $h->id,
                    'old_name' => $h->old_name,
                    'new_name' => $h->new_name,
                    'old_is_active' => $h->old_is_active !== null ? (bool) $h->old_is_active : null,
                    'new_is_active' => $h->new_is_active !== null ? (bool) $h->new_is_active : null,
                    'reason' => $h->reason,
                    'changed_by_name' => $h->changer_name ?? 'Sistem',
                    'changed_by_email' => $h->changer_email ?? null,
                    'changed_at' => $h->changed_at,
                ])->all(),
            ],
        ]);
    }

    public function createUnit(Request $request, OrganizationalUnitWriteService $service): JsonResponse
    {
        $actor = $request->user();
        $this->authorizer->authorizeView($actor, 'organizational_units.create');

        $data = Validator::make($request->all(), [
            'code' => ['required', 'string', 'max:30', 'regex:/^[A-Za-z0-9_\-]+$/', 'unique:organizational_units,code'],
            'name' => ['required', 'string', 'max:150'],
            'unit_type' => ['required', 'string', Rule::in(['UP3', 'ULP'])],
            'parent_id' => ['nullable', 'uuid', 'exists:organizational_units,id'],
            'address' => ['nullable', 'string', 'max:500'],
            'reason' => ['required', 'string', 'max:1000'],
        ])->validate();

        return $this->run(function () use ($data, $actor, $service) {
            $parent = null;
            if ($data['unit_type'] === 'UP3') {
                if (! empty($data['parent_id'])) {
                    throw new AssignmentRuleViolation('Unit UP3 tidak boleh memiliki unit induk.');
                }
                $scope = $this->authorizer->authorizeView($actor, 'organizational_units.create');
                if (! $scope['unrestricted']) {
                    throw new AdministrationDenied('Hanya SYS_ADMIN yang dapat membuat unit tingkat UP3.', 403);
                }
                if (! app(MfaService::class)->satisfied($actor)) {
                    throw new AdministrationDenied('Aksi tulis SYS_ADMIN memerlukan verifikasi MFA.', 403);
                }
            } else {
                if (empty($data['parent_id'])) {
                    throw new AssignmentRuleViolation('Unit ULP wajib memiliki unit induk UP3.');
                }
                $parent = OrganizationalUnit::query()->findOrFail($data['parent_id']);
                if ($parent->unit_type !== 'UP3') {
                    throw new AssignmentRuleViolation('Induk ULP harus berupa unit UP3.');
                }
                if (! $parent->is_active) {
                    throw new AssignmentRuleViolation('Induk unit UP3 tidak aktif.');
                }
                $this->authorizer->authorizeWrite($actor, 'organizational_units.create', $parent);
            }

            $unit = $service->create(
                $data['code'],
                $data['name'],
                $data['unit_type'],
                $parent,
                $data['address'] ?? null,
                $data['reason'],
                $actor
            );

            return response()->json([
                'data' => [
                    'id' => $unit->getKey(),
                    'code' => $unit->code,
                    'name' => $unit->name,
                    'unit_type' => $unit->unit_type,
                    'parent_id' => $unit->parent_id,
                    'parent_name' => $parent?->name,
                    'address' => $unit->address,
                    'is_active' => (bool) $unit->is_active,
                ],
            ], 201);
        });
    }

    public function updateUnit(Request $request, string $unit, OrganizationalUnitWriteService $service): JsonResponse
    {
        $actor = $request->user();
        $this->authorizer->authorizeView($actor, 'organizational_units.update');

        $data = Validator::make($request->all(), [
            'name' => ['nullable', 'string', 'max:150'],
            'address' => ['nullable', 'string', 'max:500'],
            'is_active' => ['nullable', 'boolean'],
            'reason' => ['required', 'string', 'max:1000'],
        ])->validate();

        $target = OrganizationalUnit::query()->find($unit);

        return $this->run(function () use ($target, $actor, $data, $service) {
            if ($target === null) {
                throw new AdministrationDenied('Data tidak ditemukan.', 404);
            }

            $this->authorizer->authorizeWrite($actor, 'organizational_units.update', $target);

            $changes = [];
            if (array_key_exists('name', $data) && $data['name'] !== null) {
                $changes['name'] = trim($data['name']);
            }
            if (array_key_exists('address', $data)) {
                $changes['address'] = $data['address'] !== null ? trim($data['address']) : null;
            }
            if (array_key_exists('is_active', $data) && $data['is_active'] !== null) {
                $changes['is_active'] = (bool) $data['is_active'];
            }

            if (empty($changes)) {
                throw new AssignmentRuleViolation('Tidak ada perubahan yang dikirimkan.');
            }

            if (isset($changes['is_active']) && ! $changes['is_active'] && $target->unit_type === 'UP3') {
                $activeChildrenCount = OrganizationalUnit::query()
                    ->where('parent_id', $target->getKey())
                    ->where('is_active', true)
                    ->count();
                if ($activeChildrenCount > 0) {
                    throw new AssignmentRuleViolation("Tidak dapat menonaktifkan UP3 karena masih memiliki {$activeChildrenCount} ULP anak yang aktif.");
                }
            }

            $updated = $service->update($target, $changes, $data['reason'], $actor);

            return response()->json([
                'data' => [
                    'id' => $updated->getKey(),
                    'code' => $updated->code,
                    'name' => $updated->name,
                    'unit_type' => $updated->unit_type,
                    'parent_id' => $updated->parent_id,
                    'parent_name' => $updated->parent?->name,
                    'address' => $updated->address,
                    'is_active' => (bool) $updated->is_active,
                ],
            ]);
        });
    }

    public function users(Request $request): JsonResponse
    {
        $scope = $this->run(fn () => $this->authorizer->authorizeView($request->user(), 'users.view'));
        $request->validate([
            'status' => ['nullable', Rule::in(AccountStatusService::STATUSES)],
            'search' => ['nullable', 'string', 'max:100'],
            'unit_id' => ['nullable', 'uuid'],
        ]);

        $query = User::query()
            ->with(['roleAssignments' => fn ($q) => $q->where('is_active', true)->with(['role', 'organizationalUnit'])])
            ->orderBy('name')->orderBy('id');

        if (! $scope['unrestricted']) {
            $query->whereIn('id', UserRoleAssignment::query()->select('user_id')->whereIn('organizational_unit_id', $scope['units']));
        }
        if ($request->filled('unit_id')) {
            if (! $scope['unrestricted'] && ! in_array($request->query('unit_id'), $scope['units'], true)) {
                return response()->json(['message' => 'Data tidak ditemukan.'], 404);
            }
            $query->whereIn('id', UserRoleAssignment::query()->select('user_id')->where('organizational_unit_id', $request->query('unit_id')));
        }
        if ($request->filled('status')) {
            $query->where('account_status', $request->query('status'));
        }
        if ($request->filled('search')) {
            $term = '%'.str_replace(['%', '_'], ['\%', '\_'], $request->query('search')).'%';
            $query->where(fn ($q) => $q->where('name', 'ilike', $term)->orWhere('email', 'ilike', $term));
        }

        return $this->page($query->paginate($this->perPage($request)), fn (User $u) => $this->userView($u));
    }

    public function userAssignments(Request $request, string $user): JsonResponse
    {
        $scope = $this->run(fn () => $this->authorizer->authorizeView($request->user(), 'role_assignments.view'));
        $target = User::query()->find($user);

        $query = UserRoleAssignment::query()->with(['role', 'organizationalUnit'])->where('user_id', $target?->getKey())->orderByDesc('valid_from');
        if (! $scope['unrestricted']) {
            $query->whereIn('organizational_unit_id', $scope['units']);
        }
        $rows = $query->get();

        if ($target === null || (! $scope['unrestricted'] && $rows->isEmpty())) {
            return response()->json(['message' => 'Data tidak ditemukan.'], 404);
        }

        return response()->json(['data' => $rows->map(fn (UserRoleAssignment $a) => $this->assignmentView($a))->all()]);
    }

    public function assign(Request $request, AssignmentWriteService $service): JsonResponse
    {
        $actor = $request->user();
        // Grant check BEFORE validation: callers without the grant must not learn which ids exist (422 vs 404).
        $this->authorizer->authorizeView($actor, 'role_assignments.assign');
        $data = Validator::make($request->all(), (new AssignRoleRequest)->rules())->validate();
        $unit = OrganizationalUnit::query()->findOrFail($data['organizational_unit_id']);
        $target = User::query()->findOrFail($data['user_id']);
        $role = Role::query()->findOrFail($data['role_id']);

        return $this->run(function () use ($data, $actor, $unit, $target, $role, $service) {
            $this->authorizer->authorizeAssign($actor, $target, $role, $unit);
            $assignment = $service->assign(
                $target, $role, $unit, $data['valid_from'], $data['valid_until'] ?? null,
                $data['reason'], $actor, null, $data['assignment_document'],
            );

            return response()->json(['data' => $this->assignmentView($assignment->load(['role', 'organizationalUnit']))], 201);
        });
    }

    public function createUser(Request $request, UserProvisioningService $provisioning): JsonResponse
    {
        $actor = $request->user();
        $this->authorizer->authorizeView($actor, 'users.create'); // grant first, then validate (no id/email probing)

        $input = $request->all();
        if (isset($input['email']) && is_string($input['email'])) {
            $input['email'] = mb_strtolower(trim($input['email']));
        }
        $data = Validator::make($input, [
            'name' => ['required', 'string', 'max:150'],
            'email' => ['required', 'email:rfc', 'max:150', 'unique:users,email'],
            'phone' => ['nullable', 'string', 'max:30', 'regex:/^[0-9+\-\s()]{8,30}$/'],
            'nip' => ['nullable', 'string', 'max:30', 'unique:users,nip'],
            'position' => ['nullable', 'string', 'max:100'],
            'role_id' => ['required', 'integer', 'exists:roles,id'],
            'organizational_unit_id' => ['required', 'uuid', 'exists:organizational_units,id'],
            'valid_from' => ['required', 'date_format:Y-m-d'],
            'valid_until' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:valid_from'],
            'assignment_document' => ['required', 'string', 'max:255'],
            'reason' => ['required', 'string', 'max:1000'],
        ])->validate();

        $unit = OrganizationalUnit::query()->findOrFail($data['organizational_unit_id']);
        $role = Role::query()->findOrFail($data['role_id']);
        $this->authorizer->authorizeCreateUser($actor, $role, $unit);

        $result = $provisioning->createWithAssignment(
            Arr::only($data, ['name', 'email', 'phone', 'nip', 'position']), $role, $unit, $data['valid_from'], $data['valid_until'] ?? null,
            $data['assignment_document'], $data['reason'], $actor,
        );

        return response()->json([
            'data' => $this->userView($result['user']),
            'assignment' => $this->assignmentView($result['assignment']->load(['role', 'organizationalUnit'])),
            'delivery' => $this->deliveryView($result['delivery']),
        ], 201);
    }

    /** PATCH /users/{user}: name, position (jabatan), phone and NIP of an account inside the actor's scope. */
    public function updateUser(Request $request, string $user): JsonResponse
    {
        $actor = $request->user();
        $scope = $this->run(fn () => $this->authorizer->authorizeView($actor, 'users.update'));
        $data = $request->validate([
            'name' => ['sometimes', 'required', 'string', 'max:150'],
            'position' => ['sometimes', 'nullable', 'string', 'max:100'],
            'phone' => ['sometimes', 'nullable', 'string', 'max:30', 'regex:/^[0-9+\-\s()]{8,30}$/'],
            'nip' => ['sometimes', 'nullable', 'string', 'max:30', Rule::unique('users', 'nip')->ignore($user)],
        ]);
        $target = User::query()->find($user);

        return $this->run(function () use ($target, $scope, $data) {
            if ($target === null) {
                throw new AdministrationDenied('Data tidak ditemukan.', 404);
            }
            if (! $scope['unrestricted']) {
                $this->requireTargetFullyInScope($target, $scope['units']);
            }
            foreach (['name', 'position', 'phone', 'nip'] as $field) {
                if (array_key_exists($field, $data)) {
                    $target->{$field} = is_string($data[$field]) ? (trim($data[$field]) ?: ($field === 'name' ? $target->name : null)) : $data[$field];
                }
            }
            $target->save();

            return response()->json(['data' => $this->userView($target)]);
        });
    }

    public function resendInvitation(Request $request, string $user, UserProvisioningService $provisioning): JsonResponse
    {
        $actor = $request->user();
        $this->authorizer->authorizeView($actor, 'users.create');
        $data = $request->validate(['reason' => ['required', 'string', 'max:1000']]);
        $target = User::query()->find($user);

        if ($target === null) {
            throw new AdministrationDenied('Data tidak ditemukan.', 404);
        }
        $this->authorizer->authorizeResendInvitation($actor, $target);

        return response()->json(['delivery' => $this->deliveryView($provisioning->resendInvitation($target, $data['reason'], $actor))]);
    }

    public function end(Request $request, string $assignment, AssignmentWriteService $service): JsonResponse
    {
        $actor = $request->user();
        $this->authorizer->authorizeView($actor, 'role_assignments.end');
        $data = $request->validate(['reason' => ['required', 'string', 'max:1000']]);
        $row = UserRoleAssignment::query()->with(['role', 'organizationalUnit', 'user'])->find($assignment);

        return $this->run(function () use ($row, $actor, $data, $service) {
            if ($row === null) {
                throw new AdministrationDenied('Data tidak ditemukan.', 404);
            }
            $this->authorizer->authorizeEnd($actor, $row);
            $ended = $service->revoke($row, $data['reason'], $actor);

            return response()->json(['data' => $this->assignmentView($ended->load(['role', 'organizationalUnit']))]);
        });
    }

    public function changeStatus(Request $request, string $user, AccountStatusService $service): JsonResponse
    {
        $actor = $request->user();
        $this->authorizer->authorizeView($actor, 'users.change_status');
        $data = $request->validate([
            'status' => ['required', Rule::in(AccountStatusService::STATUSES)],
            'reason' => ['required', 'string', 'max:1000'],
        ]);
        $target = User::query()->find($user);

        return $this->run(function () use ($target, $actor, $data, $service) {
            if ($target === null) {
                throw new AdministrationDenied('Data tidak ditemukan.', 404);
            }
            $this->authorizer->authorizeStatusChange($actor, $target, $data['status']);

            return response()->json(['data' => $this->userView($service->change($target, $data['status'], $data['reason'], $actor))]);
        });
    }

    /** Failures (AdministrationDenied -> 403/404/409, AssignmentRuleViolation -> 409) are rendered in bootstrap/app.php. */
    private function run(callable $fn): mixed
    {
        return $fn();
    }

    private function perPage(Request $request): int
    {
        return max(1, min((int) $request->query('per_page', 15), 100));
    }

    private function page($paginator, callable $map): JsonResponse
    {
        return response()->json([
            'data' => collect($paginator->items())->map($map)->all(),
            'meta' => ['current_page' => $paginator->currentPage(), 'per_page' => $paginator->perPage(), 'total' => $paginator->total(), 'last_page' => $paginator->lastPage()],
        ]);
    }

    /** Channel names and reasons only: never addresses, numbers or the password. */
    private function deliveryView(DeliveryReport $r): array
    {
        return ['delivered' => $r->delivered, 'failed' => array_keys($r->failed), 'skipped' => $r->skipped];  // details stay in the console/logs, not in responses
    }

    /** @return array<string, mixed> */
    private function userView(User $u): array
    {
        $view = $u->only(['id', 'nip', 'name', 'position', 'email', 'phone', 'account_status', 'must_change_password']);

        if ($u->relationLoaded('roleAssignments')) {
            $activeAssignments = $u->roleAssignments->filter(fn ($a) => (bool) $a->is_active);
            $view['roles'] = $activeAssignments->map(fn ($a) => [
                'id' => $a->getKey(),
                'role' => $a->role?->name,
                'unit_code' => $a->organizationalUnit?->code,
                'unit_name' => $a->organizationalUnit?->name,
            ])->values()->all();
            $view['role_names'] = $activeAssignments->map(fn ($a) => $a->role?->name)->filter()->values()->all();
        }

        return $view;
    }

    /** @return array<string, mixed> */
    private function assignmentView(UserRoleAssignment $a): array
    {
        return [
            'id' => $a->getKey(), 'user_id' => $a->user_id,
            'role' => $a->role?->name, 'role_id' => $a->role_id,
            'organizational_unit_id' => $a->organizational_unit_id, 'unit_code' => $a->organizationalUnit?->code,
            'valid_from' => $a->valid_from?->toDateString(), 'valid_until' => $a->valid_until?->toDateString(),
            'is_active' => (bool) $a->is_active, 'assignment_document' => $a->assignment_document,
        ];
    }
}
