<?php

namespace App\Services\Tasks;

use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Support\Facades\DB;

/** Working days of the SLA (docs/16 §3): Monday to Friday except the dates in `business_holidays`, in the business time zone. A deadline is the END of its day. */
class BusinessCalendar
{
    /** @var array<string,true>|null */
    private ?array $holidays = null;

    public function isWorkingDay(CarbonInterface $day): bool
    {
        return ! $day->isWeekend() && ! isset($this->holidays()[$day->toDateString()]);
    }

    /** The deadline: `$days` working days after the day of `$from` (the day of assignment itself does not count), at 23:59:59 local time. */
    public function dueAt(CarbonInterface $from, int $days): CarbonImmutable
    {
        $day = CarbonImmutable::parse($from)->setTimezone($this->zone())->startOfDay();
        for ($left = max(1, $days); $left > 0;) {
            $day = $day->addDay();
            if ($this->isWorkingDay($day)) {
                $left--;
            }
        }

        return $day->endOfDay();
    }

    /** Working days still to run after today up to and including the day of `$due` (0 when the deadline is today or past). */
    public function workingDaysLeft(CarbonInterface $due, ?CarbonInterface $now = null): int
    {
        return $this->workingDaysBetween($now ?? now(), $due);
    }

    /** Working days in the span after the day of `$from` up to and including the day of `$to` (0 when `$to` is not later). */
    public function workingDaysBetween(CarbonInterface $from, CarbonInterface $to): int
    {
        $day = CarbonImmutable::parse($from)->setTimezone($this->zone())->startOfDay();
        $end = CarbonImmutable::parse($to)->setTimezone($this->zone())->startOfDay();
        $count = 0;
        while ($day->lt($end)) {
            $day = $day->addDay();
            if ($this->isWorkingDay($day)) {
                $count++;
            }
        }

        return $count;
    }

    private function zone(): string
    {
        return (string) config('distriva.business_timezone');
    }

    /** @return array<string,true> */
    private function holidays(): array
    {
        return $this->holidays ??= array_fill_keys(DB::table('business_holidays')->pluck('holiday_date')->map(fn ($d) => substr((string) $d, 0, 10))->all(), true);
    }
}
