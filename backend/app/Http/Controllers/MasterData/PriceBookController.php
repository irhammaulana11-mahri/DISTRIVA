<?php

namespace App\Http\Controllers\MasterData;

use App\Exceptions\AdministrationDenied;
use App\Http\Controllers\Controller;
use App\Services\Authorization\CatalogAuthorizer;
use App\Services\Notifications\InAppNotifier;
use App\Services\Prices\PriceBookService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;

/** Price books of a contract (docs/62 §19). Rule violations -> 409, authorization -> 403/404 (bootstrap/app.php). */
class PriceBookController extends Controller
{
    public function __construct(private readonly CatalogAuthorizer $authorizer, private readonly PriceBookService $books, private readonly InAppNotifier $notifier) {}

    public function index(Request $request): JsonResponse
    {
        $this->authorizer->authorize($request->user(), 'master_data.view');
        $request->validate(['status' => ['nullable', Rule::in(['DRAFT', 'APPROVED', 'INACTIVE'])]]);
        $q = DB::table('price_books as b')->selectRaw('b.*, (select count(*) from price_book_items i where i.price_book_id = b.id) as items_count, (select count(*) from price_book_zones z where z.price_book_id = b.id) as zones_count')->orderByDesc('b.valid_from');
        if ($request->filled('status')) {
            $q->where('b.status', $request->query('status'));
        }

        return response()->json(['data' => $q->get()->map(fn ($b) => $this->header($b))->all()]);
    }

    public function show(Request $request, string $book): JsonResponse
    {
        $this->authorizer->authorize($request->user(), 'master_data.view');
        $b = DB::table('price_books as b')->selectRaw('b.*, (select count(*) from price_book_items i where i.price_book_id = b.id) as items_count, (select count(*) from price_book_zones z where z.price_book_id = b.id) as zones_count')->where('b.id', $book)->first()
            ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        $zones = DB::table('price_book_zones as z')->join('organizational_units as u', 'u.id', '=', 'z.up3_unit_id')->where('z.price_book_id', $book)->orderBy('u.code')->get(['u.id as up3_unit_id', 'u.code', 'u.name', 'z.zone']);
        $available = DB::table('price_book_service_prices as s')->join('price_book_items as i', 'i.id', '=', 's.price_book_item_id')->where('i.price_book_id', $book)->distinct()->orderBy('s.zone')->pluck('s.zone');
        $events = DB::table('price_book_events as e')->join('users as u', 'u.id', '=', 'e.actor_user_id')->where('e.price_book_id', $book)->orderBy('e.occurred_at')->get(['e.event_type', 'e.reason', 'e.details', 'e.occurred_at', 'u.email as actor_email']);

        return response()->json(['data' => $this->header($b) + [
            'zones' => $zones->map(fn ($z) => ['up3_unit_id' => $z->up3_unit_id, 'code' => $z->code, 'name' => $z->name, 'zone' => (int) $z->zone])->all(),
            'available_zones' => $available->map(fn ($z) => (int) $z)->all(),
            'events' => $events->map(fn ($e) => ['event_type' => $e->event_type, 'reason' => $e->reason, 'details' => json_decode((string) $e->details, true), 'occurred_at' => $e->occurred_at, 'actor_email' => $e->actor_email])->all(),
        ]]);
    }

    public function items(Request $request, string $book): JsonResponse
    {
        $this->authorizer->authorize($request->user(), 'master_data.view');
        DB::table('price_books')->where('id', $book)->exists() || throw new AdministrationDenied('Data tidak ditemukan.', 404);
        $request->validate(['search' => ['nullable', 'string', 'max:100'], 'material_status' => ['nullable', Rule::in(['PLN', 'PRICED'])]]);
        $q = DB::table('price_book_items as i')->join('khs_items as k', 'k.id', '=', 'i.khs_item_id')->where('i.price_book_id', $book)
            ->selectRaw('i.id, k.code, i.material_status, i.material_price, i.insured_value, (select v.name from khs_item_versions v where v.khs_item_id = k.id order by v.version_number desc limit 1) as name')->orderByRaw('length(k.code), k.code');
        if ($request->filled('material_status')) {
            $q->where('i.material_status', $request->query('material_status'));
        }
        if ($request->filled('search')) {
            $term = '%'.str_replace(['%', '_'], ['\%', '\_'], $request->query('search')).'%';
            $q->where(fn ($w) => $w->where('k.code', 'ilike', $term)->orWhereExists(fn ($s) => $s->from('khs_item_versions as sv')->whereColumn('sv.khs_item_id', 'k.id')->where('sv.name', 'ilike', $term)));
        }
        $page = $q->paginate(max(1, min((int) $request->query('per_page', 50), 200)));
        $svc = DB::table('price_book_service_prices')->whereIn('price_book_item_id', collect($page->items())->pluck('id'))->get()->groupBy('price_book_item_id');

        return response()->json([
            'data' => collect($page->items())->map(fn ($i) => ['khs_code' => $i->code, 'name' => $i->name, 'material_status' => $i->material_status, 'material_price' => $i->material_price === null ? null : (float) $i->material_price, 'insured_value' => $i->insured_value === null ? null : (float) $i->insured_value,
                'service' => $svc->get($i->id, collect())->sortBy('zone')->mapWithKeys(fn ($s) => [(string) $s->zone => ['install' => (float) $s->install_price, 'remove' => (float) $s->remove_price]])->all()])->all(),
            'meta' => ['current_page' => $page->currentPage(), 'per_page' => $page->perPage(), 'total' => $page->total(), 'last_page' => $page->lastPage()],
        ]);
    }

    public function import(Request $request): JsonResponse
    {
        $actor = $request->user();
        $this->authorizer->authorize($actor, 'prices.manage'); // grant first, then validate
        $data = Validator::make($request->all(), [
            'file' => ['required', 'file', 'mimetypes:text/csv,text/plain,application/csv,application/vnd.ms-excel', 'extensions:csv,txt', 'max:'.(int) config('distriva_permissions.master_data_import.max_kb')],
            'name' => ['required', 'string', 'max:150'], 'contract_reference' => ['nullable', 'string', 'max:150'], 'valid_from' => ['required', 'date_format:Y-m-d'],
            'source_reference' => ['nullable', 'string', 'max:255'], 'dry_run' => ['sometimes', 'boolean'],
        ])->validate();
        $r = $this->books->import($request->file('file'), $data['name'], $data['contract_reference'] ?? null, $data['valid_from'], $data['source_reference'] ?? null, $request->boolean('dry_run'), $actor);

        if (! $r['summary']['dry_run']) {
            $this->notifier->approvalRequested('prices.approve', 'price_books', 'buku harga', $actor, 'Buku Harga', '/master-data/harga');
        }

        return response()->json(['data' => $r['summary'], 'rows' => $r['rows']], $r['summary']['dry_run'] ? 200 : 201);
    }

    public function setZone(Request $request, string $book): JsonResponse
    {
        $actor = $request->user();
        $this->authorizer->authorize($actor, 'prices.manage');
        $data = Validator::make($request->all(), ['up3_unit_id' => ['required', 'uuid'], 'zone' => ['required', 'integer', 'between:1,9'], 'reason' => ['required', 'string', 'max:1000']])->validate();
        $this->books->setZone($book, $data['up3_unit_id'], (int) $data['zone'], $data['reason'], $actor);

        return response()->json(['message' => 'Zona ditetapkan.']);
    }

    /** MDU / insured value of one item of a DRAFT book (null clears it). */
    public function setInsured(Request $request, string $book, string $code): JsonResponse
    {
        $actor = $request->user();
        $this->authorizer->authorize($actor, 'prices.manage');
        $data = Validator::make($request->all(), ['insured_value' => ['present', 'nullable', 'numeric', 'min:0', 'max:100000000000'], 'reason' => ['required', 'string', 'max:1000']])->validate();
        $this->books->setInsuredValue($book, $code, $data['insured_value'] === null ? null : round((float) $data['insured_value'], 2), $data['reason'], $actor);

        return response()->json(['message' => 'Nilai MDU diperbarui.', 'data' => ['khs_code' => $code, 'insured_value' => $data['insured_value'] === null ? null : round((float) $data['insured_value'], 2)]]);
    }

    public function approve(Request $request): JsonResponse
    {
        $actor = $request->user();
        $this->authorizer->authorize($actor, 'prices.approve');
        $data = Validator::make($request->all(), ['book_ids' => ['required', 'array', 'min:1', 'max:10'], 'book_ids.*' => ['uuid', 'distinct'], 'reason' => ['required', 'string', 'max:1000']])->validate();

        $out = $this->books->approve($data['book_ids'], $actor, $data['reason']);
        $this->notifier->approved('price_books', $data['book_ids'], 'buku harga', $actor, $data['reason'], 'Buku Harga', '/master-data/harga');

        return response()->json(['data' => $out]);
    }

    public function retire(Request $request, string $book): JsonResponse
    {
        $actor = $request->user();
        $this->authorizer->authorize($actor, 'prices.approve');
        $data = Validator::make($request->all(), ['reason' => ['required', 'string', 'max:1000']])->validate();
        $this->books->retire($book, $data['reason'], $actor);

        return response()->json(['message' => 'Buku harga dinonaktifkan.']);
    }

    /** @return array<string,mixed> */
    private function header(object $b): array
    {
        return ['id' => $b->id, 'name' => $b->name, 'contract_reference' => $b->contract_reference, 'valid_from' => $b->valid_from, 'valid_until' => $b->valid_until, 'status' => $b->status,
            'source_reference' => $b->source_reference, 'created_by' => $b->created_by, 'approved_by' => $b->approved_by, 'approved_at' => $b->approved_at,
            'items_count' => (int) ($b->items_count ?? 0), 'zones_count' => (int) ($b->zones_count ?? 0)];
    }
}
