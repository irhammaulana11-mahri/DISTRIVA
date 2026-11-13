<?php

namespace App\Http\Controllers;

use App\Exceptions\AdministrationDenied;
use App\Services\Authorization\ApplicationAuthorizer;
use App\Services\Kko\KkoService;
use App\Services\Substations\SubstationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;

/** KKO of an application (docs/62 §51): technical study of the transformer loading and the voltage at the location. Grant (403/404) -> validation (422) -> rule (409). Never blocks the flow. */
class KkoController extends Controller
{
    public function __construct(private readonly ApplicationAuthorizer $authorizer, private readonly KkoService $kko) {}

    /** GET /applications/{application}/kko */
    public function show(Request $request, string $application): JsonResponse
    {
        $unit = $this->unitOf($application);
        $scope = $this->authorizer->authorizeScope($request->user(), 'kko.view');
        if (! $scope['unrestricted'] && ! in_array($unit, $scope['units'], true)) {
            throw new AdministrationDenied('Data tidak ditemukan.', 404);
        }

        return response()->json(['data' => $this->kko->show($application)]);
    }

    /** PUT /applications/{application}/kko — the survey result; computes the loading and the flags. */
    public function record(Request $request, string $application): JsonResponse
    {
        $actor = $request->user();
        $unit = $this->unitOf($application);
        $this->authorizer->authorizeScope($actor, 'kko.record');
        $this->authorizer->authorizeOnUnit($actor, 'kko.record', $unit);
        $data = Validator::make($request->all(), [
            'substation_id' => ['nullable', 'uuid'], 'substation_code' => ['nullable', 'string', 'max:60'], 'substation_name' => ['nullable', 'string', 'max:150'],
            'transformer_capacity_kva' => ['nullable', 'numeric', 'gt:0', 'max:1000000'], 'measured_load_kva' => ['nullable', 'numeric', 'min:0', 'max:1000000'],
            'measured_at' => ['nullable', 'date_format:Y-m-d', 'before_or_equal:today'], 'voltage_location_v' => ['nullable', 'numeric', 'gt:0', 'lt:1000'],
            'dedicated_transformer' => ['sometimes', 'boolean'], 'dedicated_transformer_kva' => ['nullable', 'numeric', 'gt:0', 'max:1000000'], 'load_factor' => ['nullable', 'numeric', 'gt:0', 'max:1'],
            'phase_detail' => ['nullable', 'array'], 'phase_detail.gtt' => ['nullable', 'array'], 'phase_detail.gtt.jurusan_count' => ['nullable', 'integer', 'min:0', 'max:50'],
            'phase_detail.gtt.jurusan_length_km' => ['nullable', 'numeric', 'min:0', 'max:1000'], 'phase_detail.gtt.distance_gtt_km' => ['nullable', 'numeric', 'min:0', 'max:1000'],
            'phase_detail.gtt.conductor' => ['nullable', 'string', 'max:60'], 'phase_detail.gtt.loading_pattern' => ['nullable', 'string', 'max:100'],
            'phase_detail.load.*' => ['nullable', 'numeric', 'min:0', 'max:100000'], 'phase_detail.added.*' => ['nullable', 'numeric', 'min:0', 'max:100000'],
            'phase_detail.base_voltage.*' => ['nullable', 'numeric', 'gt:0', 'lt:1000'], 'phase_detail.existing_voltage.*' => ['nullable', 'numeric', 'gt:0', 'lt:1000'],
            'phase_detail.after_existing_voltage.*' => ['nullable', 'numeric', 'gt:0', 'lt:1000'],
            'phase_detail.jurusan' => ['nullable', 'array', 'max:20'], 'phase_detail.jurusan.*.name' => ['nullable', 'string', 'max:60'], 'phase_detail.jurusan.*.r' => ['nullable', 'numeric', 'min:0', 'max:100000'],
            'phase_detail.jurusan.*.s' => ['nullable', 'numeric', 'min:0', 'max:100000'], 'phase_detail.jurusan.*.t' => ['nullable', 'numeric', 'min:0', 'max:100000'],
            'phase_detail.plan' => ['nullable', 'array'], 'phase_detail.plan.*' => ['nullable', 'numeric', 'min:0', 'max:100000'], 'phase_detail.notes' => ['nullable', 'string', 'max:2000'],
        ])->after(function ($v) use ($request): void {
            $phaseLoad = collect(['r', 's', 't'])->every(fn ($k) => $request->filled("phase_detail.load.{$k}"));          // the per-phase currents give the load themselves
            if (! $phaseLoad && ! $request->boolean('dedicated_transformer') && ($request->filled('transformer_capacity_kva') xor $request->filled('measured_load_kva'))) {
                $v->errors()->add('measured_load_kva', 'Kapasitas trafo dan beban terukur diisi bersama-sama (atau keduanya dikosongkan).');
            }
        })->validate();

        if (! empty($data['substation_id'])) {          // the survey picked a gardu from the master: it must be an active PLN gardu inside the actor's scope
            $s = app(SubstationService::class)->pickable($data['substation_id'], $this->authorizer->scopeFor($actor, 'kko.record'));
            $reading = app(SubstationService::class)->latestReading($s->id);
            $data['substation_code'] = $data['substation_code'] ?? SubstationService::displayCode($s);
            $data['substation_name'] = $data['substation_name'] ?? $s->name;
            $data['transformer_capacity_kva'] = $data['transformer_capacity_kva'] ?? ($s->capacity_kva === null ? null : (float) $s->capacity_kva);
            if (! array_key_exists('measured_load_kva', $data) || $data['measured_load_kva'] === null) {      // the master's latest reading fills what the surveyor did not enter
                $data['measured_load_kva'] = $reading['load_kva'] ?? null;
                $data['measured_at'] = $data['measured_at'] ?? ($reading['measured_on'] ?? null);
            }
            // the voltage at the customer's location is measured by the surveyor (owner 2026-11-16): the gardu's end voltage is not a substitute
            if (($data['transformer_capacity_kva'] === null) xor ($data['measured_load_kva'] === null)) {          // no usable pair: leave both for the surveyor rather than half a pair
                $data['transformer_capacity_kva'] = $data['measured_load_kva'] = null;
            }
        }

        $record = $this->kko->record($application, $data, $actor);
        $link = ! empty($data['substation_id']) ? app(\App\Services\Substations\ConnectionService::class)->linkFromKko($application, $data['substation_id']) : null;     // the applicant's IDPEL follows the chosen gardu (never a guess)

        return response()->json(['data' => $record, 'customer_link' => $link]);
    }

    /**
     * GET /applications/{application}/kko/baseline?substation_id= — what the KKO form fills by itself once a gardu is chosen (docs/82 §12): the gardu, its latest reading per phase and per jurusan (current, base voltage),
     * and the suggested added phase current of this application. The customer's existing voltage is never filled: the surveyor measures it.
     */
    public function baseline(Request $request, string $application): JsonResponse
    {
        $actor = $request->user();
        $unit = $this->unitOf($application);
        $this->authorizer->authorizeScope($actor, 'kko.record');
        $this->authorizer->authorizeOnUnit($actor, 'kko.record', $unit);
        $d = Validator::make($request->all(), ['substation_id' => ['required', 'uuid']])->validate();
        $subs = app(SubstationService::class);
        $s = $subs->pickable($d['substation_id'], $this->authorizer->scopeFor($actor, 'kko.record'));
        $reading = $subs->latestReading($s->id);
        $app = DB::table('applications')->where('id', $application)->first();
        $kva = $app->delta_power_kva === null ? null : (float) $app->delta_power_kva;
        $newKva = $app->new_power_value === null ? null : (float) $app->new_power_value * (strtoupper((string) $app->new_power_unit) === 'KVA' ? 1 : 0.001);
        $three = $newKva !== null && $newKva >= 6.6;          // 6600 VA and above is a 3-phase connection
        $loads = ['r' => $reading['current_r_a'] ?? null, 's' => $reading['current_s_a'] ?? null, 't' => $reading['current_t_a'] ?? null];

        return response()->json(['data' => ['substation' => ['id' => $s->id, 'code' => $s->code, 'name' => $s->name, 'capacity_kva' => $s->capacity_kva === null ? null : (float) $s->capacity_kva], 'reading' => $reading,
            'added_power_kva' => $kva, 'suggested_added' => KkoService::suggestAdded($kva, $three, $loads)]]);
    }

    /** POST /applications/{application}/kko/decision — TEKNIK: LAYAK | TIDAK_LAYAK (+ reason, optional improvement proposal). */
    public function decide(Request $request, string $application): JsonResponse
    {
        $actor = $request->user();
        $unit = $this->unitOf($application);
        $this->authorizer->authorizeScope($actor, 'kko.decide');
        $this->authorizer->authorizeOnUnit($actor, 'kko.decide', $unit);
        $data = Validator::make($request->all(), ['decision' => ['required', 'in:LAYAK,TIDAK_LAYAK'], 'notes' => ['nullable', 'string', 'max:4000'], 'improvement_proposal' => ['nullable', 'string', 'max:4000']])->validate();

        return response()->json(['data' => $this->kko->decide($application, $data['decision'], $data['notes'] ?? null, $data['improvement_proposal'] ?? null, $actor)]);
    }

    private function unitOf(string $applicationId): string
    {
        return (string) (DB::table('applications')->where('id', $applicationId)->value('organizational_unit_id') ?? throw new AdministrationDenied('Data tidak ditemukan.', 404));
    }
}
