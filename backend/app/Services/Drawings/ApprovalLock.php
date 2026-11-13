<?php

namespace App\Services\Drawings;

use App\Exceptions\AssignmentRuleViolation;
use Illuminate\Support\Facades\DB;

/**
 * Once the drawing + MTO package of an application is approved in full (version APPROVED), the RAB and KKF that the approval rested on are frozen:
 * a new run would change a signed basis. To change anything the drawing is revised (a new version reopens the chain).
 */
class ApprovalLock
{
    public static function assertOpen(string $applicationId, string $what): void
    {
        $approved = DB::table('application_drawing_versions as v')->join('application_drawings as d', 'd.id', '=', 'v.drawing_id')
            ->where('d.application_id', $applicationId)->where('v.status', 'APPROVED')->exists();
        if ($approved) {
            throw new AssignmentRuleViolation("Paket gambar dan MTO sudah disetujui seluruhnya; {$what} dikunci. Untuk mengubah, revisi paket gambar (versi baru).");
        }
    }
}
