<?php

namespace App\Services\Notifications;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Throwable;

/**
 * Writes the in-app inbox (user_notifications). A notification is a courtesy: it must never make the business action that triggered it fail,
 * so every public method swallows (and logs) its own errors. Bodies never carry credentials, OTPs or tokens.
 */
class InAppNotifier
{
    /**
     * Active accounts holding any of the permissions today. With $unitId only holders whose assignment covers that unit receive it: the same unit,
     * or the UP3 above a ULP (the same reach as UP3_DESCENDANT_READ in ScopedAuthorizationService). SYS_ADMIN (no unit) is then left out.
     *
     * @param  string|list<string>  $permissions
     * @return list<string>
     */
    public function holdersOf(string|array $permissions, ?string $unitId = null): array
    {
        $today = now()->toDateString();
        $q = DB::table('users as u')
            ->join('user_role_assignments as a', 'a.user_id', '=', 'u.id')
            ->join('role_has_permissions as rp', 'rp.role_id', '=', 'a.role_id')
            ->join('permissions as p', 'p.id', '=', 'rp.permission_id')
            ->whereIn('p.name', (array) $permissions)
            ->where('u.account_status', 'ACTIVE')
            ->where('a.is_active', true)
            ->whereDate('a.valid_from', '<=', $today)
            ->where(fn ($w) => $w->whereNull('a.valid_until')->orWhereDate('a.valid_until', '>=', $today));
        if ($unitId !== null) {
            $q->where(fn ($w) => $w->where('a.organizational_unit_id', $unitId)
                ->orWhere('a.organizational_unit_id', DB::table('organizational_units')->where('id', $unitId)->where('unit_type', 'ULP')->select('parent_id')));
        }

        return $q->distinct()->pluck('u.id')->all();
    }

    /**
     * Like toUsers, but a recipient who still has an UNREAD notification with the same title and link gets that one refreshed instead of a duplicate
     * (a daily low-stock alert must not pile up).
     *
     * @param  iterable<string>  $userIds
     */
    public function refreshOrCreate(iterable $userIds, string $level, string $title, ?string $body, ?string $tag, ?string $link): int
    {
        try {
            $new = [];
            $n = 0;
            foreach (array_unique(is_array($userIds) ? $userIds : iterator_to_array($userIds)) as $id) {
                $existing = DB::table('user_notifications')->where('user_id', $id)->where('title', $title)->whereNull('read_at')
                    ->where(fn ($w) => $link === null ? $w->whereNull('link') : $w->where('link', $link))->value('id');
                if ($existing !== null) {
                    DB::table('user_notifications')->where('id', $existing)->update(['body' => $body, 'level' => $level, 'created_at' => now()]);
                    $n++;
                } else {
                    $new[] = $id;
                }
            }

            return $n + $this->toUsers($new, $level, $title, $body, $tag, $link);
        } catch (Throwable $e) {
            Log::warning('In-app notification failed.', ['exception' => $e::class]);

            return 0;
        }
    }

    /** @param iterable<string> $userIds */
    public function toUsers(iterable $userIds, string $level, string $title, ?string $body = null, ?string $tag = null, ?string $link = null): int
    {
        try {
            $rows = [];
            foreach (array_unique(is_array($userIds) ? $userIds : iterator_to_array($userIds)) as $id) {
                $rows[] = ['id' => (string) Str::uuid(), 'user_id' => $id, 'level' => $level, 'title' => Str::limit($title, 150, ''),
                    'body' => $body === null ? null : Str::limit($body, 1000, '…'), 'tag' => $tag, 'link' => $link, 'created_at' => now()];
            }
            foreach (array_chunk($rows, 500) as $chunk) {
                DB::table('user_notifications')->insert($chunk);
            }

            return count($rows);
        } catch (Throwable $e) {
            Log::warning('In-app notification failed.', ['exception' => $e::class]);

            return 0;
        }
    }

    /** Tells every holder of the approve grant (except the one who just acted) how many drafts of $table wait for a decision. */
    public function approvalRequested(string $permission, string $table, string $label, User $actor, string $tag, string $link): int
    {
        try {
            $pending = DB::table($table)->where('status', 'DRAFT')->count();
            if ($pending === 0) {
                return 0;
            }
            $recipients = array_values(array_diff($this->holdersOf($permission), [(string) $actor->getKey()]));

            return $this->toUsers($recipients, 'warning', "{$pending} draf {$label} menunggu persetujuan",
                'Draf disiapkan dan menunggu keputusan Anda. Pembuat draf tidak dapat menyetujui drafnya sendiri.', $tag, $link);
        } catch (Throwable $e) {
            Log::warning('In-app notification failed.', ['exception' => $e::class]);

            return 0;
        }
    }

    /** Tells the creators of the approved rows (except the approver) that their draft became active. */
    public function approved(string $table, array $ids, string $label, User $actor, string $reason, string $tag, string $link): int
    {
        try {
            $creators = DB::table($table)->whereIn('id', $ids)->whereNotNull('created_by')->distinct()->pluck('created_by')->all();
            $recipients = array_values(array_diff($creators, [(string) $actor->getKey()]));

            return $this->toUsers($recipients, 'success', ucfirst($label).' disetujui',
                count($ids).' versi/draf '.$label.' Anda disetujui dan kini aktif. Alasan: '.$reason, $tag, $link);
        } catch (Throwable $e) {
            Log::warning('In-app notification failed.', ['exception' => $e::class]);

            return 0;
        }
    }
}
