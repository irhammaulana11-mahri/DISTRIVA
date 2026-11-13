<?php

use App\Exceptions\AdministrationDenied;
use App\Exceptions\AssignmentRuleViolation;
use App\Exceptions\NotificationFailed;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        //
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->dontFlash(['token']);                                       // the MIMS session token of an on-demand stock pull is never flashed or reported

        // Business-rule refusals (403/404/409) are an expected answer, not a fault: keep them out of the error log so real errors stay visible.
        $exceptions->dontReport([AdministrationDenied::class, AssignmentRuleViolation::class]);

        // Administration failures carry their own HTTP status (403 / 404 / 409).
        $exceptions->render(fn (AdministrationDenied $e) => response()->json(['message' => $e->getMessage()], $e->status));
        $exceptions->render(fn (AssignmentRuleViolation $e) => response()->json(['message' => $e->getMessage()], 409));

        $exceptions->render(fn (NotificationFailed $e) => response()->json([
            'message' => 'Kredensial tidak dapat dikirim lewat kanal mana pun; tidak ada perubahan yang disimpan.',
            'delivery' => ['delivered' => [], 'failed' => array_keys($e->report->failed), 'skipped' => $e->report->skipped],
        ], 503));

        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->expectsJson(),
        );
    })->create();
