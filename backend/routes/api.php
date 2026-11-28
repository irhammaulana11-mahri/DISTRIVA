<?php

use App\Http\Controllers\Admin\AdminController;
use App\Http\Controllers\AllocationController;
use App\Http\Controllers\ApplicationController;
use App\Http\Controllers\ApplicationImportController;
use App\Http\Controllers\AuthController;
use App\Http\Controllers\BackupController;
use App\Http\Controllers\BastpController;
use App\Http\Controllers\BusinessAnalyticsController;
use App\Http\Controllers\ConnectionController;
use App\Http\Controllers\DocumentController;
use App\Http\Controllers\DrawingController;
use App\Http\Controllers\EisReportController;
use App\Http\Controllers\EisSyncController;
use App\Http\Controllers\FeederController;
use App\Http\Controllers\ForecastController;
use App\Http\Controllers\KkfController;
use App\Http\Controllers\KkoController;
use App\Http\Controllers\MasterData\BomController;
use App\Http\Controllers\MasterData\CatalogController;
use App\Http\Controllers\MasterData\ConstructionTypeController;
use App\Http\Controllers\MasterData\InventoryController;
use App\Http\Controllers\MasterData\KhsController;
use App\Http\Controllers\MasterData\KkfParameterController;
use App\Http\Controllers\MasterData\MasterExcelImportController;
use App\Http\Controllers\MasterData\MaterialController;
use App\Http\Controllers\MasterData\MaterialImportController;
use App\Http\Controllers\MasterData\PriceBookController;
use App\Http\Controllers\MasterData\TariffBookController;
use App\Http\Controllers\MasterData\VendorController;
use App\Http\Controllers\MaterialRequestController;
use App\Http\Controllers\MaximoSyncController;
use App\Http\Controllers\MfaController;
use App\Http\Controllers\MtoController;
use App\Http\Controllers\NkoController;
use App\Http\Controllers\NkoDefinitionUploadController;
use App\Http\Controllers\NkoRuleController;
use App\Http\Controllers\NkoTargetUploadController;
use App\Http\Controllers\NotificationController;
use App\Http\Controllers\OtpController;
use App\Http\Controllers\OutageAnalysisController;
use App\Http\Controllers\OutageSyncController;
use App\Http\Controllers\OutputDocumentController;
use App\Http\Controllers\PlanningAccessController;
use App\Http\Controllers\PoleWorkOrderController;
use App\Http\Controllers\ProposalController;
use App\Http\Controllers\RabController;
use App\Http\Controllers\ReportController;
use App\Http\Controllers\RkmController;
use App\Http\Controllers\ScopedUnitController;
use App\Http\Controllers\ServiceSlaController;
use App\Http\Controllers\SrReservationController;
use App\Http\Controllers\SrVendorContractController;
use App\Http\Controllers\SubstationController;
use App\Http\Controllers\SurveyController;
use App\Http\Controllers\SyncAccountController;
use App\Http\Controllers\SyncStatusController;
use App\Http\Controllers\TaskController;
use App\Http\Controllers\WhatsAppSettingsController;
use App\Http\Controllers\WorkOrderController;
use App\Http\Middleware\EnsureActiveAccount;
use Illuminate\Support\Facades\Route;

Route::post('/auth/otp/request', [OtpController::class, 'request'])->middleware('throttle:otp-request');
Route::post('/auth/otp/verify', [OtpController::class, 'verify'])->middleware('throttle:otp-verify');
Route::post('/auth/login', [AuthController::class, 'login'])->middleware('throttle:login');

Route::middleware(['auth:sanctum', EnsureActiveAccount::class])->group(function () {
    Route::post('/auth/logout', [AuthController::class, 'logout']);
    Route::get('/me', [AuthController::class, 'me']);
    Route::prefix('auth/mfa')->middleware('throttle:mfa')->group(function () {
        Route::get('/', [MfaController::class, 'status']);
        Route::post('/enroll', [MfaController::class, 'begin']);
        Route::post('/confirm', [MfaController::class, 'confirm']);
        Route::post('/verify', [MfaController::class, 'verify']);
    });
    Route::post('/me/password', [AuthController::class, 'changePassword'])->middleware('throttle:password-change');

    Route::get('/notifications', [NotificationController::class, 'index']);
    Route::post('/notifications/read-all', [NotificationController::class, 'markAllRead']);
    Route::post('/notifications/{notification}/read', [NotificationController::class, 'markRead'])->whereUuid('notification');

    Route::prefix('admin')->middleware('throttle:admin')->group(function () {
        Route::get('/access', [AdminController::class, 'access']);
        Route::get('/roles', [AdminController::class, 'roles']);
        Route::get('/users/{user}', [AdminController::class, 'user'])->whereUuid('user');
        Route::get('/organizational-units', [AdminController::class, 'units']);
        Route::get('/organizational-units/{unit}', [AdminController::class, 'unit'])->whereUuid('unit');
        Route::post('/organizational-units', [AdminController::class, 'createUnit']);
        Route::post('/organizational-units/{unit}', [AdminController::class, 'updateUnit'])->whereUuid('unit');
        Route::patch('/organizational-units/{unit}', [AdminController::class, 'updateUnit'])->whereUuid('unit');
        Route::get('/users', [AdminController::class, 'users']);
        Route::get('/users/{user}/assignments', [AdminController::class, 'userAssignments'])->whereUuid('user');
        Route::post('/users', [AdminController::class, 'createUser']);
        Route::patch('/users/{user}', [AdminController::class, 'updateUser'])->whereUuid('user');
        Route::post('/users/{user}/resend-invitation', [AdminController::class, 'resendInvitation'])->whereUuid('user');
        Route::post('/users/{user}/status', [AdminController::class, 'changeStatus'])->whereUuid('user');
        Route::post('/role-assignments', [AdminController::class, 'assign']);
        Route::post('/role-assignments/{assignment}/end', [AdminController::class, 'end'])->whereUuid('assignment');
    });

    // PB/PD applications (stage 1A, docs/62): scoped by ULP (ApplicationAuthorizer).
    Route::prefix('applications')->middleware('throttle:admin')->group(function () {
        Route::get('/access', [ApplicationController::class, 'access']);
        Route::get('/units', [ApplicationController::class, 'units']);
        Route::get('/attention', [ApplicationController::class, 'attention']);
        Route::get('/', [ApplicationController::class, 'index']);
        Route::post('/', [ApplicationController::class, 'store']);
        Route::get('/imports', [ApplicationImportController::class, 'index']);
        Route::post('/imports', [ApplicationImportController::class, 'store']);
        Route::get('/imports/limits', [ApplicationImportController::class, 'limits']);
        Route::get('/imports/stale', [ApplicationImportController::class, 'stale']);
        Route::get('/imports/{batch}', [ApplicationImportController::class, 'show'])->whereUuid('batch');
        Route::post('/imports/{batch}/confirm', [ApplicationImportController::class, 'confirm'])->whereUuid('batch');
        Route::post('/imports/{batch}/discard', [ApplicationImportController::class, 'discard'])->whereUuid('batch');
        Route::get('/{application}', [ApplicationController::class, 'show'])->whereUuid('application');
        Route::patch('/{application}', [ApplicationController::class, 'update'])->whereUuid('application');
        Route::post('/{application}/submit', [ApplicationController::class, 'submit'])->whereUuid('application');
        Route::post('/{application}/cancel', [ApplicationController::class, 'cancel'])->whereUuid('application');
        Route::post('/{application}/external-references', [ApplicationController::class, 'addReference'])->whereUuid('application');
        Route::get('/{application}/surveys', [SurveyController::class, 'index'])->whereUuid('application');
        Route::get('/{application}/surveys/surveyors', [SurveyController::class, 'surveyors'])->whereUuid('application');
        Route::post('/{application}/surveys', [SurveyController::class, 'store'])->whereUuid('application');
        Route::get('/{application}/documents', [DocumentController::class, 'indexForApplication'])->whereUuid('application');
        Route::get('/{application}/drawing', [DrawingController::class, 'forApplication'])->whereUuid('application');
        Route::get('/{application}/drawing/authors', [DrawingController::class, 'authors'])->whereUuid('application');
        Route::post('/{application}/drawing', [DrawingController::class, 'store'])->whereUuid('application');
    });

    // Survey workflow and documents (stage 2).
    Route::prefix('surveys')->middleware('throttle:admin')->group(function () {
        Route::get('/access', [SurveyController::class, 'access']);
        Route::get('/', [SurveyController::class, 'requests']);
        Route::get('/{survey}', [SurveyController::class, 'show'])->whereUuid('survey');
        Route::post('/{survey}/reassign', [SurveyController::class, 'reassign'])->whereUuid('survey');
        Route::post('/{survey}/cancel', [SurveyController::class, 'cancel'])->whereUuid('survey');
        Route::patch('/{survey}/versions/{version}', [SurveyController::class, 'updateDraft'])->whereUuid(['survey', 'version']);
        Route::post('/{survey}/versions/{version}/submit', [SurveyController::class, 'submit'])->whereUuid(['survey', 'version']);
        Route::post('/{survey}/versions/{version}/decisions', [SurveyController::class, 'decide'])->whereUuid(['survey', 'version']);
        Route::post('/{survey}/versions/{version}/documents', [DocumentController::class, 'uploadToSurvey'])->whereUuid(['survey', 'version']);
    });
    // Technical drawing package (stage 3).
    Route::prefix('drawings')->middleware('throttle:admin')->group(function () {
        Route::get('/access', [DrawingController::class, 'access']);
        Route::get('/{drawing}', [DrawingController::class, 'show'])->whereUuid('drawing');
        Route::post('/{drawing}/reassign', [DrawingController::class, 'reassign'])->whereUuid('drawing');
        Route::post('/{drawing}/versions', [DrawingController::class, 'revise'])->whereUuid('drawing');
        Route::patch('/{drawing}/versions/{version}', [DrawingController::class, 'updateDraft'])->whereUuid(['drawing', 'version']);
        Route::post('/{drawing}/versions/{version}/submit', [DrawingController::class, 'submit'])->whereUuid(['drawing', 'version']);
        Route::post('/{drawing}/versions/{version}/escalate', [DrawingController::class, 'escalate'])->whereUuid(['drawing', 'version']);
        Route::post('/{drawing}/versions/{version}/decisions', [DrawingController::class, 'decide'])->whereUuid(['drawing', 'version']);
        Route::post('/{drawing}/versions/{version}/documents', [DocumentController::class, 'uploadToDrawing'])->whereUuid(['drawing', 'version']);
        Route::get('/{drawing}/versions/{version}/mto', [MtoController::class, 'forVersion'])->whereUuid(['drawing', 'version']);
        Route::post('/{drawing}/versions/{version}/mto', [MtoController::class, 'store'])->whereUuid(['drawing', 'version']);
    });

    // MTO (stage 4A): quantities per construction -> material need by the BOM engine -> verification -> Manager ULP approval.
    Route::prefix('mto')->middleware('throttle:admin')->group(function () {
        Route::get('/access', [MtoController::class, 'access']);
        Route::get('/{package}', [MtoController::class, 'show'])->whereUuid('package');
        Route::put('/{package}/items', [MtoController::class, 'putItems'])->whereUuid('package');
        Route::post('/{package}/extract', [MtoController::class, 'extract'])->whereUuid('package');
        Route::post('/{package}/calculate', [MtoController::class, 'calculate'])->whereUuid('package');
        Route::post('/{package}/verify', [MtoController::class, 'verify'])->whereUuid('package');
        Route::post('/{package}/decision', [MtoController::class, 'decide'])->whereUuid('package');
        // RAB of an APPROVED package (stage 5B)
        Route::get('/{package}/rab-runs', [RabController::class, 'index'])->whereUuid('package');
        Route::post('/{package}/rab-runs', [RabController::class, 'run'])->whereUuid('package');
    });
    Route::get('/rab-runs/{run}', [RabController::class, 'show'])->whereUuid('run')->middleware('throttle:admin');
    // KKF runs of an application (stage 5C)
    Route::get('/applications/{application}/kkf-runs', [KkfController::class, 'index'])->whereUuid('application')->middleware('throttle:admin');
    Route::get('/applications/{application}/kkf-preview', [KkfController::class, 'preview'])->whereUuid('application')->middleware('throttle:admin');
    Route::post('/applications/{application}/kkf-runs', [KkfController::class, 'run'])->whereUuid('application')->middleware('throttle:admin');
    Route::get('/kkf-runs/{run}', [KkfController::class, 'show'])->whereUuid('run')->middleware('throttle:admin');
    // KKO of an application (owner 2026-11-09): transformer loading + voltage at the location, decided by TEKNIK; never blocks the flow
    Route::get('/applications/{application}/kko', [KkoController::class, 'show'])->whereUuid('application')->middleware('throttle:admin');
    Route::get('/applications/{application}/kko/baseline', [KkoController::class, 'baseline'])->whereUuid('application')->middleware('throttle:admin');
    Route::put('/applications/{application}/kko', [KkoController::class, 'record'])->whereUuid('application')->middleware('throttle:admin');
    Route::post('/applications/{application}/kko/decision', [KkoController::class, 'decide'])->whereUuid('application')->middleware('throttle:admin');
    Route::get('/planning/access', [PlanningAccessController::class, 'access']);
    // Reservation of connections without network extension, and the contracted 1-phase executor per ULP (docs/95)
    Route::middleware('throttle:admin')->group(function () {
        Route::get('/sr-vendor-contracts', [SrVendorContractController::class, 'index']);
        Route::post('/sr-vendor-contracts', [SrVendorContractController::class, 'store']);
        Route::put('/sr-vendor-contracts/{contract}', [SrVendorContractController::class, 'update'])->whereUuid('contract');
        Route::get('/applications/{application}/sr-reservations', [SrReservationController::class, 'forApplication'])->whereUuid('application');
        Route::post('/applications/{application}/sr-reservations', [SrReservationController::class, 'store'])->whereUuid('application');
        Route::get('/sr-reservations', [SrReservationController::class, 'index']);
        Route::get('/sr-reservations/pending', [SrReservationController::class, 'pending']);
        Route::post('/sr-reservations/batch', [SrReservationController::class, 'storeBatch']);
        Route::post('/sr-reservations/batch-actions', [SrReservationController::class, 'batchAction']);
        Route::post('/applications/{application}/sr-extension', [SrReservationController::class, 'reportExtension'])->whereUuid('application');
        Route::post('/applications/{application}/sr-extension/cancel', [SrReservationController::class, 'withdrawExtension'])->whereUuid('application');
        Route::get('/sr-reservations/{reservation}', [SrReservationController::class, 'show'])->whereUuid('reservation');
        Route::put('/sr-reservations/{reservation}', [SrReservationController::class, 'update'])->whereUuid('reservation');
        Route::post('/sr-reservations/{reservation}/submit', [SrReservationController::class, 'submit'])->whereUuid('reservation');
        Route::post('/sr-reservations/{reservation}/decision', [SrReservationController::class, 'decide'])->whereUuid('reservation');
        Route::post('/sr-reservations/{reservation}/mims', [SrReservationController::class, 'recordMims'])->whereUuid('reservation');
        Route::post('/sr-reservations/{reservation}/cancel', [SrReservationController::class, 'cancel'])->whereUuid('reservation');
    });
    // EIS sync started and scheduled from DISTRIVA (account, Range Daya, automatic run, history)
    Route::get('/sync/active', [SyncStatusController::class, 'active']);
    Route::get('/sync/accounts', [SyncAccountController::class, 'index']);
    Route::put('/sync/accounts', [SyncAccountController::class, 'save']);
    Route::delete('/sync/accounts/{source}/{unit}', [SyncAccountController::class, 'destroy'])->whereIn('source', ['eis', 'maximo'])->whereUuid('unit');
    Route::get('/eis-sync', [EisSyncController::class, 'show']);
    Route::put('/eis-sync/settings', [EisSyncController::class, 'save']);
    Route::post('/eis-sync/runs', [EisSyncController::class, 'start']);
    Route::get('/eis-sync/apkt-token', [EisSyncController::class, 'apktTokenStatus']);
    Route::delete('/eis-sync/apkt-token', [EisSyncController::class, 'apktTokenForget']);
    Route::get('/maximo-sync', [MaximoSyncController::class, 'show']);
    Route::put('/maximo-sync/settings', [MaximoSyncController::class, 'save']);
    Route::get('/maximo-sync/runs', [MaximoSyncController::class, 'runs']);
    Route::post('/maximo-sync/runs', [MaximoSyncController::class, 'start']);
    Route::get('/maximo-sync/runs/{run}', [MaximoSyncController::class, 'showRun'])->whereUuid('run');
    Route::get('/eis-sync/runs/{run}', [EisSyncController::class, 'showRun'])->whereUuid('run');
    // Forecast of the substation load (docs/11)
    Route::middleware('throttle:admin')->group(function () {
        Route::get('/forecast/runs', [ForecastController::class, 'runs']);
        Route::get('/forecast/schedule', [ForecastController::class, 'schedule']);
        Route::put('/forecast/schedule', [ForecastController::class, 'saveSchedule']);
        Route::get('/forecast/derived', [ForecastController::class, 'derived']);
        Route::post('/forecast/runs', [ForecastController::class, 'start']);
        Route::get('/forecast/runs/{run}', [ForecastController::class, 'show'])->whereUuid('run');
        Route::get('/forecast/runs/{run}/substations', [ForecastController::class, 'substations'])->whereUuid('run');
        Route::get('/forecast/runs/{run}/series', [ForecastController::class, 'series'])->whereUuid('run');
        Route::post('/forecast/runs/{run}/review', [ForecastController::class, 'review'])->whereUuid('run');
    });
    // Application tasks and internal SLA (docs/24 §8)
    Route::middleware('throttle:admin')->group(function () {
        Route::get('/tasks', [TaskController::class, 'index']);
        Route::get('/tasks/summary', [TaskController::class, 'summary']);
        Route::get('/tasks/{task}', [TaskController::class, 'show'])->whereUuid('task');
        foreach (['accept', 'start', 'submit', 'complete', 'cancel', 'reassign'] as $step) {
            Route::post("/tasks/{task}/{$step}", [TaskController::class, $step])->whereUuid('task');
        }
        Route::post('/tasks/{task}/return', [TaskController::class, 'returnBack'])->whereUuid('task');
        Route::get('/applications/{application}/tasks', [TaskController::class, 'forApplication'])->whereUuid('application');
        Route::get('/applications/{application}/tasks/assignees', [TaskController::class, 'assignees'])->whereUuid('application');
        Route::post('/applications/{application}/tasks', [TaskController::class, 'store'])->whereUuid('application');
        Route::get('/service-sla', [ServiceSlaController::class, 'index']);
        Route::get('/service-sla/summary', [ServiceSlaController::class, 'summary']);
        Route::get('/applications/{application}/service-sla', [ServiceSlaController::class, 'show'])->whereUuid('application');
        Route::post('/applications/{application}/service-sla/notes', [ServiceSlaController::class, 'addNote'])->whereUuid('application');
        Route::get('/sla/configurations', [TaskController::class, 'slaIndex']);
        Route::put('/sla/configurations/{type}', [TaskController::class, 'slaUpdate']);
        Route::get('/sla/holidays', [TaskController::class, 'holidays']);
        Route::post('/sla/holidays', [TaskController::class, 'addHoliday']);
        Route::delete('/sla/holidays/{date}', [TaskController::class, 'removeHoliday']);
    });
    // Dashboard and reports (docs/62 §41)
    Route::middleware('throttle:admin')->group(function () {
        Route::get('/reports/units', [ReportController::class, 'units']);
        Route::get('/scoped-units', ScopedUnitController::class);
        Route::get('/reports/settings', [ReportController::class, 'settings']);
        Route::put('/reports/settings', [ReportController::class, 'saveSettings']);
        Route::get('/reports/overview', [ReportController::class, 'overview']);
        Route::get('/reports/pipeline', [ReportController::class, 'pipeline']);
        Route::get('/reports/sla', [ReportController::class, 'sla']);
        Route::get('/reports/cost-variance', [ReportController::class, 'costVariance']);
        Route::get('/reports/vendor-performance', [ReportController::class, 'vendorPerformance']);
        Route::get('/reports/customer-growth', [ReportController::class, 'customerGrowth']);
        Route::get('/outages/analysis', [OutageAnalysisController::class, 'index']);
        Route::get('/outages/analysis/feeders/{feeder}', [OutageAnalysisController::class, 'feeder'])->whereUuid('feeder');
        Route::get('/outages/forecast', [OutageAnalysisController::class, 'forecast']);
        Route::get('/reports/critical-stock', [ReportController::class, 'criticalStock']);
        Route::get('/reports/kkf-feasibility', [ReportController::class, 'kkfFeasibility']);
        Route::get('/reports/erp-anomalies', [ReportController::class, 'erpAnomalies']);
        Route::get('/dashboard/summary', [ReportController::class, 'dashboardSummary']);
        Route::get('/rkm/versions/{version}/reports/{type}', [ReportController::class, 'rkm'])->whereUuid('version');
    });
    // Material need outbox (docs/62 §40)
    Route::middleware('throttle:admin')->group(function () {
        Route::get('/material-requests', [MaterialRequestController::class, 'index']);
        Route::get('/material-requests/{request_}', [MaterialRequestController::class, 'show'])->whereUuid('request_');
        Route::get('/material-requests/{request_}/export', [MaterialRequestController::class, 'export'])->whereUuid('request_');
        Route::post('/material-requests/{request_}/mark-sent', [MaterialRequestController::class, 'markSent'])->whereUuid('request_');
        Route::post('/material-requests/{request_}/cancel', [MaterialRequestController::class, 'cancel'])->whereUuid('request_');
    });
    // Usulan with several customers (docs/62 §37)
    Route::middleware('throttle:admin')->group(function () {
        Route::get('/proposals/selectable', [ProposalController::class, 'selectable']);
        Route::get('/proposals', [ProposalController::class, 'index']);
        Route::post('/proposals/issue', [ProposalController::class, 'issue']);
        Route::post('/proposals', [ProposalController::class, 'create']);
        Route::get('/proposals/{proposal}', [ProposalController::class, 'show'])->whereUuid('proposal');
        Route::post('/proposals/{proposal}/members', [ProposalController::class, 'addMembers'])->whereUuid('proposal');
        Route::post('/proposals/{proposal}/members/{application}/remove', [ProposalController::class, 'removeMember'])->whereUuid(['proposal', 'application']);
        Route::post('/proposals/{proposal}/cancel', [ProposalController::class, 'cancel'])->whereUuid('proposal');
        Route::get('/proposals/{proposal}/kkf-runs', [KkfController::class, 'indexForProposal'])->whereUuid('proposal');
        Route::post('/proposals/{proposal}/kkf-runs', [KkfController::class, 'runForProposal'])->whereUuid('proposal');
    });
    // Allocations of materials and poles (stage 6A)
    Route::get('/applications/{application}/allocations', [AllocationController::class, 'index'])->whereUuid('application')->middleware('throttle:admin');
    Route::post('/applications/{application}/allocations', [AllocationController::class, 'create'])->whereUuid('application')->middleware('throttle:admin');
    Route::get('/allocations/{allocation}', [AllocationController::class, 'show'])->whereUuid('allocation')->middleware('throttle:admin');
    Route::get('/allocations/{allocation}/material-suggestions', [AllocationController::class, 'materialSuggestions'])->whereUuid('allocation')->middleware('throttle:admin');
    Route::put('/allocations/{allocation}/materials', [AllocationController::class, 'putMaterials'])->whereUuid('allocation')->middleware('throttle:admin');
    Route::put('/allocations/{allocation}/poles', [AllocationController::class, 'putPoles'])->whereUuid('allocation')->middleware('throttle:admin');
    Route::post('/allocations/{allocation}/confirm', [AllocationController::class, 'confirm'])->whereUuid('allocation')->middleware('throttle:admin');
    Route::post('/allocations/{allocation}/cancel', [AllocationController::class, 'cancel'])->whereUuid('allocation')->middleware('throttle:admin');
    // Work orders (stage 7)
    Route::middleware('throttle:admin')->group(function () {
        Route::get('/work-orders', [WorkOrderController::class, 'index']);
        Route::get('/work-orders/by-agenda', [WorkOrderController::class, 'byAgenda']);
        Route::get('/applications/{application}/work-orders', [WorkOrderController::class, 'forApplication'])->whereUuid('application');
        Route::post('/applications/{application}/work-orders', [WorkOrderController::class, 'create'])->whereUuid('application');
        Route::get('/work-orders/{wo}', [WorkOrderController::class, 'show'])->whereUuid('wo');
        Route::put('/work-orders/{wo}/vendor', [WorkOrderController::class, 'setVendor'])->whereUuid('wo');
        Route::put('/work-orders/{wo}/target-date', [WorkOrderController::class, 'setTargetDate'])->whereUuid('wo');
        Route::post('/work-orders/{wo}/submit', [WorkOrderController::class, 'submit'])->whereUuid('wo');
        Route::post('/work-orders/{wo}/decision', [WorkOrderController::class, 'decide'])->whereUuid('wo');
        Route::post('/work-orders/{wo}/progress', [WorkOrderController::class, 'submitProgress'])->whereUuid('wo');
        Route::post('/work-orders/{wo}/complete', [WorkOrderController::class, 'complete'])->whereUuid('wo');
        Route::post('/work-orders/{wo}/cancel', [WorkOrderController::class, 'cancel'])->whereUuid('wo');
        Route::post('/work-orders/{wo}/amend', [WorkOrderController::class, 'amend'])->whereUuid('wo');
        Route::post('/work-progress/{progress}/decision', [WorkOrderController::class, 'decideProgress'])->whereUuid('progress');
        // BASTP (stage 8)
        Route::get('/pole-work-orders', [PoleWorkOrderController::class, 'index']);
        Route::get('/pole-work-orders/candidates', [PoleWorkOrderController::class, 'candidates']);
        Route::post('/pole-work-orders', [PoleWorkOrderController::class, 'create']);
        Route::get('/pole-work-orders/{wo}', [PoleWorkOrderController::class, 'show'])->whereUuid('wo');
        Route::put('/pole-work-orders/{wo}', [PoleWorkOrderController::class, 'update'])->whereUuid('wo');
        Route::post('/pole-work-orders/{wo}/issue', [PoleWorkOrderController::class, 'issue'])->whereUuid('wo');
        Route::post('/pole-work-orders/{wo}/amend', [PoleWorkOrderController::class, 'amend'])->whereUuid('wo');
        Route::post('/pole-work-orders/{wo}/cancel', [PoleWorkOrderController::class, 'cancel'])->whereUuid('wo');
        Route::post('/pole-work-orders/{wo}/letter', [PoleWorkOrderController::class, 'uploadLetter'])->whereUuid('wo');
        Route::get('/pole-work-orders/{wo}/letter', [PoleWorkOrderController::class, 'letter'])->whereUuid('wo');
        Route::post('/pole-work-orders/{wo}/progress', [PoleWorkOrderController::class, 'submitProgress'])->whereUuid('wo');
        Route::post('/pole-wo-progress/{progress}/decision', [PoleWorkOrderController::class, 'decideProgress'])->whereUuid('progress');
        Route::post('/pole-work-orders/{wo}/bastp', [PoleWorkOrderController::class, 'prepareBastp'])->whereUuid('wo');
        Route::post('/pole-wo-bastp/{bastp}/decision', [PoleWorkOrderController::class, 'decideBastp'])->whereUuid('bastp');
        Route::get('/work-orders/{wo}/bastp', [BastpController::class, 'forWorkOrder'])->whereUuid('wo');
        Route::post('/work-orders/{wo}/bastp', [BastpController::class, 'create'])->whereUuid('wo');
        Route::get('/bastp/{bastp}', [BastpController::class, 'show'])->whereUuid('bastp');
        Route::get('/bastp/{bastp}/document', [BastpController::class, 'document'])->whereUuid('bastp');
        Route::put('/bastp/{bastp}/materials', [BastpController::class, 'putMaterials'])->whereUuid('bastp');
        Route::put('/bastp/{bastp}/meters', [BastpController::class, 'putMeters'])->whereUuid('bastp');
        Route::post('/bastp/{bastp}/meters/{meter}/photos', [BastpController::class, 'uploadPhoto'])->whereUuid(['bastp', 'meter']);
        Route::post('/bastp/{bastp}/submit', [BastpController::class, 'submit'])->whereUuid('bastp');
        Route::post('/bastp/{bastp}/accept', [BastpController::class, 'accept'])->whereUuid('bastp');
        Route::post('/bastp/{bastp}/sign', [BastpController::class, 'signKonstruksi'])->whereUuid('bastp');
        Route::post('/bastp/{bastp}/close', [BastpController::class, 'close'])->whereUuid('bastp');
        Route::post('/bastp/{bastp}/return', [BastpController::class, 'returnBack'])->whereUuid('bastp');
    });
    // RKM (stage 6B)
    Route::prefix('rkm')->middleware('throttle:admin')->group(function () {
        Route::get('/plans', [RkmController::class, 'plans']);
        Route::post('/plans', [RkmController::class, 'createPlan']);
        Route::post('/plans/{plan}/amend', [RkmController::class, 'amend'])->whereUuid('plan');
        Route::get('/versions/{version}', [RkmController::class, 'show'])->whereUuid('version');
        Route::get('/versions/{version}/requirements', [RkmController::class, 'requirements'])->whereUuid('version');
        Route::post('/versions/{version}/start-validation', [RkmController::class, 'startValidation'])->whereUuid('version');
        Route::post('/versions/{version}/adjust', [RkmController::class, 'adjust'])->whereUuid('version');
        Route::post('/versions/{version}/decision', [RkmController::class, 'decide'])->whereUuid('version');
        Route::put('/proposals/{proposal}/lines', [RkmController::class, 'putLines'])->whereUuid('proposal');
        Route::put('/proposals/{proposal}/packages', [RkmController::class, 'setPackages'])->whereUuid('proposal');
        Route::post('/proposals/{proposal}/submit', [RkmController::class, 'submit'])->whereUuid('proposal');
    });
    // Output documents (stage 5D)
    Route::get('/rab-runs/{run}/documents/{type}', [OutputDocumentController::class, 'rab'])->whereUuid('run')->middleware('throttle:admin');
    Route::get('/kkf-runs/{run}/documents/{type}', [OutputDocumentController::class, 'kkf'])->whereUuid('run')->middleware('throttle:admin');
    // Backup / restore (docs/64): SYS_ADMIN only (MFA). Restore needs a verified backup, typed confirmation and the actor's password.
    Route::prefix('nko')->middleware('throttle:admin')->group(function () {
        Route::get('/definitions', [NkoController::class, 'definitions']);
        Route::get('/snapshots', [NkoController::class, 'index']);
        Route::get('/snapshots/{snapshot}', [NkoController::class, 'show'])->whereUuid('snapshot');
        Route::get('/ranking', [NkoController::class, 'ranking']);
        Route::get('/inputs', [NkoController::class, 'inputs']);
        Route::get('/gaps', [NkoController::class, 'gaps']);
        Route::put('/inputs', [NkoController::class, 'saveInputs']);
        Route::post('/calculate', [NkoController::class, 'calculate']);
        Route::get('/rules', [NkoRuleController::class, 'index']);
        Route::get('/rules/catalog', [NkoRuleController::class, 'catalog']);
        Route::get('/rules/mapping', [NkoRuleController::class, 'mapping']);
        Route::post('/rules/preview', [NkoRuleController::class, 'preview']);
        Route::get('/rule-proposals', [NkoRuleController::class, 'proposals']);
        Route::post('/rule-proposals', [NkoRuleController::class, 'propose']);
        Route::post('/rule-proposals/{proposal}/decision', [NkoRuleController::class, 'decide'])->whereUuid('proposal');
        Route::delete('/rule-proposals/{proposal}', [NkoRuleController::class, 'cancel'])->whereUuid('proposal');
        Route::get('/definition-sets', [NkoDefinitionUploadController::class, 'sets']);
        Route::get('/definition-uploads', [NkoDefinitionUploadController::class, 'index']);
        Route::get('/definition-template', [NkoDefinitionUploadController::class, 'template']);
        Route::post('/definition-uploads/check', [NkoDefinitionUploadController::class, 'check']);
        Route::post('/definition-uploads', [NkoDefinitionUploadController::class, 'store']);
        Route::get('/definition-uploads/{upload}', [NkoDefinitionUploadController::class, 'show'])->whereUuid('upload');
        Route::post('/definition-uploads/{upload}/decision', [NkoDefinitionUploadController::class, 'decide'])->whereUuid('upload');
        Route::delete('/definition-uploads/{upload}', [NkoDefinitionUploadController::class, 'cancel'])->whereUuid('upload');
        Route::get('/target-template', [NkoTargetUploadController::class, 'template']);
        Route::get('/target-uploads', [NkoTargetUploadController::class, 'index']);
        Route::post('/target-uploads/check', [NkoTargetUploadController::class, 'check']);
        Route::post('/target-uploads', [NkoTargetUploadController::class, 'store']);
        Route::get('/target-uploads/{upload}', [NkoTargetUploadController::class, 'show'])->whereUuid('upload');
        Route::post('/target-uploads/{upload}/decision', [NkoTargetUploadController::class, 'decide'])->whereUuid('upload');
        Route::delete('/target-uploads/{upload}', [NkoTargetUploadController::class, 'cancel'])->whereUuid('upload');
    });

    Route::prefix('pengusahaan')->middleware('throttle:admin')->group(function () {
        Route::get('/metrics', [BusinessAnalyticsController::class, 'index']);
        Route::get('/metrics/{code}', [BusinessAnalyticsController::class, 'show'])->where('code', '[a-z0-9-]+');
        Route::get('/metrics/{code}/forecast', [BusinessAnalyticsController::class, 'forecast'])->where('code', '[a-z0-9-]+');
        Route::get('/metrics/{code}/history', [BusinessAnalyticsController::class, 'history'])->where('code', '[a-z0-9-]+');
        Route::get('/metrics/{code}/export', [BusinessAnalyticsController::class, 'export'])->where('code', '[a-z0-9-]+');
        Route::get('/inputs', [BusinessAnalyticsController::class, 'inputs']);
        Route::put('/inputs', [BusinessAnalyticsController::class, 'saveInputs']);
        Route::get('/inputs/template', [BusinessAnalyticsController::class, 'template']);
        Route::post('/inputs/import', [BusinessAnalyticsController::class, 'import']);
    });
    Route::prefix('eis-reports')->middleware('throttle:admin')->group(function () {
        Route::get('/', [EisReportController::class, 'index']);
        Route::get('/coverage', [EisReportController::class, 'coverage']);
        Route::post('/import', [EisReportController::class, 'store']);
        Route::get('/{file}/lines', [EisReportController::class, 'lines'])->whereUuid('file');
    });
    Route::prefix('outages/sync')->middleware('throttle:admin')->group(function () {
        Route::get('/', [OutageSyncController::class, 'show']);
        Route::put('/settings', [OutageSyncController::class, 'save']);
        Route::post('/runs', [OutageSyncController::class, 'start']);
        Route::get('/runs/{run}', [OutageSyncController::class, 'showRun'])->whereUuid('run');
        Route::post('/aliases', [OutageSyncController::class, 'alias']);
    });
    Route::prefix('settings/whatsapp')->middleware('throttle:admin')->group(function () {
        Route::get('/', [WhatsAppSettingsController::class, 'show']);
        Route::put('/', [WhatsAppSettingsController::class, 'save']);
        Route::post('/test', [WhatsAppSettingsController::class, 'test']);
    });
    Route::prefix('backups')->middleware('throttle:admin')->group(function () {
        Route::get('/access', [BackupController::class, 'access']);
        Route::get('/status', [BackupController::class, 'status']);
        Route::get('/settings', [BackupController::class, 'settings']);
        Route::put('/settings', [BackupController::class, 'updateSettings']);
        Route::get('/restores', [BackupController::class, 'restores']);
        Route::get('/restores/{restore}', [BackupController::class, 'showRestore'])->whereUuid('restore');
        Route::get('/', [BackupController::class, 'index']);
        Route::post('/', [BackupController::class, 'store']);
        Route::get('/{backup}', [BackupController::class, 'show'])->whereUuid('backup');
        Route::post('/{backup}/verify', [BackupController::class, 'verify'])->whereUuid('backup');
        Route::post('/{backup}/restore', [BackupController::class, 'restore'])->whereUuid('backup');
        Route::get('/{backup}/download', [BackupController::class, 'download'])->whereUuid('backup');
        Route::post('/{backup}/remove', [BackupController::class, 'remove'])->whereUuid('backup');
    });
    Route::prefix('documents')->middleware('throttle:admin')->group(function () {
        Route::get('/{document}', [DocumentController::class, 'show'])->whereUuid('document');
        Route::get('/{document}/preview', [DocumentController::class, 'preview'])->whereUuid('document');
        Route::get('/{document}/preview-pdf', [DocumentController::class, 'previewPdf'])->whereUuid('document');
        Route::get('/{document}/download', [DocumentController::class, 'download'])->whereUuid('document');
        Route::post('/{document}/remove', [DocumentController::class, 'remove'])->whereUuid('document');
    });

    // Master data (T4.2.2). Central reference data: keys are evaluated without a unit target (CatalogAuthorizer).
    Route::prefix('master-data')->middleware('throttle:admin')->group(function () {
        Route::get('/access', [CatalogController::class, 'access']);
        Route::get('/categories', [CatalogController::class, 'categories']);
        Route::post('/categories', [CatalogController::class, 'createCategory']);
        Route::patch('/categories/{category}', [CatalogController::class, 'updateCategory'])->whereUuid('category');
        Route::get('/units', [CatalogController::class, 'units']);
        Route::post('/units', [CatalogController::class, 'createUnit']);
        Route::patch('/units/{unit}', [CatalogController::class, 'updateUnit'])->whereUuid('unit');

        Route::get('/khs', [KhsController::class, 'index']);
        Route::post('/khs/import', [KhsController::class, 'import']);
        Route::post('/khs/versions/approve', [KhsController::class, 'approve']);
        Route::patch('/khs/versions/{version}', [KhsController::class, 'updateDraft'])->whereUuid('version');
        Route::post('/khs/versions/{version}/retire', [KhsController::class, 'retire'])->whereUuid('version');
        Route::get('/khs/{item}', [KhsController::class, 'show'])->whereUuid('item');

        Route::get('/kkf-parameters', [KkfParameterController::class, 'index']);
        Route::post('/kkf-parameters', [KkfParameterController::class, 'store']);
        Route::get('/kkf-parameters/active', [KkfParameterController::class, 'active']);
        Route::post('/kkf-parameters/approve', [KkfParameterController::class, 'approve']);
        Route::get('/kkf-parameters/{set}', [KkfParameterController::class, 'show'])->whereUuid('set');
        Route::put('/kkf-parameters/{set}', [KkfParameterController::class, 'update'])->whereUuid('set');
        Route::post('/kkf-parameters/{set}/retire', [KkfParameterController::class, 'retire'])->whereUuid('set');
        Route::post('/kkf-parameters/{set}/discard', [KkfParameterController::class, 'discard'])->whereUuid('set');

        Route::get('/vendors', [VendorController::class, 'index']);
        Route::post('/vendors', [VendorController::class, 'create']);
        Route::put('/vendors/{company}', [VendorController::class, 'update'])->whereUuid('company');
        Route::post('/vendors/{company}/status', [VendorController::class, 'setStatus'])->whereUuid('company');
        Route::post('/vendors/{company}/accounts', [VendorController::class, 'linkAccount'])->whereUuid('company');
        Route::post('/vendor-accounts/{account}/deactivate', [VendorController::class, 'deactivateAccount'])->whereUuid('account');

        Route::get('/warehouses', [InventoryController::class, 'warehouses']);
        Route::post('/warehouses', [InventoryController::class, 'createWarehouse']);
        Route::post('/warehouses/import', [InventoryController::class, 'importWarehouses']);
        Route::get('/warehouses/{warehouse}/stock-snapshots', [InventoryController::class, 'snapshots'])->whereUuid('warehouse');
        Route::post('/warehouses/{warehouse}/stock-snapshots', [InventoryController::class, 'importSnapshot'])->whereUuid('warehouse');
        Route::get('/stock-snapshots/{snapshot}', [InventoryController::class, 'snapshot'])->whereUuid('snapshot');
        Route::get('/stock-position', [InventoryController::class, 'position']);
        Route::get('/stock-material-detail', [InventoryController::class, 'materialStockDetail']);
        Route::get('/stock-sync-runs', [InventoryController::class, 'syncRuns']);
        Route::get('/stock-coverage', [InventoryController::class, 'stockCoverage']);
        Route::get('/mims-issues', [InventoryController::class, 'mimsIssues']);
        Route::get('/mims-receipts', [InventoryController::class, 'mimsReceipts']);
        Route::get('/mims-reservations', [InventoryController::class, 'mimsReservations']);
        Route::post('/stock-sync', [InventoryController::class, 'mimsPull']);
        Route::post('/stock-sync/runs', [InventoryController::class, 'mimsRunStart']);
        Route::get('/stock-sync/runs/active', [InventoryController::class, 'mimsRunActive']);
        Route::get('/stock-sync/runs/{run}', [InventoryController::class, 'mimsRunShow'])->whereUuid('run');
        Route::get('/stock-sync/settings', [InventoryController::class, 'mimsAutoShow']);
        Route::put('/stock-sync/settings', [InventoryController::class, 'mimsAutoSave']);
        Route::get('/stock-sync/token', [InventoryController::class, 'mimsTokenStatus']);
        Route::delete('/stock-sync/token', [InventoryController::class, 'mimsTokenForget']);
        Route::get('/stock-snapshots/{snapshot}/unmapped', [InventoryController::class, 'unmapped'])->whereUuid('snapshot');
        Route::get('/customer-connections', [ConnectionController::class, 'index']);
        Route::get('/customer-connections/sync', [ConnectionController::class, 'syncInfo']);
        Route::post('/customer-connections/sync/runs', [ConnectionController::class, 'syncStart']);
        Route::get('/customer-connections/sync/runs/{run}', [ConnectionController::class, 'syncShow'])->whereUuid('run');
        Route::post('/customer-connections/batches', [ConnectionController::class, 'start']);
        Route::get('/customer-connections/batches/{batch}', [ConnectionController::class, 'batch'])->whereUuid('batch');
        Route::post('/customer-connections/batches/{batch}/items', [ConnectionController::class, 'items'])->whereUuid('batch');
        Route::post('/customer-connections/batches/{batch}/complete', [ConnectionController::class, 'complete'])->whereUuid('batch');
        Route::get('/customer-connections/{id}', [ConnectionController::class, 'show'])->whereUuid('id');
        Route::patch('/customer-connections/{id}/link', [ConnectionController::class, 'link'])->whereUuid('id');
        Route::get('/feeders', [FeederController::class, 'index']);
        Route::post('/feeders', [FeederController::class, 'store']);
        Route::get('/feeders/{id}', [FeederController::class, 'show'])->whereUuid('id');
        Route::patch('/feeders/{id}', [FeederController::class, 'update'])->whereUuid('id');
        Route::get('/substations', [SubstationController::class, 'index']);
        Route::post('/substations/readings/bulk', [SubstationController::class, 'bulk']);
        Route::post('/substations/imports', [SubstationController::class, 'stage']);
        Route::get('/substations/imports/{batch}', [SubstationController::class, 'batch'])->whereUuid('batch');
        Route::post('/substations/imports/{batch}/confirm', [SubstationController::class, 'confirm'])->whereUuid('batch');
        Route::delete('/substations/imports/{batch}', [SubstationController::class, 'discard'])->whereUuid('batch');
        Route::get('/substations/{id}', [SubstationController::class, 'show'])->whereUuid('id');
        Route::get('/substations/{id}/analysis', [SubstationController::class, 'analysis'])->whereUuid('id');
        Route::patch('/substations/{id}', [SubstationController::class, 'update'])->whereUuid('id');
        Route::post('/substations/{id}/readings', [SubstationController::class, 'reading'])->whereUuid('id');
        Route::get('/khs-material-map', [InventoryController::class, 'khsMap']);
        Route::post('/khs-material-map/import', [InventoryController::class, 'importKhsMap']);
        Route::get('/khs-material-map/workbench', [InventoryController::class, 'khsMapWorkbench']);
        Route::get('/khs-material-map/suggestions', [InventoryController::class, 'khsMapSuggestions']);
        Route::get('/khs-material-map/coverage', [InventoryController::class, 'khsMapCoverage']);
        Route::post('/khs-material-map', [InventoryController::class, 'createKhsMap']);
        Route::post('/khs-material-map/exemptions', [InventoryController::class, 'exemptKhs']);
        Route::post('/khs-material-map/exemptions/{khsCode}/lift', [InventoryController::class, 'liftKhsExemption']);
        Route::delete('/khs-material-map/{map}', [InventoryController::class, 'deleteKhsMap'])->whereUuid('map');
        Route::get('/pole-contracts', [InventoryController::class, 'poleContracts']);
        Route::post('/pole-contracts', [InventoryController::class, 'createPoleContract']);
        Route::get('/pole-contracts/{contract}', [InventoryController::class, 'poleContract'])->whereUuid('contract');
        Route::put('/pole-contracts/{contract}', [InventoryController::class, 'updatePoleContract'])->whereUuid('contract');
        Route::post('/pole-contracts/{contract}/close', [InventoryController::class, 'closePoleContract'])->whereUuid('contract');

        Route::get('/tariff-books', [TariffBookController::class, 'index']);
        Route::post('/tariff-books/import', [TariffBookController::class, 'import']);
        Route::get('/excel-imports/template', [MasterExcelImportController::class, 'template']);
        Route::get('/excel-imports', [MasterExcelImportController::class, 'index']);
        Route::post('/excel-imports', [MasterExcelImportController::class, 'store']);
        Route::get('/excel-imports/{id}', [MasterExcelImportController::class, 'show'])->whereUuid('id');
        Route::post('/excel-imports/{id}/recheck', [MasterExcelImportController::class, 'recheck'])->whereUuid('id');
        Route::post('/excel-imports/{id}/apply', [MasterExcelImportController::class, 'apply'])->whereUuid('id');
        Route::delete('/excel-imports/{id}', [MasterExcelImportController::class, 'destroy'])->whereUuid('id');
        Route::post('/tariff-books/approve', [TariffBookController::class, 'approve']);
        Route::get('/tariff-books/{book}', [TariffBookController::class, 'show'])->whereUuid('book');
        Route::get('/tariff-books/{book}/rows', [TariffBookController::class, 'rows'])->whereUuid('book');
        Route::post('/tariff-books/{book}/retire', [TariffBookController::class, 'retire'])->whereUuid('book');
        Route::post('/tariff-books/{book}/discard', [TariffBookController::class, 'discard'])->whereUuid('book');

        Route::get('/price-books', [PriceBookController::class, 'index']);
        Route::post('/price-books/import', [PriceBookController::class, 'import']);
        Route::post('/price-books/from-active', [PriceBookController::class, 'createDraftFromActive']);
        Route::post('/price-books/approve', [PriceBookController::class, 'approve']);
        Route::get('/price-books/{book}', [PriceBookController::class, 'show'])->whereUuid('book');
        Route::get('/price-books/{book}/items', [PriceBookController::class, 'items'])->whereUuid('book');
        Route::put('/price-books/{book}/zones', [PriceBookController::class, 'setZone'])->whereUuid('book');
        Route::patch('/price-books/{book}/items/{code}/insured', [PriceBookController::class, 'setInsured'])->whereUuid('book')->where('code', '[A-Za-z0-9._-]{1,30}');
        Route::post('/price-books/{book}/retire', [PriceBookController::class, 'retire'])->whereUuid('book');
        Route::post('/price-books/{book}/discard', [PriceBookController::class, 'discard'])->whereUuid('book');

        Route::get('/bom', [BomController::class, 'index']);
        Route::post('/bom/import', [BomController::class, 'import']);
        Route::post('/bom/versions/approve', [BomController::class, 'approve']);
        Route::get('/bom/{header}', [BomController::class, 'show'])->whereUuid('header');
        Route::patch('/bom/{header}', [BomController::class, 'updateDraft'])->whereUuid('header');
        Route::get('/bom/{header}/lines', [BomController::class, 'lines'])->whereUuid('header');
        Route::post('/bom/{header}/retire', [BomController::class, 'retire'])->whereUuid('header');
        Route::post('/bom/{header}/discard', [BomController::class, 'discard'])->whereUuid('header');
        Route::post('/bom/{header}/calculate', [BomController::class, 'calculate'])->whereUuid('header');

        Route::get('/construction-types', [ConstructionTypeController::class, 'index']);
        Route::post('/construction-types/import', [ConstructionTypeController::class, 'import']);
        Route::post('/construction-types/mappings/import', [ConstructionTypeController::class, 'importMappings']);
        Route::post('/construction-types/versions/approve', [ConstructionTypeController::class, 'approve']);
        Route::patch('/construction-types/versions/{version}', [ConstructionTypeController::class, 'updateDraft'])->whereUuid('version');
        Route::post('/construction-types/versions/{version}/retire', [ConstructionTypeController::class, 'retire'])->whereUuid('version');
        Route::get('/construction-types/versions/{version}/mappings', [ConstructionTypeController::class, 'mappings'])->whereUuid('version');
        Route::delete('/construction-types/versions/{version}/mappings/{khsCode}', [ConstructionTypeController::class, 'removeMapping'])->whereUuid('version');
        Route::get('/construction-types/{type}', [ConstructionTypeController::class, 'show'])->whereUuid('type');

        Route::get('/materials', [MaterialController::class, 'index']);
        Route::get('/materials/imports', [MaterialImportController::class, 'index']);
        Route::post('/materials/imports', [MaterialImportController::class, 'stage']);
        Route::get('/materials/imports/{batch}', [MaterialImportController::class, 'show'])->whereUuid('batch');
        Route::post('/materials/imports/{batch}/confirm', [MaterialImportController::class, 'confirm'])->whereUuid('batch');
        Route::post('/materials/imports/{batch}/cancel', [MaterialImportController::class, 'cancel'])->whereUuid('batch');
        Route::get('/materials/{material}', [MaterialController::class, 'show'])->whereUuid('material');
        Route::patch('/materials/{material}', [MaterialController::class, 'update'])->whereUuid('material');
    });
});
