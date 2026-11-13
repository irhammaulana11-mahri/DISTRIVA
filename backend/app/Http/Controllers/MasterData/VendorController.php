<?php

namespace App\Http\Controllers\MasterData;

use App\Exceptions\AdministrationDenied;
use App\Exceptions\AssignmentRuleViolation;
use App\Http\Controllers\Controller;
use App\Models\OrganizationalUnit;
use App\Models\Role;
use App\Models\User;
use App\Services\Authorization\CatalogAuthorizer;
use App\Services\UserProvisioningService;
use App\Services\WorkOrders\VendorService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;

/** Vendor companies and linked vendor accounts (docs/62 §32); managed by KONSTRUKSI_UP3 and SYS_ADMIN. */
class VendorController extends Controller
{
    public function __construct(private readonly CatalogAuthorizer $authorizer, private readonly VendorService $vendors, private readonly UserProvisioningService $provisioning) {}

    public function index(Request $request): JsonResponse
    {
        $this->authorizer->authorize($request->user(), 'master_data.view');
        $accounts = DB::table('vendor_accounts as a')->join('users as u', 'u.id', '=', 'a.user_id')->get(['a.id', 'a.vendor_company_id', 'a.is_active', 'u.email', 'u.name'])->groupBy('vendor_company_id');

        return response()->json(['data' => DB::table('vendor_companies')->orderBy('code')->get()->map(fn ($c) => ['id' => $c->id, 'code' => $c->code, 'name' => $c->name, 'status' => $c->status,
            'profile' => collect(VendorService::PROFILE_FIELDS)->mapWithKeys(fn ($f) => [$f => $c->{$f}])->all(),
            'accounts' => ($accounts[$c->id] ?? collect())->map(fn ($a) => ['id' => $a->id, 'email' => $a->email, 'name' => $a->name, 'is_active' => (bool) $a->is_active])->values()->all()])->all()]);
    }

    /** POST /vendors — the company, and optionally its administration account (VENDOR role + invitation) linked in the same step. */
    public function create(Request $request): JsonResponse
    {
        $actor = $request->user();
        $this->authorizer->authorize($actor, 'vendors.manage');
        $input = $request->all();
        if (isset($input['account']['email']) && is_string($input['account']['email'])) {
            $input['account']['email'] = mb_strtolower(trim($input['account']['email']));
        }
        $d = Validator::make($input, ['code' => ['required', 'string', 'max:30', 'regex:/^[A-Za-z0-9_.-]+$/'], 'name' => ['required', 'string', 'max:200'],
            'account' => ['nullable', 'array'], 'account.name' => ['required_with:account', 'string', 'max:150'], 'account.email' => ['required_with:account', 'email:rfc', 'max:150', 'unique:users,email'],
            'account.phone' => ['nullable', 'string', 'max:30', 'regex:/^[0-9+\-\s()]{8,30}$/'], 'account.organizational_unit_id' => ['nullable', 'uuid', 'exists:organizational_units,id']] + $this->profileRules())->validate();

        $account = $d['account'] ?? null;
        $unit = $account === null ? null : $this->accountUnit($actor, $account['organizational_unit_id'] ?? null);
        $created = DB::transaction(function () use ($d, $actor, $account, $unit): array {
            $id = $this->vendors->createCompany($d['code'], $d['name'], $actor, $d);

            return $account === null ? ['id' => $id] : ['id' => $id, 'account' => $this->provisionAccount($id, $account, $unit, $d['code'], $d['name'], $d['contract_valid_until'] ?? null, $actor)];
        });

        return response()->json(['data' => $created], 201);
    }

    /**
     * A new VENDOR user (invited by email) linked to the company.
     *
     * @param  array<string,mixed>  $account
     * @return array<string,mixed>
     */
    private function provisionAccount(string $companyId, array $account, OrganizationalUnit $unit, string $code, string $name, ?string $validUntil, User $actor): array
    {
        $result = $this->provisioning->createWithAssignment(['name' => $account['name'], 'email' => $account['email'], 'phone' => $account['phone'] ?? null],
            Role::query()->where('name', 'VENDOR')->firstOrFail(), $unit, now()->toDateString(), $validUntil,
            'Akun administrasi vendor '.strtoupper(trim($code)), 'Akun administrasi pelaksana '.trim($name).' dibuat bersama data vendor', $actor);
        $accountId = $this->vendors->linkAccount($companyId, $result['user']->getKey(), $actor);

        return ['id' => $accountId, 'user_id' => $result['user']->getKey(), 'email' => $result['user']->email, 'account_status' => $result['user']->account_status,
            'delivery' => ['delivered' => $result['delivery']->delivered, 'failed' => array_keys($result['delivery']->failed), 'skipped' => $result['delivery']->skipped]];
    }

    /** The unit a vendor account is assigned to: the one given, else the unit of the actor's own active assignment. */
    private function accountUnit(User $actor, ?string $unitId): OrganizationalUnit
    {
        $unitId ??= DB::table('user_role_assignments')->where('user_id', $actor->getKey())->where('is_active', true)->whereNotNull('organizational_unit_id')->orderByDesc('valid_from')->value('organizational_unit_id');

        return ($unitId === null ? null : OrganizationalUnit::query()->find($unitId)) ?? throw new AssignmentRuleViolation('Unit untuk akun vendor tidak dapat ditentukan; pilih unit penugasan akun.');
    }

    /** PUT /vendors/{company} — the company name and profile (the code and status are changed elsewhere). */
    public function update(Request $request, string $company): JsonResponse
    {
        $this->authorizer->authorize($request->user(), 'vendors.manage');
        $d = Validator::make($request->all(), ['name' => ['required', 'string', 'max:200']] + $this->profileRules())->validate();
        $this->vendors->updateProfile($company, $d);

        return response()->json(['message' => 'Profil perusahaan vendor diperbarui.']);
    }

    /** @return array<string,mixed> */
    private function profileRules(): array
    {
        $npwp = function (string $attr, mixed $v, \Closure $fail): void {
            $digits = preg_replace('/\D/', '', (string) $v);
            if (! preg_match('/^[0-9.\-\s]+$/', (string) $v) || ! in_array(strlen($digits), [15, 16], true)) {
                $fail('NPWP harus 15 atau 16 digit.');
            }
        };

        return [
            'npwp' => ['nullable', 'string', 'max:25', $npwp], 'nib' => ['nullable', 'string', 'max:40'], 'address' => ['nullable', 'string', 'max:1000'], 'city' => ['nullable', 'string', 'max:100'],
            'province' => ['nullable', 'string', 'max:100'], 'postal_code' => ['nullable', 'string', 'max:10'], 'phone' => ['nullable', 'string', 'max:30'], 'email' => ['nullable', 'email', 'max:150'],
            'website' => ['nullable', 'string', 'max:150'], 'pic_name' => ['nullable', 'string', 'max:150'], 'pic_position' => ['nullable', 'string', 'max:100'], 'pic_phone' => ['nullable', 'string', 'max:30'],
            'pic_email' => ['nullable', 'email', 'max:150'], 'sbu_classification' => ['nullable', 'string', 'max:150'], 'sbu_number' => ['nullable', 'string', 'max:60'], 'sbu_valid_until' => ['nullable', 'date'],
            'contract_number' => ['nullable', 'string', 'max:100'], 'contract_valid_from' => ['nullable', 'date'], 'contract_valid_until' => ['nullable', 'date', 'after_or_equal:contract_valid_from'],
            'bank_name' => ['nullable', 'string', 'max:100'], 'bank_account_number' => ['nullable', 'string', 'max:40'], 'bank_account_name' => ['nullable', 'string', 'max:150'], 'notes' => ['nullable', 'string', 'max:2000'], 'work_scope' => ['nullable', 'in:JARINGAN,TIANG,KEDUANYA'],
        ];
    }

    public function setStatus(Request $request, string $company): JsonResponse
    {
        $this->authorizer->authorize($request->user(), 'vendors.manage');
        $d = Validator::make($request->all(), ['status' => ['required', 'in:ACTIVE,SUSPENDED']])->validate();
        $this->vendors->setStatus($company, $d['status']);

        return response()->json(['message' => 'Status perusahaan vendor diperbarui.']);
    }

    public function linkAccount(Request $request, string $company): JsonResponse
    {
        $this->authorizer->authorize($request->user(), 'vendors.manage');
        $input = $request->all();
        if (isset($input['account']['email']) && is_string($input['account']['email'])) {
            $input['account']['email'] = mb_strtolower(trim($input['account']['email']));
        }
        $d = Validator::make($input, ['user_id' => ['required_without:account', 'nullable', 'uuid'], 'account' => ['nullable', 'array'], 'account.name' => ['required_with:account', 'string', 'max:150'], 'account.email' => ['required_with:account', 'email:rfc', 'max:150', 'unique:users,email'],
            'account.phone' => ['nullable', 'string', 'max:30', 'regex:/^[0-9+\-\s()]{8,30}$/'], 'account.organizational_unit_id' => ['nullable', 'uuid', 'exists:organizational_units,id']])->validate();
        if (empty($d['account'])) {
            return response()->json(['data' => ['id' => $this->vendors->linkAccount($company, $d['user_id'], $request->user())]], 201);
        }
        $c = DB::table('vendor_companies')->where('id', $company)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        $unit = $this->accountUnit($request->user(), $d['account']['organizational_unit_id'] ?? null);
        $created = DB::transaction(fn () => $this->provisionAccount($company, $d['account'], $unit, $c->code, $c->name, $c->contract_valid_until, $request->user()));

        return response()->json(['data' => $created], 201);
    }

    public function deactivateAccount(Request $request, string $account): JsonResponse
    {
        $this->authorizer->authorize($request->user(), 'vendors.manage');
        $this->vendors->deactivateAccount($account);

        return response()->json(['message' => 'Akun vendor dinonaktifkan.']);
    }
}
