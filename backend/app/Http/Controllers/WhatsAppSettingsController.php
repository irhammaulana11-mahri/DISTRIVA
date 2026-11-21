<?php

namespace App\Http\Controllers;

use App\Services\Authorization\CatalogAuthorizer;
use App\Services\Notifications\WhatsApp\WhatsAppSettings;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;

/** Menu Pengaturan > WhatsApp: the gateway used for notifications and OTP. SYS_ADMIN only (it holds an API token); the token is never returned. */
class WhatsAppSettingsController extends Controller
{
    private const KEY = 'whatsapp.settings.manage';

    public function __construct(private readonly CatalogAuthorizer $authorizer, private readonly WhatsAppSettings $settings) {}

    public function show(Request $request): JsonResponse
    {
        $this->authorizer->authorize($request->user(), self::KEY);

        return response()->json(['data' => $this->settings->show(), 'events' => $this->settings->events()]);
    }

    public function save(Request $request): JsonResponse
    {
        $actor = $request->user();
        $this->authorizer->authorize($actor, self::KEY);
        $d = Validator::make($request->all(), [
            'driver' => ['required', Rule::in(['null', 'log', 'http'])], 'url' => ['nullable', 'string', 'max:500'], 'method' => ['required', Rule::in(['POST', 'GET'])],
            'auth_header' => ['required', 'string', 'max:60', 'regex:/^[A-Za-z0-9\-_]+$/'], 'auth_prefix' => ['nullable', 'string', 'max:30'],
            'token' => ['nullable', 'string', 'max:500'], 'clear_token' => ['sometimes', 'boolean'], 'body_format' => ['required', Rule::in(['form', 'json'])],
            'body' => ['nullable', 'string', 'max:2000'], 'success_path' => ['nullable', 'string', 'max:100'], 'success_value' => ['required', 'string', 'max:60'],
            'timeout' => ['required', 'integer', 'between:1,60'], 'default_country_code' => ['required', 'regex:/^[0-9]{1,4}$/'],
        ])->validate();

        return response()->json(['data' => $this->settings->save($d, $actor), 'events' => $this->settings->events(), 'message' => 'Pengaturan WhatsApp disimpan.']);
    }

    public function test(Request $request): JsonResponse
    {
        $actor = $request->user();
        $this->authorizer->authorize($actor, self::KEY);
        $d = Validator::make($request->all(), ['phone' => ['required', 'string', 'max:30']])->validate();

        return response()->json(['data' => $this->settings->sendTest($d['phone'], $actor), 'events' => $this->settings->events()]);
    }
}
