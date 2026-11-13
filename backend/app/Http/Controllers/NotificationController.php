<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** The caller's own inbox. Every query is scoped to the authenticated user: another user's notification answers 404, never 403. */
class NotificationController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $request->validate(['unread' => ['nullable', 'boolean'], 'per_page' => ['nullable', 'integer', 'min:1', 'max:100']]);
        $uid = $request->user()->getKey();
        $query = DB::table('user_notifications')->where('user_id', $uid)->orderByDesc('created_at')->orderByDesc('id');
        if ($request->boolean('unread')) {
            $query->whereNull('read_at');
        }
        $page = $query->paginate((int) $request->query('per_page', 30));

        return response()->json([
            'data' => collect($page->items())->map(fn ($n) => [
                'id' => $n->id, 'level' => $n->level, 'title' => $n->title, 'body' => $n->body, 'tag' => $n->tag, 'link' => $n->link,
                'read_at' => $n->read_at, 'created_at' => $n->created_at,
            ])->all(),
            'meta' => ['current_page' => $page->currentPage(), 'per_page' => $page->perPage(), 'total' => $page->total(), 'last_page' => $page->lastPage(),
                'unread_count' => DB::table('user_notifications')->where('user_id', $uid)->whereNull('read_at')->count()],
        ]);
    }

    public function markRead(Request $request, string $notification): JsonResponse
    {
        $row = DB::table('user_notifications')->where('id', $notification)->where('user_id', $request->user()->getKey());
        abort_unless($row->exists(), 404);
        $row->whereNull('read_at')->update(['read_at' => now()]);

        return response()->json(['data' => ['id' => $notification, 'read' => true]]);
    }

    public function markAllRead(Request $request): JsonResponse
    {
        $n = DB::table('user_notifications')->where('user_id', $request->user()->getKey())->whereNull('read_at')->update(['read_at' => now()]);

        return response()->json(['data' => ['marked' => $n]]);
    }
}
