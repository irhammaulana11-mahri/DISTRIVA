<?php

namespace App\Services;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Illuminate\Validation\Rules\Password;

/**
 * Password policy from docs/16 (account security):
 * min 8 chars with upper, lower, digit and symbol; not one of the last 5 passwords;
 * not a common password. A breached-password lookup (HIBP, external network call) is
 * available but disabled by default: distriva.password_check_breached.
 */
class PasswordPolicy
{
    /** @return list<string> Indonesian messages; empty when the password is acceptable. */
    public function violations(string $password, ?User $user = null): array
    {
        $errors = [];
        $min = (int) config('distriva.password_min_length');

        if (mb_strlen($password) < $min) {
            $errors[] = "Password minimal {$min} karakter.";
        }
        if (! preg_match('/\p{Ll}/u', $password)) {
            $errors[] = 'Password harus memuat huruf kecil.';
        }
        if (! preg_match('/\p{Lu}/u', $password)) {
            $errors[] = 'Password harus memuat huruf besar.';
        }
        if (! preg_match('/\d/', $password)) {
            $errors[] = 'Password harus memuat angka.';
        }
        if (! preg_match('/[^\p{L}\d]/u', $password)) {
            $errors[] = 'Password harus memuat simbol.';
        }
        if ($this->isCommon($password)) {
            $errors[] = 'Password terlalu umum dan mudah ditebak.';
        }
        if ($user !== null && $this->containsIdentity($password, $user)) {
            $errors[] = 'Password tidak boleh memuat nama pengguna atau bagian email.';
        }
        if ($user !== null && $user->exists && $this->wasUsedRecently($password, $user)) {
            $count = (int) config('distriva.password_history_count');
            $errors[] = "Password tidak boleh sama dengan {$count} password terakhir.";
        }
        if ($errors === [] && config('distriva.password_check_breached')) {
            if (Password::min(1)->uncompromised()->passes('password', $password) === false) {
                $errors[] = 'Password ditemukan dalam kebocoran data publik.';
            }
        }

        return $errors;
    }

    /** Random password that satisfies this policy (used for one-time initial passwords). */
    public function generate(int $length = 20): string
    {
        $sets = ['abcdefghjkmnpqrstuvwxyz', 'ABCDEFGHJKMNPQRSTUVWXYZ', '23456789', '!@#$%^&*-_=+'];
        $all = implode('', $sets);

        do {
            $chars = array_map(fn (string $set) => $set[random_int(0, strlen($set) - 1)], $sets);
            while (count($chars) < $length) {
                $chars[] = $all[random_int(0, strlen($all) - 1)];
            }
            shuffle($chars);
            $password = implode('', $chars);
        } while ($this->violations($password) !== []);

        return $password;
    }

    public function isCommon(string $password): bool
    {
        $list = $this->commonList();
        $lower = Str::lower($password);
        $core = preg_replace('/[^\p{L}]/u', '', $lower) ?? '';

        return isset($list[$lower]) || ($core !== '' && isset($list[$core]));
    }

    /** Current password plus the most recent history rows, newest first, capped by the history count. */
    public function wasUsedRecently(string $password, User $user): bool
    {
        $count = (int) config('distriva.password_history_count');

        if ($user->password !== null && Hash::check($password, $user->password)) {
            return true;
        }

        $hashes = DB::table('password_histories')
            ->where('user_id', $user->getKey())
            ->orderByDesc('created_at')
            ->limit($count)
            ->pluck('password_hash');

        foreach ($hashes as $hash) {
            if (Hash::check($password, $hash)) {
                return true;
            }
        }

        return false;
    }

    /** Record the (already hashed) password the user just switched to. */
    public function remember(User $user, string $hash): void
    {
        DB::table('password_histories')->insert([
            'id' => (string) Str::uuid(),
            'user_id' => $user->getKey(),
            'password_hash' => $hash,
            'created_at' => now(),
        ]);
    }

    private function containsIdentity(string $password, User $user): bool
    {
        $lower = Str::lower($password);
        $local = Str::lower(Str::before((string) $user->email, '@'));

        if (mb_strlen($local) >= 4 && str_contains($lower, $local)) {
            return true;
        }

        foreach (preg_split('/[^\p{L}\d]+/u', Str::lower((string) $user->name), -1, PREG_SPLIT_NO_EMPTY) ?: [] as $part) {
            if (mb_strlen($part) >= 4 && str_contains($lower, $part)) {
                return true;
            }
        }

        return false;
    }

    /** @return array<string, true> */
    private function commonList(): array
    {
        static $list = null;

        if ($list === null) {
            $lines = file(resource_path('data/common-passwords.txt'), FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [];
            $list = [];
            foreach ($lines as $line) {
                if (! str_starts_with($line, '#')) {
                    $list[trim($line)] = true;
                }
            }
        }

        return $list;
    }
}
