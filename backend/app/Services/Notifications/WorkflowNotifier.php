<?php

namespace App\Services\Notifications;

use App\Models\User;
use App\Services\Inventory\StockService;
use App\Services\WorkOrders\BastpService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Who must act next, and who must hear the outcome, in the application workflow (permohonan, survei, gambar, MTO, RKM) and the stock alert.
 * Recipients are always the holders of the grant that the next step requires, limited to the unit of the case, so a ULP never hears about another ULP.
 * Like InAppNotifier it can never fail the business action that called it.
 */
class WorkflowNotifier
{
    public function __construct(private readonly InAppNotifier $inbox) {}

    private function safely(callable $fn): void
    {
        try {
            $fn();
        } catch (Throwable $e) {
            Log::warning('In-app notification failed.', ['exception' => $e::class]);
        }
    }

    /** @param list<string> $ids */
    private function others(array $ids, User $actor): array
    {
        return array_values(array_diff(array_filter($ids), [(string) $actor->getKey()]));
    }

    // ---- permohonan --------------------------------------------------------------------------------------

    /** New customer applications of a ULP: the people who start surveys (MANAGER_ULP assigns, TEKNIK executes) are told. */
    public function applicationsArrived(string $unitId, int $count, User $actor, ?string $number = null): void
    {
        $this->safely(function () use ($unitId, $count, $actor, $number): void {
            if ($count < 1) {
                return;
            }
            $to = $this->others($this->inbox->holdersOf(['surveys.assign', 'surveys.execute'], $unitId), $actor);
            $this->inbox->toUsers($to, 'info', $count === 1 && $number ? "Permohonan baru {$number} masuk" : "{$count} permohonan baru masuk",
                'Permohonan siap disurvei. Buka daftar permohonan untuk menugaskan atau memulai survei.', 'Permohonan', '/permohonan');
        });
    }

    /** After an EIS import batch was applied: one notice per ULP with the number of NEW applications it received that can be surveyed (history is not announced). */
    public function importApplied(string $batchId, User $actor): void
    {
        $this->safely(function () use ($batchId, $actor): void {
            $rows = DB::table('application_import_staging as s')->join('applications as a', fn ($j) => $j->on('a.source_reference_id', '=', 's.source_reference_id')->where('a.source_type', 'BOT_DAFTUNG'))   // staging keeps no application_id for a NEW row: the agenda links them
                ->where('s.batch_id', $batchId)->where('s.action', 'NEW')->where('s.apply_status', 'APPLIED')->whereIn('a.current_status', ['APPROVED', 'PAID', 'PK_PRINTED'])   // history (done, cancelled, refunded) is not news
                ->groupBy('a.organizational_unit_id')->selectRaw('a.organizational_unit_id as unit, count(*) as n')->get();
            foreach ($rows as $r) {
                $this->applicationsArrived((string) $r->unit, (int) $r->n, $actor);
            }
        });
    }

    // ---- survei & gambar (rantai persetujuan dari config) ---------------------------------------------------

    /** Holders of every grant whose step is at $stage, in the unit of the case. */
    public function stepWaiting(string $stepsConfig, ?string $stage, string $unitId, string $subject, string $tag, string $link, User $actor): void
    {
        $this->safely(function () use ($stepsConfig, $stage, $unitId, $subject, $tag, $link, $actor): void {
            if ($stage === null) {
                return;
            }
            $keys = collect((array) config("distriva_permissions.{$stepsConfig}"))->where('stage', $stage)->pluck('key')->unique()->values()->all();
            $to = $this->others($this->inbox->holdersOf($keys, $unitId), $actor);
            $this->inbox->toUsers($to, 'warning', "{$subject} menunggu keputusan Anda", 'Tahap '.$stage.'. Buka untuk meninjau dan memutuskan.', $tag, $link);
        });
    }

    public function assigned(?string $assigneeId, string $subject, string $tag, string $link, User $actor): void
    {
        $this->safely(function () use ($assigneeId, $subject, $tag, $link, $actor): void {
            $this->inbox->toUsers($this->others([(string) $assigneeId], $actor), 'info', "{$subject} ditugaskan kepada Anda", null, $tag, $link);
        });
    }

    public function surveySubmitted(string $surveyId, User $actor): void
    {
        $this->safely(function () use ($surveyId, $actor): void {
            $s = $this->survey($surveyId);
            $this->stepWaiting('survey_steps', 'ULP_MANAGER', $s['unit'], "Survei {$s['number']}", 'Survei', "/survei/{$surveyId}", $actor);
        });
    }

    public function surveyDecided(string $surveyId, ?string $stageBefore, string $decision, ?string $notes, array $result, User $actor): void
    {
        $this->safely(function () use ($surveyId, $stageBefore, $decision, $notes, $result, $actor): void {
            $s = $this->survey($surveyId);
            $link = "/survei/{$surveyId}";
            if ($decision === 'REJECTED') {
                $this->inbox->toUsers($this->others([$s['assignee']], $actor), 'warning', "Survei {$s['number']} dikembalikan", 'Alasan: '.trim((string) $notes), 'Survei', $link);
            } elseif (($result['survey_status'] ?? null) === 'ACCEPTED') {
                $this->inbox->toUsers($this->others([$s['assignee']], $actor), 'success', "Survei {$s['number']} diterima", 'Survei disetujui Manager ULP.', 'Survei', $link);
                if (! empty($result['proposal_closed'])) {
                    $this->inbox->toUsers($this->others($this->inbox->holdersOf('proposals.manage', $s['unit']), $actor), 'info', "Usulan {$result['proposal_closed']} selesai tanpa perluasan",
                        'Hasil survei perwakilan: tidak memerlukan perluasan jaringan. Seluruh anggotanya kini berjalan sebagai permohonan biasa.', 'Permohonan', '/permohonan');
                }
            } elseif (($result['stage'] ?? null) !== $stageBefore) {
                $this->stepWaiting('survey_steps', $result['stage'] ?? null, $s['unit'], "Survei {$s['number']}", 'Survei', $link, $actor);
            }
        });
    }

    /** A cancelled proposal cancelled its running survey: whoever was waiting on it (and the surveyor) are told, so nobody keeps waiting for a task that no longer exists. @param array{survey_id:string,stage:?string,unit:string,number:string} $c */
    public function surveyCancelled(array $c, string $reason, User $actor): void
    {
        $this->safely(function () use ($c, $reason, $actor): void {
            $keys = $c['stage'] === null ? [] : collect((array) config('distriva_permissions.survey_steps'))->where('stage', $c['stage'])->pluck('key')->unique()->values()->all();
            $to = $this->others(array_unique(array_merge($keys === [] ? [] : $this->inbox->holdersOf($keys, $c['unit']), $this->inbox->holdersOf('surveys.execute', $c['unit']))), $actor);
            $this->inbox->toUsers($to, 'warning', "Survei {$c['number']} dibatalkan", 'Usulan perluasan dibatalkan: '.trim($reason), 'Survei', "/survei/{$c['survey_id']}");
        });
    }

    public function drawingSubmitted(string $drawingId, User $actor): void
    {
        $this->safely(function () use ($drawingId, $actor): void {
            $d = $this->drawing($drawingId);
            $this->stepWaiting('drawing_steps', 'ULP_MANAGER', $d['unit'], "Gambar {$d['number']}", 'Gambar', "/gambar/{$drawingId}", $actor);
        });
    }

    public function drawingDecided(string $drawingId, ?string $stageBefore, string $decision, ?string $notes, array $result, User $actor): void
    {
        $this->safely(function () use ($drawingId, $stageBefore, $decision, $notes, $result, $actor): void {
            $d = $this->drawing($drawingId);
            $link = "/gambar/{$drawingId}";
            if ($decision === 'REJECTED') {
                $this->inbox->toUsers($this->others([$d['assignee']], $actor), 'warning', "Gambar {$d['number']} dikembalikan", 'Alasan: '.trim((string) $notes), 'Gambar', $link);
            } elseif (($result['version_status'] ?? null) === 'APPROVED') {
                $this->inbox->toUsers($this->others([$d['assignee']], $actor), 'success', "Gambar {$d['number']} disetujui", 'Gambar dapat dipakai untuk menyusun MTO.', 'Gambar', $link);
                $this->inbox->toUsers($this->others($this->inbox->holdersOf('mto.execute', $d['unit']), $actor), 'info', "Gambar {$d['number']} disetujui", 'Siap disusun menjadi paket MTO.', 'MTO', $link);
            } elseif (($result['stage'] ?? null) !== $stageBefore) {
                $this->stepWaiting('drawing_steps', $result['stage'] ?? null, $d['unit'], "Gambar {$d['number']}", 'Gambar', $link, $actor);
            }
        });
    }

    // ---- MTO ---------------------------------------------------------------------------------------------

    public function mtoVerified(string $packageId, User $actor): void
    {
        $this->safely(function () use ($packageId, $actor): void {
            $m = $this->mto($packageId);
            $to = $this->others($this->inbox->holdersOf('mto.approve', $m['unit']), $actor);
            $this->inbox->toUsers($to, 'warning', "MTO {$m['number']} menunggu persetujuan Anda", 'Paket terverifikasi dan menunggu keputusan Manager ULP.', 'MTO', "/mto/{$packageId}");
        });
    }

    public function mtoDecided(string $packageId, string $decision, ?string $notes, User $actor): void
    {
        $this->safely(function () use ($packageId, $decision, $notes, $actor): void {
            $m = $this->mto($packageId);
            $to = $this->others([$m['creator'], $m['verifier']], $actor);
            $ok = $decision === 'APPROVED';
            $this->inbox->toUsers($to, $ok ? 'success' : 'warning', $ok ? "MTO {$m['number']} disetujui" : "MTO {$m['number']} dikembalikan",
                $ok ? 'Paket MTO disetujui.' : 'Alasan: '.trim((string) $notes), 'MTO', "/mto/{$packageId}");
            if ($ok) {
                $this->mtoApprovedForAllocation($packageId, $actor);
            }
        });
    }

    // ---- RKM ---------------------------------------------------------------------------------------------

    public function rkmSubmitted(string $proposalId, User $actor): void
    {
        $this->safely(function () use ($proposalId, $actor): void {
            $p = DB::table('rkm_proposals as p')->join('rkm_versions as v', 'v.id', '=', 'p.version_id')->join('rkm_plans as pl', 'pl.id', '=', 'v.plan_id')
                ->join('organizational_units as u', 'u.id', '=', 'p.ulp_unit_id')->where('p.id', $proposalId)->select('pl.up3_unit_id', 'pl.plan_number', 'u.name as ulp', 'p.version_id')->first();
            if ($p === null) {
                return;
            }
            $to = $this->others($this->inbox->holdersOf(['rkm.plan', 'rkm.validate_perencanaan', 'rkm.validate_konstruksi'], (string) $p->up3_unit_id), $actor);
            $this->inbox->toUsers($to, 'info', "Usulan RKM {$p->ulp} diajukan", "Rencana {$p->plan_number}. Validasi dapat dimulai setelah seluruh ULP mengajukan.", 'RKM', "/rkm/versions/{$p->version_id}");
        });
    }

    public function rkmDecided(string $versionId, string $step, string $decision, ?string $notes, User $actor): void
    {
        $this->safely(function () use ($versionId, $step, $decision, $notes, $actor): void {
            $v = DB::table('rkm_versions as v')->join('rkm_plans as pl', 'pl.id', '=', 'v.plan_id')->where('v.id', $versionId)->select('v.round', 'v.status', 'v.created_by', 'pl.up3_unit_id', 'pl.plan_number')->first();
            if ($v === null) {
                return;
            }
            $link = "/rkm/versions/{$versionId}";
            $submitters = DB::table('rkm_proposals')->where('version_id', $versionId)->whereNotNull('submitted_by')->pluck('submitted_by')->all();
            $owners = $this->others(array_merge($submitters, [(string) $v->created_by]), $actor);
            if ($decision === 'RETURNED') {
                $this->inbox->toUsers($owners, 'warning', "RKM {$v->plan_number} dikembalikan", 'Alasan: '.trim((string) $notes), 'RKM', $link);
            } elseif ($decision === 'REJECTED') {
                $this->inbox->toUsers($owners, 'error', "RKM {$v->plan_number} ditolak", 'Alasan: '.trim((string) $notes), 'RKM', $link);
            } elseif ($step === 'APPROVE_UP3_MANAGER') {
                $this->inbox->toUsers($owners, 'success', "RKM {$v->plan_number} disetujui", 'Versi RKM disetujui dan menjadi acuan kebutuhan material.', 'RKM', $link);
            } else {
                $validated = DB::table('rkm_decisions')->where('version_id', $versionId)->where('round', $v->round)->where('decision', 'APPROVED')->pluck('step')->all();
                if (in_array('VALIDATE_PERENCANAAN', $validated, true) && in_array('VALIDATE_KONSTRUKSI', $validated, true)) {
                    $to = $this->others($this->inbox->holdersOf('rkm.approve', (string) $v->up3_unit_id), $actor);
                    $this->inbox->toUsers($to, 'warning', "RKM {$v->plan_number} menunggu persetujuan akhir", 'Validasi PERENCANAAN dan KONSTRUKSI_UP3 selesai.', 'RKM', $link);
                }
            }
        });
    }

    // ---- WO Tiang -------------------------------------------------------------------------------------------

    /** ISSUED: the pole vendor's users hear it and Perencanaan sees it. */
    public function poleWoIssued(string $id, User $actor): void
    {
        $this->safely(function () use ($id, $actor): void {
            $w = $this->poleWo($id);
            $this->inbox->toUsers($this->others($this->vendorUsers($w['vendor']), $actor), 'info', "WO Tiang {$w['letter']} diterbitkan untuk Anda", 'Buka portal vendor untuk melihat lokasi tiang dan melaporkan progres.', 'WO Tiang', $w['link']);
            $this->inbox->toUsers($this->others([$w['creator']], $actor), 'success', "WO Tiang {$w['letter']} diterbitkan", 'Vendor tiang dapat mulai melaporkan progres.', 'WO Tiang', $w['link']);
        });
    }

    /** A revision: the vendor's users must look at the changed locations; Perencanaan (verifiers) are told too. */
    public function poleWoRevised(string $id, int $revision, string $reason, User $actor): void
    {
        $this->safely(function () use ($id, $revision, $reason, $actor): void {
            $w = $this->poleWo($id);
            $to = $this->others(array_merge($this->vendorUsers($w['vendor']), $this->inbox->holdersOf('pole_wo.manage', $w['unit']), [$w['creator']]), $actor);
            $this->inbox->toUsers($to, 'warning', "WO Tiang {$w['letter']} direvisi (revisi {$revision})", 'Rincian lokasi berubah. Alasan: '.trim($reason), 'WO Tiang', $w['link']);
        });
    }

    public function poleWoCancelled(string $id, string $reason, User $actor): void
    {
        $this->safely(function () use ($id, $reason, $actor): void {
            $w = $this->poleWo($id);
            $this->inbox->toUsers($this->others(array_merge([$w['creator']], $this->vendorUsers($w['vendor']), $this->inbox->holdersOf('pole_wo.manage', $w['unit'])), $actor), 'error', "WO Tiang {$w['letter']} dibatalkan", 'Alasan: '.trim($reason), 'WO Tiang', $w['link']);
        });
    }

    /** A vendor (or internal) progress report: the verifiers (Perencanaan) are asked. */
    public function poleProgressSubmitted(string $id, User $actor): void
    {
        $this->safely(function () use ($id, $actor): void {
            $w = $this->poleWo($id);
            $this->inbox->refreshOrCreate($this->others($this->inbox->holdersOf('pole_wo.manage', $w['unit']), $actor), 'warning', "Progres WO Tiang {$w['letter']} menunggu verifikasi", 'Ada laporan progres tiang baru yang perlu diverifikasi.', 'WO Tiang', $w['link']);
        });
    }

    public function poleProgressDecided(string $progressId, string $decision, ?string $reason, User $actor): void
    {
        $this->safely(function () use ($progressId, $decision, $reason, $actor): void {
            $p = DB::table('pole_wo_progress')->where('id', $progressId)->first();
            if ($p === null) {
                return;
            }
            $w = $this->poleWo((string) $p->pole_work_order_id);
            $ok = $decision === 'VERIFIED';
            $this->inbox->toUsers($this->others([(string) $p->submitted_by], $actor), $ok ? 'success' : 'warning', $ok ? "Progres WO Tiang {$w['letter']} terverifikasi" : "Progres WO Tiang {$w['letter']} dikembalikan",
                $ok ? 'Laporan progres Anda diverifikasi.' : 'Alasan: '.trim((string) $reason), 'WO Tiang', $w['link']);
        });
    }

    /** The pole BASTP is prepared: the closer (Asman Perencanaan) is asked. */
    public function poleBastpSubmitted(string $id, User $actor): void
    {
        $this->safely(function () use ($id, $actor): void {
            $w = $this->poleWo($id);
            $this->inbox->toUsers($this->others($this->inbox->holdersOf('pole_wo.close', $w['unit']), $actor), 'warning', "BASTP tiang WO {$w['letter']} menunggu penutupan", 'Semua lokasi sudah terverifikasi 100 %; BASTP menunggu keputusan Anda.', 'WO Tiang', $w['link']);
        });
    }

    /** CLOSE completes the pole WO (creator, Perencanaan and the vendor hear it); RETURN goes back to the preparer with the reason. */
    public function poleBastpDecided(string $bastpId, string $decision, ?string $reason, User $actor): void
    {
        $this->safely(function () use ($bastpId, $decision, $reason, $actor): void {
            $b = DB::table('pole_wo_bastp')->where('id', $bastpId)->first();
            if ($b === null) {
                return;
            }
            $w = $this->poleWo((string) $b->pole_work_order_id);
            if ($decision === 'RETURN') {
                $this->inbox->toUsers($this->others([(string) $b->prepared_by], $actor), 'warning', "BASTP tiang WO {$w['letter']} dikembalikan", 'Alasan: '.trim((string) $reason), 'WO Tiang', $w['link']);

                return;
            }
            $to = $this->others(array_merge([$w['creator'], (string) $b->prepared_by], $this->vendorUsers($w['vendor']), $this->inbox->holdersOf('pole_wo.manage', $w['unit'])), $actor);
            $this->inbox->toUsers($to, 'success', "WO Tiang {$w['letter']} selesai", 'BASTP tiang ditutup.', 'WO Tiang', $w['link']);
        });
    }

    /** @return array{letter:string,creator:string,vendor:?string,unit:string,link:string} */
    private function poleWo(string $id): array
    {
        $w = DB::table('pole_work_orders')->where('id', $id)->select('letter_number', 'created_by', 'vendor_company_id', 'up3_unit_id')->firstOrFail();
        $unit = DB::table('pole_wo_lines as l')->join('applications as a', 'a.id', '=', 'l.application_id')->where('l.pole_work_order_id', $id)->value('a.organizational_unit_id') ?? $w->up3_unit_id;

        return ['letter' => $w->letter_number, 'creator' => (string) $w->created_by, 'vendor' => $w->vendor_company_id, 'unit' => (string) $unit, 'link' => '/wo-tiang/'.$id];
    }

    // ---- work order, progres, BASTP, alokasi, permintaan material ---------------------------------------------

    public function woSubmitted(string $woId, User $actor): void
    {
        $this->safely(function () use ($woId, $actor): void {
            $w = $this->wo($woId);
            $to = $this->others($this->inbox->holdersOf('wo.issue', $w['unit']), $actor);
            $this->inbox->toUsers($to, 'warning', "WO {$w['number']} menunggu persetujuan penerbitan", 'WO dan vendor yang dipilih menunggu keputusan Anda.', 'Work Order', '/work-orders');
        });
    }

    /** ISSUE: the submitter, the vendor's users and the progress verifiers hear it, the material-request team gets a new outbox item. RETURN: the submitter with the reason. */
    public function woDecided(string $woId, string $decision, ?string $reason, User $actor): void
    {
        $this->safely(function () use ($woId, $decision, $reason, $actor): void {
            $w = $this->wo($woId);
            if ($decision === 'RETURN') {
                $this->inbox->toUsers($this->others([$w['submitter'], $w['creator']], $actor), 'warning', "WO {$w['number']} dikembalikan", 'Alasan: '.trim((string) $reason), 'Work Order', '/work-orders');

                return;
            }
            $this->inbox->toUsers($this->others([$w['submitter'], $w['creator']], $actor), 'success', "WO {$w['number']} diterbitkan", 'WO disetujui dan vendor dapat mulai bekerja.', 'Work Order', '/work-orders');
            $this->inbox->toUsers($this->others($this->vendorUsers($w['vendor']), $actor), 'info', "WO {$w['number']} diterbitkan untuk Anda", 'Buka portal vendor untuk melihat tugas dan melaporkan progres.', 'Work Order', '/work-orders');
            $this->inbox->toUsers($this->others(array_diff($this->inbox->holdersOf('wo.progress_verify', $w['unit']), [$w['creator'], $w['submitter']]), $actor), 'info', "WO {$w['number']} diterbitkan", 'Progres pekerjaan akan masuk untuk diverifikasi.', 'Work Order', '/work-orders');
            if (DB::table('material_requests')->where('work_order_id', $woId)->where('status', 'PENDING')->exists()) {
                $this->inbox->toUsers($this->others($this->inbox->holdersOf('material_requests.manage', $w['unit']), $actor), 'warning', "Permintaan material WO {$w['number']} perlu diserahkan",
                    'Ekspor permintaan lalu tandai diserahkan setelah form penyerahan (TUG 7) dicetak dan material diserahkan.', 'Material', '/material-requests');
            }
        });
    }

    public function woCancelled(string $woId, string $reason, User $actor): void
    {
        $this->safely(function () use ($woId, $reason, $actor): void {
            $w = $this->wo($woId);
            $to = $this->others(array_merge([$w['creator'], $w['submitter']], $this->vendorUsers($w['vendor']), $this->inbox->holdersOf('wo.progress_verify', $w['unit'])), $actor);
            $this->inbox->toUsers($to, 'error', "WO {$w['number']} dibatalkan", 'Alasan: '.trim($reason), 'Work Order', '/work-orders');
        });
    }

    public function progressSubmitted(string $woId, User $actor): void
    {
        $this->safely(function () use ($woId, $actor): void {
            $w = $this->wo($woId);
            $to = $this->others($this->inbox->holdersOf('wo.progress_verify', $w['unit']), $actor);
            $this->inbox->refreshOrCreate($to, 'warning', "Progres WO {$w['number']} menunggu verifikasi", 'Ada laporan progres baru yang perlu diverifikasi.', 'Work Order', '/work-orders');
        });
    }

    public function progressDecided(string $progressId, string $decision, ?string $reason, User $actor): void
    {
        $this->safely(function () use ($progressId, $decision, $reason, $actor): void {
            $p = DB::table('wo_progress')->where('id', $progressId)->first();
            if ($p === null) {
                return;
            }
            $w = $this->wo((string) $p->work_order_id);
            $ok = $decision === 'VERIFIED';
            $this->inbox->toUsers($this->others([(string) $p->submitted_by], $actor), $ok ? 'success' : 'warning', $ok ? "Progres WO {$w['number']} terverifikasi" : "Progres WO {$w['number']} dikembalikan",
                $ok ? 'Laporan progres Anda diverifikasi.' : 'Alasan: '.trim((string) $reason), 'Work Order', '/work-orders');
        });
    }

    /** After any BASTP signature: the holder of the next step is asked, or (closed) everyone involved hears the WO is complete. */
    public function bastpSigned(string $bastpId, User $actor): void
    {
        $this->safely(function () use ($bastpId, $actor): void {
            $b = $this->bastp($bastpId);
            $key = BastpService::reviewerKeyFor($b['status']);
            if ($key !== null) {
                $to = $this->others($this->inbox->holdersOf($key, $b['unit']), $actor);
                $this->inbox->toUsers($to, 'warning', "BASTP {$b['number']} menunggu tanda tangan Anda", 'Status '.$b['status'].'. Buka untuk memeriksa dan menandatangani.', 'BASTP', '/work-orders');
            } elseif ($b['status'] === 'CLOSED') {
                $to = $this->others(array_merge([$b['creator']], $this->vendorUsers($b['vendor']), $this->inbox->holdersOf(['wo.progress_verify', 'bastp.accept'], $b['unit'])), $actor);
                $this->inbox->toUsers($to, 'success', "BASTP {$b['number']} ditutup, WO selesai", 'Seluruh pekerjaan terverifikasi dan BASTP ditutup.', 'BASTP', '/work-orders');
            }
        });
    }

    public function bastpReturned(string $bastpId, string $reason, User $actor): void
    {
        $this->safely(function () use ($bastpId, $reason, $actor): void {
            $b = $this->bastp($bastpId);
            $to = $this->others(array_merge([$b['creator']], $this->vendorUsers($b['vendor'])), $actor);
            $this->inbox->toUsers($to, 'warning', "BASTP {$b['number']} dikembalikan", 'Alasan: '.trim($reason), 'BASTP', '/work-orders');
        });
    }

    /** Materials confirmed -> the pole side (PERENCANAAN) is asked and vice versa; both confirmed -> the WO team may start. */
    public function allocationConfirmed(string $allocationId, string $part, User $actor): void
    {
        $this->safely(function () use ($allocationId, $part, $actor): void {
            $a = DB::table('allocations as al')->join('applications as ap', 'ap.id', '=', 'al.application_id')->where('al.id', $allocationId)
                ->select('al.status', 'ap.organizational_unit_id as unit', 'ap.application_number')->first();
            if ($a === null) {
                return;
            }
            $unit = (string) $a->unit;
            if ($a->status === 'CONFIRMED') {
                $to = $this->others($this->inbox->holdersOf('wo.create', $unit), $actor);
                $this->inbox->toUsers($to, 'success', "Alokasi permohonan {$a->application_number} lengkap", 'Material dan tiang terkonfirmasi. Work order dapat disusun.', 'Alokasi', '/permohonan');

                return;
            }
            $key = $part === 'materials' ? 'allocations.poles' : 'allocations.manage';
            $label = $part === 'materials' ? 'tiang' : 'material';
            $this->inbox->toUsers($this->others($this->inbox->holdersOf($key, $unit), $actor), 'warning', "Alokasi {$a->application_number} menunggu konfirmasi {$label}", 'Bagian lain sudah dikonfirmasi.', 'Alokasi', '/permohonan');
        });
    }

    /** An approved MTO is the starting gun of the allocation: both allocation roles of the unit are told. */
    public function mtoApprovedForAllocation(string $packageId, User $actor): void
    {
        $this->safely(function () use ($packageId, $actor): void {
            $m = $this->mto($packageId);
            $to = $this->others($this->inbox->holdersOf(['allocations.manage', 'allocations.poles'], $m['unit']), $actor);
            $this->inbox->toUsers($to, 'info', "MTO {$m['number']} disetujui: alokasi dapat dibuat", 'Susun alokasi material dan tiang untuk permohonan ini.', 'Alokasi', '/permohonan');
        });
    }

    // ---- stok --------------------------------------------------------------------------------------------

    /**
     * After a stock snapshot of a warehouse was stored: materials whose available stock is below the safety stock (the rule of the RKM report:
     * safety > 0 and on_hand - reserved - allocated < safety). One refreshed alert per warehouse, to whoever imports stock for that unit.
     */
    public function lowStock(string $warehouseId, string $asOf): void
    {
        $this->safely(function () use ($warehouseId, $asOf): void {
            $wh = DB::table('warehouses')->where('id', $warehouseId)->first();
            if ($wh === null) {
                return;
            }
            $low = collect(app(StockService::class)->position([$warehouseId], $asOf))->filter(fn ($p) => $p['safety'] > 0 && $p['available'] < $p['safety'])->count();
            if ($low === 0) {
                return;
            }
            $to = $this->inbox->holdersOf('stock.import', (string) $wh->organizational_unit_id);
            $this->inbox->refreshOrCreate($to, 'warning', "Stok menipis: {$wh->name}", "{$low} material berada di bawah stok pengaman per {$asOf}.", 'Stok', '/master-data/warehouses');
        });
    }

    /**
     * The scheduled MIMS pull was refused because the token is rejected or expired: tell every holder of stock.import (the token is shared by all warehouses, so no unit filter).
     * One refreshed alert while it stays unread, so a nightly failure does not pile up. The text never carries the token.
     */
    public function mimsTokenRejected(): void
    {
        $this->safely(function (): void {
            $this->inbox->refreshOrCreate($this->inbox->holdersOf('stock.import'), 'error', 'Sinkron stok MIMS gagal: token ditolak atau kedaluwarsa',
                'Ganti DISTRIVA_MIMS_AUTH_TOKEN di pengaturan server dengan token sesi MIMS yang baru, atau tarik stok manual dari halaman Gudang. Stok tidak diperbarui sampai token diganti.', 'Stok', '/master-data/warehouses');
        });
    }

    // ---- lookups -----------------------------------------------------------------------------------------

    private function survey(string $id): array
    {
        $s = DB::table('application_surveys as s')->join('applications as a', 'a.id', '=', 's.application_id')->where('s.id', $id)->select('s.survey_number', 's.assigned_to', 'a.organizational_unit_id')->firstOrFail();

        return ['number' => $s->survey_number, 'assignee' => (string) $s->assigned_to, 'unit' => (string) $s->organizational_unit_id];
    }

    private function drawing(string $id): array
    {
        $d = DB::table('application_drawings as d')->join('applications as a', 'a.id', '=', 'd.application_id')->where('d.id', $id)->select('d.drawing_number', 'd.assigned_to', 'a.organizational_unit_id')->firstOrFail();

        return ['number' => $d->drawing_number, 'assignee' => (string) $d->assigned_to, 'unit' => (string) $d->organizational_unit_id];
    }

    /** @return list<string> active accounts of a vendor company */
    private function vendorUsers(?string $companyId): array
    {
        if ($companyId === null) {
            return [];
        }

        return DB::table('vendor_accounts as a')->join('users as u', 'u.id', '=', 'a.user_id')->where('a.vendor_company_id', $companyId)->where('a.is_active', true)
            ->where('u.account_status', 'ACTIVE')->pluck('u.id')->all();
    }

    private function wo(string $id): array
    {
        $w = DB::table('work_orders as w')->join('applications as a', 'a.id', '=', 'w.application_id')->where('w.id', $id)
            ->select('w.wo_number', 'w.created_by', 'w.submitted_by', 'w.vendor_company_id', 'a.organizational_unit_id')->firstOrFail();

        return ['number' => $w->wo_number, 'creator' => (string) $w->created_by, 'submitter' => (string) $w->submitted_by, 'vendor' => $w->vendor_company_id, 'unit' => (string) $w->organizational_unit_id];
    }

    private function bastp(string $id): array
    {
        $b = DB::table('bastps as b')->join('work_orders as w', 'w.id', '=', 'b.work_order_id')->join('applications as a', 'a.id', '=', 'b.application_id')->where('b.id', $id)
            ->select('b.bastp_number', 'b.status', 'b.created_by', 'w.wo_number', 'w.vendor_company_id', 'a.organizational_unit_id')->firstOrFail();

        return ['number' => $b->bastp_number ?? $b->wo_number, 'status' => $b->status, 'creator' => (string) $b->created_by, 'vendor' => $b->vendor_company_id, 'unit' => (string) $b->organizational_unit_id];
    }

    private function mto(string $id): array
    {
        $m = DB::table('mto_packages as m')->join('applications as a', 'a.id', '=', 'm.application_id')->where('m.id', $id)->select('m.package_number', 'm.created_by', 'm.verified_by', 'a.organizational_unit_id')->firstOrFail();

        return ['number' => $m->package_number, 'creator' => (string) $m->created_by, 'verifier' => (string) $m->verified_by, 'unit' => (string) $m->organizational_unit_id];
    }
}
