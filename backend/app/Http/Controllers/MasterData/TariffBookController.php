<?php

namespace App\Http\Controllers\MasterData;

use App\Exceptions\AdministrationDenied;
use App\Http\Controllers\Controller;
use App\Services\Authorization\CatalogAuthorizer;
use App\Services\Kkf\TariffBookService;
use App\Services\Notifications\InAppNotifier;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;

/** Tariff books: average price, jam nyala, UJL (docs/62 §26). Violations -> 409, authorization -> 403/404. */
class TariffBookController extends Controller
{
    public function __construct(private readonly CatalogAuthorizer $authorizer, private readonly TariffBookService $books, private readonly InAppNotifier $notifier) {}

    public function index(Request $request): JsonResponse
    {
        $this->authorizer->authorize($request->user(), 'master_data.view');
        $request->validate(['status' => ['nullable', Rule::in(['DRAFT', 'APPROVED', 'INACTIVE'])]]);
        $q = DB::table('tariff_books as b')->selectRaw('b.*, (select count(*) from tariff_book_rows r where r.tariff_book_id = b.id) as rows_count')->orderByDesc('b.valid_from');
        if ($request->filled('status')) {
            $q->where('b.status', $request->query('status'));
        }

        return response()->json(['data' => $q->get()->map(fn ($b) => $this->header($b))->all()]);
    }

    public function show(Request $request, string $book): JsonResponse
    {
        $this->authorizer->authorize($request->user(), 'master_data.view');
        $b = DB::table('tariff_books as b')->selectRaw('b.*, (select count(*) from tariff_book_rows r where r.tariff_book_id = b.id) as rows_count')->where('b.id', $book)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        $events = DB::table('tariff_book_events as e')->join('users as u', 'u.id', '=', 'e.actor_user_id')->where('e.tariff_book_id', $book)->orderBy('e.occurred_at')->get(['e.event_type', 'e.reason', 'e.details', 'e.occurred_at', 'u.email as actor_email']);

        return response()->json(['data' => $this->header($b) + ['events' => $events->map(fn ($e) => ['event_type' => $e->event_type, 'reason' => $e->reason, 'details' => json_decode((string) $e->details, true), 'occurred_at' => $e->occurred_at, 'actor_email' => $e->actor_email])->all()]]);
    }

    public function rows(Request $request, string $book): JsonResponse
    {
        $this->authorizer->authorize($request->user(), 'master_data.view');
        DB::table('tariff_books')->where('id', $book)->exists() || throw new AdministrationDenied('Data tidak ditemukan.', 404);
        $request->validate(['tariff' => ['nullable', 'string', 'max:20']]);
        $q = DB::table('tariff_book_rows as r')->leftJoin('organizational_units as u', 'u.id', '=', 'r.ulp_unit_id')->where('r.tariff_book_id', $book)->orderBy('r.tariff_code')->orderBy('r.power_va')->select('r.*', 'u.code as ulp_code');
        if ($request->filled('tariff')) {
            $q->where('r.tariff_code', TariffBookService::normalizeTariff((string) $request->query('tariff')));
        }
        $page = $q->paginate(max(1, min((int) $request->query('per_page', 50), 200)));

        return response()->json(['data' => collect($page->items())->map(fn ($r) => ['tariff' => $r->tariff_code, 'power_va' => $r->power_va === null ? null : (int) $r->power_va, 'ulp_code' => $r->ulp_code, 'avg_price' => (float) $r->avg_price,
            'jam_nyala' => (float) $r->jam_nyala, 'ujl' => $r->ujl === null ? null : (float) $r->ujl])->all(),
            'meta' => ['current_page' => $page->currentPage(), 'per_page' => $page->perPage(), 'total' => $page->total(), 'last_page' => $page->lastPage()]]);
    }

    public function import(Request $request): JsonResponse
    {
        $actor = $request->user();
        $this->authorizer->authorize($actor, 'tariffs.manage'); // grant first, then validate
        $data = Validator::make($request->all(), [
            'file' => ['required', 'file', 'mimetypes:text/csv,text/plain,application/csv,application/vnd.ms-excel', 'extensions:csv,txt', 'max:'.(int) config('distriva_permissions.master_data_import.max_kb')],
            'name' => ['required', 'string', 'max:150'], 'valid_from' => ['required', 'date_format:Y-m-d'], 'source_reference' => ['nullable', 'string', 'max:255'], 'dry_run' => ['sometimes', 'boolean'],
        ])->validate();
        $r = $this->books->import($request->file('file'), $data['name'], $data['valid_from'], $data['source_reference'] ?? null, $request->boolean('dry_run'), $actor);

        if (! $r['summary']['dry_run']) {
            $this->notifier->approvalRequested('tariffs.approve', 'tariff_books', 'buku tarif', $actor, 'Buku Tarif', '/master-data/tariff-books');
        }

        return response()->json(['data' => $r['summary'], 'rows' => $r['rows']], $r['summary']['dry_run'] ? 200 : 201);
    }

    public function approve(Request $request): JsonResponse
    {
        $actor = $request->user();
        $this->authorizer->authorize($actor, 'tariffs.approve');
        $data = Validator::make($request->all(), ['book_ids' => ['required', 'array', 'min:1', 'max:10'], 'book_ids.*' => ['uuid', 'distinct'], 'reason' => ['required', 'string', 'max:1000']])->validate();

        $out = $this->books->approve($data['book_ids'], $actor, $data['reason']);
        $this->notifier->approved('tariff_books', $data['book_ids'], 'buku tarif', $actor, $data['reason'], 'Buku Tarif', '/master-data/tariff-books');

        return response()->json(['data' => $out]);
    }

    public function retire(Request $request, string $book): JsonResponse
    {
        $actor = $request->user();
        $this->authorizer->authorize($actor, 'tariffs.approve');
        $data = Validator::make($request->all(), ['reason' => ['required', 'string', 'max:1000']])->validate();
        $this->books->retire($book, $data['reason'], $actor);

        return response()->json(['message' => 'Buku tarif dinonaktifkan.']);
    }

    /** @return array<string,mixed> */
    private function header(object $b): array
    {
        return ['id' => $b->id, 'name' => $b->name, 'valid_from' => $b->valid_from, 'valid_until' => $b->valid_until, 'status' => $b->status, 'source_reference' => $b->source_reference,
            'created_by' => $b->created_by, 'approved_by' => $b->approved_by, 'approved_at' => $b->approved_at, 'rows_count' => (int) ($b->rows_count ?? 0)];
    }
}
