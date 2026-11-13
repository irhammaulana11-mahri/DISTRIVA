<?php

namespace Tests\Feature;

use App\Services\PasswordPolicy;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Test;
use Tests\PostgresTestCase;

class PasswordPolicyTest extends PostgresTestCase
{
    private function policy(): PasswordPolicy
    {
        return $this->app->make(PasswordPolicy::class);
    }

    /** @return array<string, array{0: string, 1: string}> */
    public static function weakPasswords(): array
    {
        return [
            'too short' => ['Ab1!xyz', 'minimal 8'],
            'no lowercase' => ['ABCDEFG1!', 'huruf kecil'],
            'no uppercase' => ['abcdefg1!', 'huruf besar'],
            'no digit' => ['Abcdefgh!', 'angka'],
            'no symbol' => ['Abcdefg12', 'simbol'],
            'common word with decoration' => ['Password1!', 'terlalu umum'],
            'common leet' => ['P@ssw0rd', 'terlalu umum'],
            'qwerty with decoration' => ['Qwerty123!', 'terlalu umum'],
        ];
    }

    #[Test]
    #[DataProvider('weakPasswords')]
    public function weak_passwords_are_rejected_with_a_specific_message(string $password, string $needle): void
    {
        $joined = implode(' | ', $this->policy()->violations($password));
        $this->assertStringContainsString($needle, $joined);
    }

    #[Test]
    public function a_strong_unique_password_is_accepted(): void
    {
        $this->assertSame([], $this->policy()->violations('Baru-Kuat#2026', $this->makeUser()));
        $this->assertSame([], $this->policy()->violations('Kunci Rahasia Ku 7!'));
    }

    #[Test]
    public function passwords_containing_the_email_name_or_username_are_rejected(): void
    {
        $user = $this->makeUser('ACTIVE', 'budi.santoso@example.com');
        $user->forceFill(['name' => 'Budi Santoso'])->save();

        foreach (['Budi.santoso#99', 'xxSantoso#2026', 'Budi-Rahasia#1'] as $p) {
            $this->assertStringContainsString('nama pengguna', implode(' ', $this->policy()->violations($p, $user)), $p);
        }
    }

    #[Test]
    public function the_last_five_passwords_cannot_be_reused_but_the_sixth_back_can(): void
    {
        $this->withoutMiddleware(ThrottleRequests::class); // six changes in one test
        $user = $this->makeUser();
        $token = $user->createToken('t')->plainTextToken;
        $current = 'secret-password';
        $passwords = ['Kata-Satu#1a', 'Kata-Dua#2b', 'Kata-Tiga#3c', 'Kata-Empat#4d', 'Kata-Lima#5e', 'Kata-Enam#6f'];

        foreach ($passwords as $new) {
            $this->withToken($token)->postJson('/api/me/password', [
                'current_password' => $current, 'password' => $new, 'password_confirmation' => $new,
            ])->assertOk();
            $current = $new;
        }

        // Current + the last 4 before it are blocked (the 5 most recent history rows).
        foreach (array_slice($passwords, 1) as $reused) {
            $this->assertStringContainsString('5 password terakhir', implode(' ', $this->policy()->violations($reused, $user->fresh())), $reused);
        }
        // The oldest of the six has aged out of the window of five.
        $this->assertSame([], $this->policy()->violations($passwords[0], $user->fresh()));
        $this->assertDatabaseCount('password_histories', 6);
    }

    #[Test]
    public function history_stores_only_hashes(): void
    {
        $user = $this->makeUser();
        $token = $user->createToken('t')->plainTextToken;
        $this->withToken($token)->postJson('/api/me/password', [
            'current_password' => 'secret-password', 'password' => 'Baru-Kuat#2026', 'password_confirmation' => 'Baru-Kuat#2026',
        ])->assertOk();

        $row = DB::table('password_histories')->first();
        $this->assertNotSame('Baru-Kuat#2026', $row->password_hash);
        $this->assertTrue(Hash::check('Baru-Kuat#2026', $row->password_hash));
        $this->assertSame($user->fresh()->password, $row->password_hash);
    }

    #[Test]
    public function the_api_returns_every_violation_in_indonesian_and_changes_nothing(): void
    {
        $user = $this->makeUser();
        $token = $user->createToken('t')->plainTextToken;
        $before = $user->fresh()->password;

        $res = $this->withToken($token)->postJson('/api/me/password', [
            'current_password' => 'secret-password', 'password' => 'abc', 'password_confirmation' => 'abc',
        ])->assertUnprocessable();

        $this->assertGreaterThanOrEqual(4, count($res->json('errors.password')));
        $this->assertSame($before, $user->fresh()->password);
        $this->assertDatabaseCount('password_histories', 0);
    }

    #[Test]
    public function the_breached_lookup_is_off_by_default_so_no_external_request_is_made(): void
    {
        $this->assertFalse(config('distriva.password_check_breached'));
        Http::fake();
        $this->policy()->violations('Baru-Kuat#2026');
        Http::assertNothingSent();
    }
}
