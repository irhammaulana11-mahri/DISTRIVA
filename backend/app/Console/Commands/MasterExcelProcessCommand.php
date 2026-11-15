<?php

namespace App\Console\Commands;

use App\Services\Master\MasterExcelImportService;
use Illuminate\Console\Command;

/** Internal: reads an uploaded master workbook and builds the comparison report in a detached process. */
class MasterExcelProcessCommand extends Command
{
    protected $signature = 'distriva:master-excel-process {id}';

    protected $description = 'Internal: memeriksa Excel master yang diunggah dari layar.';

    protected $hidden = true;

    public function handle(MasterExcelImportService $svc): int
    {
        $svc->process((string) $this->argument('id'));

        return self::SUCCESS;
    }
}
