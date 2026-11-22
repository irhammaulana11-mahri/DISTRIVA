<?php

namespace Tests\Feature;

use App\Models\Role;
use App\Models\User;
use App\Services\Notifications\WhatsApp\HttpWhatsAppDriver;
use App\Services\Notifications\WhatsApp\NullWhatsAppDriver;
use App\Services\Notifications\WhatsApp\WhatsAppDriver;
use App\Services\Notifications\WhatsApp\WhatsAppSettings;
use Database\Seeders\SystemSettingsPermissionSeeder;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use PHPUnit\Framework\Attributes\Test;
use Tests\PostgresTestCase;

class WhatsAppSettingsTest extends PostgresTestCase
{
    private User $admin;

    private User $other;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->seed(SystemSettingsPermissionSeeder::class);
        config(['distriva_notifications.whatsapp.driver' => 'null', 'distriva_notifications.whatsapp.http.token' => null]);
        $this->admin = $this->makeUser();
        $this->assign($this->admin, Role::query()->where('name', 'SYS_ADMIN')->firstOrFail(), null);
        $this->other = $this->makeUser();
        $this->assign($this->other, Role::query()->where('name', 'MANAGER_ULP')->firstOrFail(), $this->makeUnit('ULP', $this->makeUnit('UP3')));
    }

    private function as(User $u): static
    {
        $this->app['auth']->forgetGuards();
        $token = $u->createToken('t');
        $token->accessToken->forceFill(['mfa_verified_at' => now()])->save();

        return $this->withToken($token->plainTextToken);
    }

    /** @return array<string,mixed> */
    private function payload(array $over = []): array
    {
        return $over + ['driver' => 'http', 'url' => 'https://wa.example.test/send', 'method' => 'POST', 'auth_header' => 'Authorization', 'auth_prefix' => '', 'token' => 'RAHASIA-TOKEN-123',
            'body_format' => 'json', 'body' => '{"target":"{phone}","message":"{message}"}', 'success_path' => 'status', 'success_value' => 'true', 'timeout' => 10, 'default_country_code' => '62'];
    }

    #[Test]
    public function only_sys_admin_reads_and_changes_the_settings(): void
    {
        $this->as($this->other)->getJson('/api/settings/whatsapp')->assertForbidden();
        $this->as($this->other)->putJson('/api/settings/whatsapp', $this->payload())->assertForbidden();
        $this->as($this->other)->postJson('/api/settings/whatsapp/test', ['phone' => '081234567890'])->assertForbidden();
        $this->as($this->admin)->getJson('/api/settings/whatsapp')->assertOk()->assertJsonPath('data.source', 'ENV');
    }

    #[Test]
    public function the_token_is_encrypted_never_returned_and_kept_when_the_field_is_left_empty(): void
    {
        $r = $this->as($this->admin)->putJson('/api/settings/whatsapp', $this->payload())->assertOk();
        $this->assertSame(['WEB', true], [$r->json('data.source'), $r->json('data.has_token')]);
        $this->assertStringNotContainsString('RAHASIA-TOKEN-123', $r->getContent());
        $stored = (string) DB::table('whatsapp_settings')->value('token_encrypted');
        $this->assertNotSame('RAHASIA-TOKEN-123', $stored);

        $this->as($this->admin)->putJson('/api/settings/whatsapp', $this->payload(['token' => '', 'timeout' => 20]))->assertOk()->assertJsonPath('data.timeout', 20);
        $this->assertSame($stored, (string) DB::table('whatsapp_settings')->value('token_encrypted'));      // empty = kept
        $events = DB::table('whatsapp_setting_events')->pluck('details')->implode(' ');
        $this->assertStringNotContainsString('RAHASIA', $events);
        $this->assertStringNotContainsString('wa.example.test', $events);                                   // the trail names fields, never values

        $this->as($this->admin)->putJson('/api/settings/whatsapp', $this->payload(['driver' => 'log', 'token' => '', 'clear_token' => true]))->assertOk()->assertJsonPath('data.has_token', false);
    }

    #[Test]
    public function an_unusable_http_setup_is_refused_with_a_reason(): void
    {
        foreach ([['url' => 'ftp://wa.example.test/send'], ['url' => ''], ['body' => 'bukan json'], ['body' => '{"target":"{phone}"}'], ['token' => '']] as $bad) {
            $this->as($this->admin)->putJson('/api/settings/whatsapp', $this->payload($bad))->assertStatus(409);       // a rule violation, like every other rule of the app
        }
        $this->assertSame(0, DB::table('whatsapp_settings')->count());
        $this->as($this->admin)->putJson('/api/settings/whatsapp', $this->payload(['driver' => 'bogus']))->assertStatus(422);
    }

    #[Test]
    public function the_saved_settings_replace_env_for_the_driver_and_a_test_message_goes_through_the_gateway(): void
    {
        $this->assertInstanceOf(NullWhatsAppDriver::class, app(WhatsAppDriver::class));                     // .env: off
        $this->as($this->admin)->putJson('/api/settings/whatsapp', $this->payload())->assertOk();
        $this->assertInstanceOf(HttpWhatsAppDriver::class, app(WhatsAppDriver::class));                     // saved: the gateway

        Http::fake(['wa.example.test/*' => Http::sequence()->push(['status' => true], 200)->push(['status' => false], 200)]);
        $this->as($this->admin)->postJson('/api/settings/whatsapp/test', ['phone' => '081234567890'])->assertOk()->assertJsonPath('data.status', 'OK');
        Http::assertSent(fn ($req) => $req->url() === 'https://wa.example.test/send' && $req->hasHeader('Authorization', 'RAHASIA-TOKEN-123') && $req['target'] === '6281234567890');

        $this->as($this->admin)->postJson('/api/settings/whatsapp/test', ['phone' => '081234567890'])->assertStatus(409);     // the gateway says status=false
        $this->as($this->admin)->postJson('/api/settings/whatsapp/test', ['phone' => 'abc'])->assertStatus(409);
        $this->assertSame(['TEST_FAILED', 'TEST_SENT'], DB::table('whatsapp_setting_events')->whereIn('event_type', ['TEST_SENT', 'TEST_FAILED'])->distinct()->orderBy('event_type')->pluck('event_type')->all());
    }

    #[Test]
    public function an_http_address_is_accepted_too(): void
    {
        $this->as($this->admin)->putJson('/api/settings/whatsapp', $this->payload(['url' => 'http://127.0.0.1:3000/send']))->assertOk()->assertJsonPath('data.url', 'http://127.0.0.1:3000/send');
    }

    #[Test]
    public function without_a_saved_row_the_env_values_stay_and_the_first_save_keeps_the_env_token(): void
    {
        config(['distriva_notifications.whatsapp.driver' => 'http', 'distriva_notifications.whatsapp.http' => ['url' => 'https://env.example.test/x', 'token' => 'TOKEN-DARI-ENV', 'body' => '{"to":"{phone}","text":"{message}"}']]);
        $this->assertTrue(app(WhatsAppSettings::class)->show()['has_token']);
        $this->as($this->admin)->putJson('/api/settings/whatsapp', $this->payload(['token' => '']))->assertOk()->assertJsonPath('data.has_token', true);   // no token typed: the one from .env moves along
        app(WhatsAppSettings::class)->applyToConfig();
        $this->assertSame('TOKEN-DARI-ENV', config('distriva_notifications.whatsapp.http.token'));
    }
}
