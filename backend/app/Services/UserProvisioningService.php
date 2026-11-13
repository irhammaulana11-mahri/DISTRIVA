<?php

namespace App\Services;

use App\Exceptions\AssignmentRuleViolation;
use App\Models\OrganizationalUnit;
use App\Models\Role;
use App\Models\User;
use App\Models\UserRoleAssignment;
use App\Services\Authorization\AssignmentWriteService;
use App\Services\Notifications\DeliveryReport;
use App\Services\Notifications\Message;
use App\Services\Notifications\NotificationDispatcher;
use App\Services\Notifications\Recipient;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Creates users (owner decision 2026-11-06): the administrator creates the account in the web app; the person
 * activates it themselves with a one-time code (OTP) sent to their e-mail/WhatsApp (OtpService). No password is
 * ever issued, sent or known to anyone else: the account starts PENDING_ACTIVATION with an unusable random hash.
 *
 * The invitation carries no secret, so a delivery failure does not undo the creation — the result reports which
 * channels worked and the invitation can be re-sent. Callers must authorize the actor first.
 */
class UserProvisioningService
{
    public function __construct(
        private readonly AssignmentWriteService $assignments,
        private readonly NotificationDispatcher $notifier,
    ) {}

    /**
     * @param  array{name: string, email: string, phone?: ?string, nip?: ?string}  $profile
     * @return array{user: User, assignment: UserRoleAssignment, delivery: DeliveryReport}
     */
    public function createWithAssignment(
        array $profile,
        Role $role,
        OrganizationalUnit $unit,
        string $validFrom,
        ?string $validUntil,
        string $document,
        string $reason,
        User $actor,
    ): array {
        [$user, $assignment] = DB::transaction(function () use ($profile, $role, $unit, $validFrom, $validUntil, $document, $reason, $actor): array {
            $user = new User([
                'name' => trim($profile['name']), 'email' => $profile['email'], 'phone' => $profile['phone'] ?? null,
                'nip' => $profile['nip'] ?? null,
                'password' => Str::random(64), // unusable: nobody knows it; the user sets their own during activation
                'account_status' => 'PENDING_ACTIVATION',
            ]);
            $user->must_change_password = true;
            $user->save();

            $assignment = $this->assignments->assign($user, $role, $unit, $validFrom, $validUntil, $reason, $actor, null, $document);
            $this->audit('USER_CREATED', $user, $actor, ['account_status' => 'PENDING_ACTIVATION', 'role' => $role->name, 'unit' => $unit->code], $reason);

            return [$user, $assignment];
        });

        return ['user' => $user, 'assignment' => $assignment, 'delivery' => $this->invite($user)];
    }

    /** Re-send the activation invitation to an account that has not been activated yet. */
    public function resendInvitation(User $target, string $reason, User $actor): DeliveryReport
    {
        if ($target->account_status !== 'PENDING_ACTIVATION') {
            throw new AssignmentRuleViolation('Pengguna sudah diaktifkan; undangan aktivasi tidak diperlukan.');
        }

        $this->audit('USER_INVITATION_SENT', $target, $actor, ['account_status' => 'PENDING_ACTIVATION'], $reason);

        return $this->invite($target);
    }

    private function invite(User $user): DeliveryReport
    {
        $base = (string) config('distriva.frontend_url');
        $where = $base !== '' ? "Buka {$base}/aktivasi" : 'Buka halaman Aktivasi akun DISTRIVA';

        return $this->notifier->send(
            new Recipient($user->name, $user->email, $user->phone),
            new Message(
                'Undangan aktivasi akun DISTRIVA',
                "Halo {$user->name},\n\nAkun DISTRIVA Anda telah dibuat oleh administrator.\n"
                ."{$where}, masukkan email {$user->email}, lalu masukkan kode OTP yang akan dikirim ke email/WhatsApp Anda dan buat password Anda sendiri.\n\n"
                .'Administrator tidak pernah meminta password atau kode OTP Anda.',
                sensitive: false,
            ),
        );
    }

    private function audit(string $event, User $user, User $actor, array $after, string $reason): void
    {
        DB::table('authorization_change_histories')->insert([
            'id' => (string) Str::uuid(), 'event_type' => $event, 'user_id' => $user->getKey(),
            'actor_user_id' => $actor->getKey(), 'before_values' => null,
            'after_values' => json_encode($after), 'reason' => trim($reason), 'changed_at' => now(),
        ]);
    }
}
