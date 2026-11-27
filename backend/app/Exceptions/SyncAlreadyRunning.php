<?php

namespace App\Exceptions;

use Illuminate\Http\JsonResponse;
use RuntimeException;

/** Data yang sama sedang antre atau berjalan; respons membawa run yang aktif agar progresnya dapat langsung ditampilkan. */
class SyncAlreadyRunning extends RuntimeException
{
    /**
     * @param  array{id: string, name: ?string}|null  $triggeredBy
     * @param  array{id: string, name: ?string, type: ?string}|null  $scope  tingkat run yang sedang berjalan (UP3 atau ULP)
     * @param  list<array{id: string, name: ?string}>  $targets  ULP atau gudang yang bentrok
     */
    public function __construct(public readonly string $activeRunId, public readonly ?array $triggeredBy, public readonly ?array $scope = null, public readonly array $targets = [])
    {
        $what = implode(', ', array_filter(array_column($targets, 'name'))) ?: 'Data ini';
        $by = ($scope['name'] ?? null) === null ? 'run lain' : "run {$scope['name']}";
        $who = ($triggeredBy['name'] ?? null) === null ? '' : " (dipicu {$triggeredBy['name']})";
        parent::__construct("{$what} sedang disinkronkan oleh {$by}{$who}; tunggu sampai selesai.");
    }

    public function render(): JsonResponse
    {
        return response()->json(['message' => $this->getMessage(), 'active_run_id' => $this->activeRunId, 'triggered_by' => $this->triggeredBy, 'scope' => $this->scope, 'conflicts' => $this->targets], 409);
    }
}
