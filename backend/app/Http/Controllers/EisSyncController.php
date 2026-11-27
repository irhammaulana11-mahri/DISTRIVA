<?php

namespace App\Http\Controllers;

use App\Exceptions\AdministrationDenied;
use App\Exceptions\AssignmentRuleViolation;
use App\Services\Applications\EisSyncService;
use App\Services\Authorization\ApplicationAuthorizer;
use App\Services\EisReports\ApktSaidiSaifiSync;
use App\Services\Sync\SyncRuns;
use App\Services\Sync\SyncScope;
use Carbon\Carbon;
use Illuminate\Contracts\Encryption\DecryptException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;

/** EIS sync started from DISTRIVA: settings (EIS account, Range Daya, automatic run), the run button and the history of the runs. */
class EisSyncController extends Controller
{
    public function __construct(private readonly ApplicationAuthorizer $authorizer, private readonly EisSyncService $sync, private readonly SyncScope $syncScope, private readonly SyncRuns $syncRuns) {}

    public function show(Request $request): JsonResponse
    {
        $scope = $this->authorizer->authorizeScope($request->user(), 'eis_sync.manage');
        $up3Id = $this->up3($request);
        $this->sync->expireStale();
        $runs = DB::table('eis_sync_runs as r')->leftJoin('users as u', 'u.id', '=', 'r.started_by')->where('r.up3_id', $up3Id)->when($request->boolean('active'), fn ($q) => $q->whereIn('r.status', ['QUEUED', 'RUNNING']))
            ->orderByDesc('r.created_at')->limit(10)->get(['r.*', 'u.email as started_by_email']);

        return response()->json(['data' => ['settings' => $this->sync->settings($up3Id), 'runs' => $runs->map(fn ($r) => $this->run($r, false))->all(), 'units' => $this->units($scope, $up3Id),
            'up3_id' => $up3Id, 'up3s' => $this->syncScope->options($request->user(), 'eis_sync.manage'), 'can_manage_settings' => $this->syncScope->coversUp3($request->user(), 'eis_sync.manage', $up3Id)]]);
    }

    public function save(Request $request): JsonResponse
    {
        $this->authorizer->authorizeScope($request->user(), 'eis_sync.manage');
        $d = Validator::make($request->all(), [
            'eis_username' => ['nullable', 'string', 'max:150'], 'eis_password' => ['nullable', 'string', 'max:200'],
            'power_min' => ['required', 'integer', 'min:0', 'max:99999999'], 'power_max' => ['required', 'integer', 'min:0', 'max:99999999'],
            'lookback_days' => ['required', 'integer', 'between:1,730'], 'auto_enabled' => ['required', 'boolean'], 'auto_time' => ['required', 'regex:/^([01][0-9]|2[0-3]):[0-5][0-9]$/'],
        ])->validate();

        $up3Id = $this->up3($request);
        $this->syncScope->assertManagesUp3($request->user(), 'eis_sync.manage', $up3Id);

        return response()->json(['data' => $this->sync->save($d, $request->user(), $up3Id), 'message' => 'Pengaturan sinkronisasi EIS disimpan.']);
    }

    /**
     * POST /eis-sync/runs — starts a manual run; answers at once, the run goes on in its own process. `kind` = permohonan (default; optionally of a given Range Mohon) or piutang
     * (the monthly receivable reports per golongan / per lembar / kogol / saldo prabayar for `from_month`..`to_month` into the EIS report import, docs/88) or apkt (the monthly SAIDI SAIFI SE004 report, type DIFI, from APKT with a session token pasted per run: `apkt_token`, docs/88).
     */
    public function start(Request $request): JsonResponse
    {
        $this->authorizer->authorizeScope($request->user(), 'eis_sync.manage');
        $apkt = $request->input('kind') === 'apkt';
        $ap2t = $request->input('kind') === 'ap2t';
        $piutang = $apkt || $ap2t || $request->input('kind') === 'piutang';      // keduanya menarik laporan bulanan ke impor laporan EIS
        $this->authorizer->authorizeScope($request->user(), $piutang ? 'eis_reports.import' : 'applications.import');
        $scope = $this->authorizer->authorizeScope($request->user(), 'eis_sync.manage');
        $rules = ['kind' => ['sometimes', 'in:permohonan,piutang,apkt,ap2t'], 'units' => ['sometimes', 'array', 'min:1', 'max:40'], 'units.*' => ['string', 'regex:/^\\d{5}$/']];
        $apkt && $rules += ['apkt_token' => ['nullable', 'required_unless:use_saved_token,true', 'string', 'max:700'], 'save_token' => ['sometimes', 'boolean'], 'use_saved_token' => ['sometimes', 'boolean'], 'dataset' => ['sometimes', 'in:saidi-saifi,rpt-rct-gangguan,rpt-rct-keluhan,anomali-gangguan,anomali-keluhan']];
        $rules += $piutang
            ? ['from_month' => ['nullable', 'date_format:Y-m'], 'to_month' => ['required', 'date_format:Y-m', 'after_or_equal:from_month'], 'reports' => ['sometimes', 'array', 'min:1'], 'reports.*' => ['in:'.($ap2t ? 'realisasi,belum_realisasi,pelunasan_prr,pelunasan_ex_prr,saldo_prr,hapus_prr,bp' : 'GOLONGAN,LEMBAR,KOGOL,PRABAYAR,KONTROL309')]]
            : ['from' => ['nullable', 'date_format:Y-m-d', 'required_with:to'], 'to' => ['nullable', 'date_format:Y-m-d', 'required_with:from', 'after_or_equal:from'], 'complete_old' => ['sometimes', 'boolean']];
        $d = Validator::make($request->all(), $rules)->validate();
        $units = isset($d['units']) ? array_values(array_unique($d['units'])) : null;
        $up3Id = $this->up3($request);
        $allowed = array_column($this->units($scope, $up3Id), 'code');
        if ($units !== null && array_diff($units, $allowed) !== []) {
            throw new AssignmentRuleViolation('Ada unit yang tidak dikenal atau di luar cakupan Anda.');
        }
        $actor = $request->user();
        $ulps = $this->syncScope->ulpsFor($actor, 'eis_sync.manage', $up3Id);
        $level = $this->syncScope->level($actor, 'eis_sync.manage', $up3Id);
        $run = fn (?string $from, ?string $to, bool $completeOld, string $kind, ?array $options): array => $this->sync->start('MANUAL', $actor, $up3Id, $from, $to, $units, $completeOld, $kind, $options, $ulps, $level);
        if ($piutang) {
            $from = $d['from_month'] ?? $d['to_month'];
            if (Carbon::createFromFormat('!Y-m', $from)->diffInMonths(Carbon::createFromFormat('!Y-m', $d['to_month'])) >= 24) {
                throw new AssignmentRuleViolation('Paling banyak 24 bulan per penarikan.');
            }
            if ($ap2t) {
                $ids = $run(null, null, false, 'AP2T', ['dataset' => 'tagsus', 'from_month' => $from, 'to_month' => $d['to_month'], 'reports' => array_values(array_unique($d['reports'] ?? ['realisasi', 'belum_realisasi']))]);
            } elseif ($apkt) {
                $useSaved = (bool) ($d['use_saved_token'] ?? false);
                $token = $useSaved ? $this->savedApktToken((string) $request->user()->getKey())
                    : (ApktSaidiSaifiSync::cleanToken($d['apkt_token'] ?? null) ?? throw new AssignmentRuleViolation('Token APKT tidak valid: salin nilai header Authorization dari permintaan /graphql di APKT (dengan atau tanpa awalan "Bearer").'));
                $save = ! $useSaved && (bool) ($d['save_token'] ?? false);
                if ($save) {      // disimpan saat penarikan dimulai; hasil pemakaiannya (OK atau REJECTED) dicatat oleh penarikan itu
                    DB::table('user_apkt_tokens')->upsert([['user_id' => $request->user()->getKey(), 'token_encrypted' => Crypt::encryptString($token), 'saved_at' => now(), 'last_used_at' => null, 'last_result' => null]],
                        ['user_id'], ['token_encrypted', 'saved_at', 'last_used_at', 'last_result']);
                }
                $options = ['dataset' => $d['dataset'] ?? 'saidi-saifi', 'from_month' => $from, 'to_month' => $d['to_month'], 'token_source' => $useSaved ? 'saved' : 'pasted', 'token_saved' => $useSaved || $save,
                    'token_encrypted' => Crypt::encryptString($token)];     // salinan untuk proses ini saja: dihapus begitu selesai, tidak pernah dikembalikan
                $ids = $run(null, null, false, 'APKT', $options);
            } else {
                $options = ['from_month' => $from, 'to_month' => $d['to_month'], 'reports' => array_values(array_unique($d['reports'] ?? ['GOLONGAN', 'LEMBAR', 'KOGOL', 'PRABAYAR']))];
                $ids = $run(null, null, false, 'PIUTANG', $options);
            }
        } else {
            $ids = $run($d['from'] ?? null, $d['to'] ?? null, (bool) ($d['complete_old'] ?? false), 'PERMOHONAN', null);
        }
        foreach ($ids as $id) {
            $this->sync->launch($id);
        }
        $rows = DB::table('eis_sync_runs as r')->leftJoin('users as u', 'u.id', '=', 'r.started_by')->whereIn('r.id', $ids)->get(['r.*', 'u.email as started_by_email'])->keyBy('id');

        // `data` = run pertama (bentuk lama); `runs` = semua run permintaan ini (satu per akun)
        return response()->json(['data' => $this->run($rows[$ids[0]], true), 'runs' => array_map(fn (string $id) => $this->run($rows[$id], false), $ids)], 202);
    }

    public function showRun(Request $request, string $run): JsonResponse
    {
        $this->authorizer->authorizeScope($request->user(), 'eis_sync.manage');
        $this->sync->expireStale();
        $r = DB::table('eis_sync_runs as r')->leftJoin('users as u', 'u.id', '=', 'r.started_by')->where('r.id', $run)->whereIn('r.up3_id', $this->syncScope->up3Ids($request->user(), 'eis_sync.manage'))->first(['r.*', 'u.email as started_by_email']) ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);

        return response()->json(['data' => $this->run($r, true)]);
    }

    /** GET /eis-sync/apkt-token — apakah pengguna menyimpan token APKT (tidak pernah tokennya). */
    public function apktTokenStatus(Request $request): JsonResponse
    {
        $this->authorizeApkt($request);
        $row = DB::table('user_apkt_tokens')->where('user_id', $request->user()->getKey())->first(['saved_at', 'last_used_at', 'last_result']);

        return response()->json(['data' => ['saved' => $row !== null, 'saved_at' => $row->saved_at ?? null, 'last_used_at' => $row->last_used_at ?? null, 'last_result' => $row->last_result ?? null]]);
    }

    /** DELETE /eis-sync/apkt-token */
    public function apktTokenForget(Request $request): JsonResponse
    {
        $this->authorizeApkt($request);
        DB::table('user_apkt_tokens')->where('user_id', $request->user()->getKey())->delete();

        return response()->json(['message' => 'Token APKT tersimpan dihapus.']);
    }

    private function authorizeApkt(Request $request): void
    {
        $this->authorizer->authorizeScope($request->user(), 'eis_sync.manage');
        $this->authorizer->authorizeScope($request->user(), 'eis_reports.import');
    }

    private function savedApktToken(string $userId): string
    {
        $row = DB::table('user_apkt_tokens')->where('user_id', $userId)->value('token_encrypted');
        if ($row === null) {
            throw new AssignmentRuleViolation('Belum ada token APKT tersimpan; tempel token sesi dan centang "Simpan token".');
        }
        try {
            return Crypt::decryptString($row);
        } catch (DecryptException) {
            DB::table('user_apkt_tokens')->where('user_id', $userId)->delete();

            throw new AssignmentRuleViolation('Token APKT tersimpan tidak dapat dibaca lagi; tempel token sesi yang baru.');
        }
    }

    private function up3(Request $request): string
    {
        $requested = Validator::make($request->all(), ['up3_id' => ['nullable', 'uuid']])->validate()['up3_id'] ?? null;

        return $this->syncScope->resolve($request->user(), 'eis_sync.manage', $requested);
    }

    /**
     * The ULP units of the UP3 this account may sync: all of them, or the ones in the account's scope.
     *
     * @param  array{unrestricted: bool, units: list<string>}  $scope
     * @return list<array{code:string,name:string}>
     */
    private function units(array $scope, string $up3Id): array
    {
        $q = DB::table('organizational_units')->where('parent_id', $up3Id)->where('unit_type', 'ULP')->where('is_active', true)->orderBy('code');
        $scope['unrestricted'] || $q->whereIn('id', $scope['units']);

        return $q->get(['code', 'name'])->map(fn ($u) => ['code' => (string) $u->code, 'name' => (string) $u->name])->all();
    }

    /** @return array<string,mixed> */
    private function run(object $r, bool $withLog): array
    {
        return ['id' => $r->id, 'kind' => strtolower((string) ($r->kind ?? 'PERMOHONAN')), 'options' => ($r->options ?? null) === null ? null : array_diff_key((array) json_decode((string) $r->options, true), ['token_encrypted' => 1]), 'trigger' => $r->trigger, 'status' => $r->status, 'started_by' => $r->started_by_email, 'range_from' => $r->range_from, 'range_to' => $r->range_to, 'units' => $r->units === null ? null : json_decode((string) $r->units, true), 'complete_old' => (bool) ($r->complete_old ?? false), 'exit_code' => $r->exit_code,
            'created_at' => $r->created_at, 'started_at' => $r->started_at, 'finished_at' => $r->finished_at] + $this->syncRuns->describe($r) + ($withLog ? ['log' => $r->log] : []);
    }
}
