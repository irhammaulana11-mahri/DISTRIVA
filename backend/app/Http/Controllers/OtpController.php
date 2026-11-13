<?php

namespace App\Http\Controllers;

use App\Services\OtpService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

class OtpController extends Controller
{
    private const PURPOSES = ['activation' => OtpService::ACTIVATION, 'recovery' => OtpService::RECOVERY];

    public function request(Request $request, OtpService $otp): JsonResponse
    {
        $data = $request->validate([
            'email' => ['required', 'string', 'email', 'max:150'],
            'purpose' => ['required', Rule::in(array_keys(self::PURPOSES))],
        ]);

        if (! $otp->request($data['email'], self::PURPOSES[$data['purpose']])) {
            return response()->json(['message' => 'Terlalu banyak permintaan kode. Coba lagi nanti.'], 429);
        }

        // Identical for existing, unknown, ineligible and rate-limited-by-cooldown addresses.
        return response()->json([
            'message' => 'Jika akun memenuhi syarat, kode OTP telah dikirim lewat email/WhatsApp yang terdaftar. Kode berlaku '.config('distriva.otp.ttl_minutes').' menit.',
        ], 202);
    }

    public function verify(Request $request, OtpService $otp): JsonResponse
    {
        $data = Validator::make($request->all(), [
            'email' => ['required', 'string', 'email', 'max:150'],
            'purpose' => ['required', Rule::in(array_keys(self::PURPOSES))],
            'otp' => ['required', 'string', 'regex:/^\d{'.(int) config('distriva.otp.length').'}$/'],
            'password' => ['required', 'string', 'max:255', 'confirmed'],
        ], ['otp.regex' => 'Kode OTP harus '.(int) config('distriva.otp.length').' digit.'])->validate();

        $purpose = self::PURPOSES[$data['purpose']];
        $result = $otp->verify($data['email'], $purpose, $data['otp'], $data['password']);

        if ($result !== 'ok') {
            return response()->json(['message' => 'Kode OTP salah atau sudah kedaluwarsa.'], 422);
        }

        // A successful recovery must unlock at once: also forget this address' failed-login throttle on this IP.
        RateLimiter::clear(md5('login'.'login|'.$request->ip().'|'.sha1(Str::lower(trim($data['email'])))));

        return response()->json([
            'message' => $purpose === OtpService::ACTIVATION ? 'Akun berhasil diaktifkan. Silakan masuk.' : 'Password berhasil diubah. Silakan masuk.',
        ]);
    }
}
