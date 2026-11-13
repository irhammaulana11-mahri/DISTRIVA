<?php

namespace App\Http\Controllers;

use App\Exceptions\AdministrationDenied;
use App\Services\Authorization\CatalogAuthorizer;
use App\Services\Backup\BackupService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

/** Backup / restore (docs/64). SYS_ADMIN only (MFA). Grant first (403), then validation (422), then rule violations (409). */
class BackupController extends Controller
{
    public function __construct(private readonly CatalogAuthorizer $authorizer, private readonly BackupService $backups) {}

    public function access(Request $request): JsonResponse
    {
        $can = [];
        foreach (array_keys((array) config('distriva_permissions.backups')) as $key) {
            $can[$key] = $this->authorizer->allows($request->user(), $key);
        }

        return response()->json(['can' => $can]);
    }

    /** Overview: health of the backup folder, settings, last results, whether something is running. */
    public function status(Request $request): JsonResponse
    {
        $this->authorizer->authorize($request->user(), 'backups.view');
        $last = DB::table('backup_runs')->where('status', 'SUCCEEDED')->orderByDesc('started_at')->first();

        return response()->json(['data' => [
            'health' => $this->backups->health(),
            'settings' => $this->settings(),
            'running_backup' => DB::table('backup_runs')->where('status', 'RUNNING')->first(['id', 'backup_number', 'trigger', 'started_at']),
            'running_restore' => DB::table('restore_runs')->where('status', 'RUNNING')->first(['id', 'backup_number', 'started_at']),
            'last_success' => $last ? $this->row($last) : null,
            'last_verified' => ($v = DB::table('backup_runs')->whereNotNull('verified_at')->where('status', 'SUCCEEDED')->orderByDesc('verified_at')->first()) ? $this->row($v) : null,
            'last_failure' => ($f = DB::table('backup_runs')->where('status', 'FAILED')->orderByDesc('started_at')->first()) ? $this->row($f) : null,
        ]]);
    }

    public function index(Request $request): JsonResponse
    {
        $this->authorizer->authorize($request->user(), 'backups.view');
        $request->validate(['status' => ['nullable', 'in:RUNNING,SUCCEEDED,FAILED,DELETED'], 'trigger' => ['nullable', 'in:MANUAL,SCHEDULED,PRE_RESTORE']]);
        $page = DB::table('backup_runs')->when($request->filled('status'), fn ($q) => $q->where('status', $request->query('status')))
            ->when($request->filled('trigger'), fn ($q) => $q->where('trigger', $request->query('trigger')))
            ->orderByDesc('started_at')->paginate(max(1, min((int) $request->query('per_page', 25), 100)));

        return response()->json(['data' => collect($page->items())->map(fn ($r) => $this->row($r))->all(),
            'meta' => ['current_page' => $page->currentPage(), 'per_page' => $page->perPage(), 'total' => $page->total(), 'last_page' => $page->lastPage()]]);
    }

    public function show(Request $request, string $backup): JsonResponse
    {
        $this->authorizer->authorize($request->user(), 'backups.view');
        $r = DB::table('backup_runs')->where('id', $backup)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);

        return response()->json(['data' => $this->row($r) + [
            'verify_result' => json_decode((string) $r->verify_result, true), 'table_counts' => json_decode((string) $r->table_counts, true),
            'events' => $this->events('backup_run_id', $backup),
            'restores' => DB::table('restore_runs')->where('backup_run_id', $backup)->orderByDesc('started_at')->get()->map(fn ($x) => $this->restoreRow($x))->all(),
        ]]);
    }

    public function store(Request $request): JsonResponse
    {
        $actor = $request->user();
        $this->authorizer->authorize($actor, 'backups.create');
        $data = Validator::make($request->all(), ['include_documents' => ['sometimes', 'boolean'], 'notes' => ['nullable', 'string', 'max:500']])->validate();
        $id = $this->backups->start('MANUAL', (bool) ($data['include_documents'] ?? false), $data['notes'] ?? null, $actor);
        $this->backups->launch('distriva:backup-execute', $id);

        return response()->json(['data' => $this->row(DB::table('backup_runs')->where('id', $id)->first())], 202);
    }

    /** Synchronous (a few seconds): restores into a throw-away database; the real database is not touched. */
    public function verify(Request $request, string $backup): JsonResponse
    {
        $actor = $request->user();
        $this->authorizer->authorize($actor, 'backups.verify');
        $result = $this->backups->verify($backup, $actor);

        return response()->json(['data' => $this->row(DB::table('backup_runs')->where('id', $backup)->first()), 'result' => $result]);
    }

    public function restore(Request $request, string $backup): JsonResponse
    {
        $actor = $request->user();
        $this->authorizer->authorize($actor, 'backups.restore');
        $run = DB::table('backup_runs')->where('id', $backup)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        $data = Validator::make($request->all(), ['confirm' => ['required', 'string'], 'reason' => ['required', 'string', 'min:5', 'max:1000'], 'password' => ['required', 'string'], 'restore_documents' => ['sometimes', 'boolean']])->validate();
        if (! hash_equals('PULIHKAN '.$run->backup_number, trim($data['confirm']))) {
            throw ValidationException::withMessages(['confirm' => 'Ketik persis: PULIHKAN '.$run->backup_number]);
        }
        if (! Hash::check($data['password'], (string) $actor->password)) {
            throw ValidationException::withMessages(['password' => 'Kata sandi tidak sesuai.']);
        }
        $id = $this->backups->startRestore($backup, (bool) ($data['restore_documents'] ?? false), $data['reason'], $actor);
        $this->backups->launch('distriva:restore-execute', $id);

        return response()->json(['data' => $this->restoreRow(DB::table('restore_runs')->where('id', $id)->first())], 202);
    }

    public function restores(Request $request): JsonResponse
    {
        $this->authorizer->authorize($request->user(), 'backups.view');
        $page = DB::table('restore_runs')->orderByDesc('started_at')->paginate(max(1, min((int) $request->query('per_page', 25), 100)));

        return response()->json(['data' => collect($page->items())->map(fn ($r) => $this->restoreRow($r))->all(),
            'meta' => ['current_page' => $page->currentPage(), 'per_page' => $page->perPage(), 'total' => $page->total(), 'last_page' => $page->lastPage()]]);
    }

    public function showRestore(Request $request, string $restore): JsonResponse
    {
        $this->authorizer->authorize($request->user(), 'backups.view');
        $r = DB::table('restore_runs')->where('id', $restore)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);

        return response()->json(['data' => $this->restoreRow($r) + ['events' => $this->events('restore_run_id', $restore)]]);
    }

    public function download(Request $request, string $backup): BinaryFileResponse
    {
        $actor = $request->user();
        $this->authorizer->authorize($actor, 'backups.download');
        $data = Validator::make($request->query(), ['file' => ['required', 'in:database,documents']])->validate();
        $r = DB::table('backup_runs')->where('id', $backup)->where('status', 'SUCCEEDED')->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        $rel = $data['file'] === 'database' ? $r->db_file : $r->docs_file;
        if ($rel === null) {
            throw new AdministrationDenied('Data tidak ditemukan.', 404);
        }
        $path = $this->backups->absolute($rel);
        $this->backups->event('DOWNLOADED', $actor, ['file' => $data['file']], $backup);

        return response()->download($path, basename($rel), ['X-Content-Type-Options' => 'nosniff', 'Cache-Control' => 'private, no-store']);
    }

    public function remove(Request $request, string $backup): JsonResponse
    {
        $actor = $request->user();
        $this->authorizer->authorize($actor, 'backups.manage');
        $data = Validator::make($request->all(), ['reason' => ['required', 'string', 'min:3', 'max:500']])->validate();
        $this->backups->remove($backup, $data['reason'], $actor);

        return response()->json(['message' => 'Cadangan dihapus.']);
    }

    public function settings(?Request $request = null): array|JsonResponse
    {
        if ($request === null) {
            $s = DB::table('backup_settings')->first();

            return ['enabled' => (bool) $s->enabled, 'run_at' => $s->run_at, 'include_documents' => (bool) $s->include_documents, 'retention_count' => (int) $s->retention_count, 'updated_at' => $s->updated_at];
        }
        $this->authorizer->authorize($request->user(), 'backups.view');

        return response()->json(['data' => $this->settings()]);
    }

    public function updateSettings(Request $request): JsonResponse
    {
        $actor = $request->user();
        $this->authorizer->authorize($actor, 'backups.manage');
        $data = Validator::make($request->all(), ['enabled' => ['required', 'boolean'], 'run_at' => ['required', 'regex:/^([01][0-9]|2[0-3]):[0-5][0-9]$/'],
            'include_documents' => ['required', 'boolean'], 'retention_count' => ['required', 'integer', 'min:1', 'max:365']])->validate();
        $before = $this->settings();
        DB::table('backup_settings')->where('id', 1)->update($data + ['updated_by' => $actor->getKey(), 'updated_at' => now()]);
        $this->backups->event('SETTINGS_CHANGED', $actor, ['before' => $before, 'after' => $data]);

        return response()->json(['data' => $this->settings()]);
    }

    // ------------------------------------------------------------------------------------------------------

    /** @return array<string,mixed> */
    private function row(object $r): array
    {
        $by = $r->requested_by ? DB::table('users')->where('id', $r->requested_by)->first(['id', 'name']) : null;

        return ['id' => $r->id, 'backup_number' => $r->backup_number, 'trigger' => $r->trigger, 'status' => $r->status, 'include_documents' => (bool) $r->include_documents,
            'db_size' => $r->db_size === null ? null : (int) $r->db_size, 'docs_size' => $r->docs_size === null ? null : (int) $r->docs_size, 'db_entries' => $r->db_entries,
            'db_sha256' => $r->db_sha256, 'schema_version' => $r->schema_version, 'notes' => $r->notes, 'error' => $r->error, 'verified_at' => $r->verified_at,
            'verified_passed' => $r->verified_at !== null, 'requested_by' => $by ? ['id' => $by->id, 'name' => $by->name] : null,
            'started_at' => $r->started_at, 'finished_at' => $r->finished_at, 'deleted_at' => $r->deleted_at];
    }

    /** @return array<string,mixed> */
    private function restoreRow(object $r): array
    {
        $by = DB::table('users')->where('id', $r->requested_by)->first(['id', 'name']);

        return ['id' => $r->id, 'backup_run_id' => $r->backup_run_id, 'backup_number' => $r->backup_number, 'status' => $r->status, 'restore_documents' => (bool) $r->restore_documents,
            'safety_backup_id' => $r->safety_backup_id, 'reason' => $r->reason, 'error' => $r->error, 'requested_by' => $by ? ['id' => $by->id, 'name' => $by->name] : null,
            'started_at' => $r->started_at, 'finished_at' => $r->finished_at];
    }

    /** @return list<array<string,mixed>> */
    private function events(string $column, string $id): array
    {
        return DB::table('backup_events')->where($column, $id)->orderBy('seq')->get()->map(function ($e) {
            $u = $e->actor_user_id ? DB::table('users')->where('id', $e->actor_user_id)->first(['name']) : null;

            return ['event_type' => $e->event_type, 'actor_name' => $u->name ?? null, 'details' => json_decode((string) $e->details, true), 'occurred_at' => $e->occurred_at];
        })->all();
    }
}
