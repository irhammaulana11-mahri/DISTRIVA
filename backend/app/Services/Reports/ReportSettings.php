<?php

namespace App\Services\Reports;

use App\Exceptions\AssignmentRuleViolation;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/** The parameters of the stock and vendor reports, kept by the administrator (report_settings); defaults apply to whatever was never set. */
class ReportSettings
{
    private const KEY = 'reports';

    public const DEFAULTS = [
        'stock' => ['usage_months' => 3, 'warning_factor' => 1.5],
        'vendor' => ['weight_completion' => 40, 'weight_timeliness' => 20, 'weight_quality' => 25, 'weight_discipline' => 15, 'stale_days' => 7, 'good_min' => 80, 'fair_min' => 60],
    ];

    /** @return array{stock:array<string,float|int>,vendor:array<string,int>} */
    public function get(): array
    {
        $stored = json_decode((string) DB::table('report_settings')->where('key', self::KEY)->value('value'), true) ?: [];

        return [
            'stock' => array_replace(self::DEFAULTS['stock'], (array) ($stored['stock'] ?? [])),
            'vendor' => array_replace(self::DEFAULTS['vendor'], (array) ($stored['vendor'] ?? [])),
        ];
    }

    /**
     * @param  array{stock:array<string,float|int>,vendor:array<string,int>}  $new
     * @return array{stock:array<string,float|int>,vendor:array<string,int>}
     */
    public function save(array $new, User $actor): array
    {
        $v = $new['vendor'];
        if ($v['weight_completion'] + $v['weight_timeliness'] + $v['weight_quality'] + $v['weight_discipline'] !== 100) {
            throw new AssignmentRuleViolation('Jumlah bobot skor vendor harus tepat 100.');
        }
        if ($v['good_min'] <= $v['fair_min']) {
            throw new AssignmentRuleViolation('Batas "Baik" harus lebih tinggi dari batas "Cukup".');
        }
        DB::table('report_settings')->updateOrInsert(['key' => self::KEY], ['value' => json_encode($new), 'updated_by' => $actor->getKey(), 'updated_at' => now()]);

        return $this->get();
    }
}
