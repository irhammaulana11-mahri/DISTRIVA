<?php

return [
    'authorization_guard' => env('DISTRIVA_AUTHORIZATION_GUARD', 'web'),
    'business_timezone' => env('DISTRIVA_BUSINESS_TIMEZONE', 'Asia/Jakarta'),
    // EIS sync scope: a NEW application is taken from this many VA of new power (owner 8 Nov 2026: 6600 = 3-phase only; owner 13 Nov 2026: 0 = every power, the power range is now set on the EIS side). 0 = no filter.
    // Master gardu (owner 2026-11-10): a reading older than this many days is shown as expired (stale); a phase current is turned into kVA with this phase-to-neutral voltage.
    'substation_reading_max_age_days' => (int) env('DISTRIVA_SUBSTATION_READING_MAX_AGE_DAYS', 365),
    'substation_phase_voltage_v' => (float) env('DISTRIVA_SUBSTATION_PHASE_VOLTAGE_V', 220),
    // Gardu analysis (owner 2026-11-11). base voltage (tegangan pangkal) below 231 V is flagged (owner); the other limits are working defaults to confirm: phase / jurusan imbalance %, end-voltage drop % of the base voltage.
    'substation_base_voltage_min_v' => (float) env('DISTRIVA_SUBSTATION_BASE_VOLTAGE_MIN_V', 231),
    // owner 2026-11-16: unbalanced when the phases differ by more than 30 % (main and jurusan alike); voltage drops when it is more than 10 % below the 220 V nominal
    'substation_imbalance_max_pct' => (float) env('DISTRIVA_SUBSTATION_IMBALANCE_MAX_PCT', 30),
    'substation_nominal_voltage_v' => (float) env('DISTRIVA_SUBSTATION_NOMINAL_VOLTAGE_V', 220),
    'substation_feeder_imbalance_max_pct' => (float) env('DISTRIVA_SUBSTATION_FEEDER_IMBALANCE_MAX_PCT', 30),
    'substation_drop_max_pct' => (float) env('DISTRIVA_SUBSTATION_DROP_MAX_PCT', 10),
    // EIS sync scope by status (owner 2026-11-14): a NEW application (No. Agenda not yet in DISTRIVA) is taken only while its internal status is one of these (BAYAR / CETAK PK); any other status is counted as out of scope
    // (OUT_OF_SCOPE_STATUS). An application already registered keeps syncing in every status. Empty = no filter.
    'eis_new_statuses' => array_values(array_filter(array_map('trim', explode(',', (string) env('DISTRIVA_EIS_NEW_STATUSES', 'PAID,PK_PRINTED,CONNECTION_IN_PROGRESS,CONNECTION_DONE'))))),
    // A survey cannot be submitted before its KKO is recorded (owner 2026-11-14, docs/82). Switch off only for a ULP without gardu data yet.
    'survey_requires_kko' => (bool) env('DISTRIVA_SURVEY_REQUIRES_KKO', true),
    'eis_min_power_va' => (int) env('DISTRIVA_EIS_MIN_POWER_VA', 0),
    // Databases where destructive Artisan commands (migrate:fresh, db:wipe, ...) are allowed.
    'disposable_databases' => ['distriva_backend_test'],
    // Password policy = docs/16: min length, upper+lower+digit+symbol, last-N history, common-password denylist.
    'password_min_length' => (int) env('DISTRIVA_PASSWORD_MIN_LENGTH', 8),
    'password_history_count' => (int) env('DISTRIVA_PASSWORD_HISTORY_COUNT', 5),
    // Breached-password lookup calls api.pwnedpasswords.com (k-anonymity, but still an external request). Off by default.
    'password_check_breached' => (bool) env('DISTRIVA_PASSWORD_CHECK_BREACHED', false),
    // API token idle timeout in minutes: expires_at slides forward on every authenticated request.
    'token_idle_minutes' => (int) env('DISTRIVA_TOKEN_IDLE_MINUTES', 30),
    // Doc 16: lock the account after N consecutive failed logins, for M minutes.
    'login_max_attempts' => (int) env('DISTRIVA_LOGIN_MAX_ATTEMPTS', 5),
    'login_lockout_minutes' => (int) env('DISTRIVA_LOGIN_LOCKOUT_MINUTES', 15),
    // MFA (TOTP) is mandatory for SYS_ADMIN (docs/16). true = a SYS_ADMIN token must be MFA-verified before it can do anything.
    'system_writes_require_mfa' => (bool) env('DISTRIVA_SYSTEM_WRITES_REQUIRE_MFA', true),
    // Private disk of the documents module (never the public disk): files are only served through the authorised download endpoint.
    // Its root is DISTRIVA_DOCUMENTS_ROOT (a path on the media drive; see config/filesystems.php).
    'pdftotext' => env('DISTRIVA_PDFTOTEXT', 'pdftotext'),   // reads text + positions of the GAMBAR sheet exported to PDF (poppler-utils)
    'documents_disk' => env('DISTRIVA_DOCUMENTS_DISK', 'documents'),
    // LibreOffice (soffice) renders spreadsheets to PDF for the drawing preview; empty = auto-detect on PATH, preview falls back to the table.
    'soffice_binary' => env('SOFFICE_BINARY', ''),
    'preview_timeout' => (int) env('PREVIEW_RENDER_TIMEOUT', 60),
    // docs/16 + docs/54 G-5: validity of an admin-issued initial password.
    'temp_password_hours' => (int) env('DISTRIVA_TEMP_PASSWORD_HOURS', 24),
    // One-time code (OTP) for account activation and recovery (decision 2026-11-06, docs/15, docs/56).
    'otp' => [
        'length' => 6,
        'ttl_minutes' => (int) env('DISTRIVA_OTP_TTL_MINUTES', 10),
        'max_attempts' => (int) env('DISTRIVA_OTP_MAX_ATTEMPTS', 5),            // wrong codes before the code is voided
        'resend_cooldown_seconds' => (int) env('DISTRIVA_OTP_RESEND_COOLDOWN', 60),
        'max_requests_per_hour' => (int) env('DISTRIVA_OTP_MAX_REQUESTS_PER_HOUR', 5), // per e-mail address, existing or not
    ],
    // Base URL of the web app, used in invitation messages (e.g. https://distriva.example.co.id).
    'frontend_url' => rtrim((string) env('DISTRIVA_FRONTEND_URL', ''), '/'),
    // Construction groups in scope (owner decision 2026-11-06): the seven main groups. PBPD is a separate iteration;
    // SKTR, SKSR and GD PSG DLM (broken legacy sheets with old-style codes) are not used for now.
    'construction_groups' => ['SUTM', 'MVTIC', 'SUTR', 'SKTM', 'KUBIKEL', 'GTT_UMUM', 'GTT_KHUSUS'],

    /* BOM groups = construction groups + PBPD sheets (pasang baru / perubahan daya; no construction rows, driven by PBPD:* parameters; docs/62 §16). */
    'bom_groups' => ['SUTM', 'MVTIC', 'SUTR', 'SKTM', 'KUBIKEL', 'GTT_UMUM', 'GTT_KHUSUS', 'PBPD_6_41', 'PBPD_53_197', 'SR1PH'],
    /** Display names of the groups whose workbook code is not self-explanatory (owner 2026-11-09); a group not listed shows its code. */
    'bom_group_names' => ['PBPD_6_41' => 'APP Pengukuran Langsung', 'PBPD_53_197' => 'APP Pengukuran Tak Langsung', 'SR1PH' => 'APP 1 Phasa'],

    /*
     * Backup / restore (docs/64). Root = ABSOLUTE path on the media drive, outside the project and the web root (checked at run time).
     * The temporary default keeps the files inside storage/ until the media drive path is set (DISTRIVA_BACKUP_ROOT).
     */
    // EIS sync started from DISTRIVA (docs/82 §19.15): runs tools/eis_sync (Python) in a detached process; the EIS account and the schedule are kept in eis_sync_settings.
    'eis_sync' => [
        'python' => env('DISTRIVA_EIS_PYTHON', 'python3'),
        'dir' => env('DISTRIVA_EIS_SYNC_DIR', base_path('../tools/eis_sync')),
        'api_url' => env('DISTRIVA_EIS_API_URL', env('APP_URL', 'http://127.0.0.1:8000')),
        'timeout_seconds' => (int) env('DISTRIVA_EIS_SYNC_TIMEOUT', 10800),
        'run_inline' => (bool) env('DISTRIVA_EIS_SYNC_INLINE', false),   // true: run in the request (tests); false: detached `artisan` process
    ],
    'backup' => [
        'root' => env('DISTRIVA_BACKUP_ROOT', storage_path('app/private/backups')),
        'pg_dump' => env('DISTRIVA_PG_DUMP', 'pg_dump'),
        'pg_restore' => env('DISTRIVA_PG_RESTORE', 'pg_restore'),
        'psql' => env('DISTRIVA_PSQL', 'psql'),
        'tar' => env('DISTRIVA_TAR', 'tar'),
        'php' => env('DISTRIVA_PHP_BINARY', 'php'),
        'timeout_seconds' => (int) env('DISTRIVA_BACKUP_TIMEOUT', 3600),
        'run_inline' => (bool) env('DISTRIVA_BACKUP_INLINE', false),   // true: run in the request (tests); false: detached `artisan` process
        'target_database' => env('DISTRIVA_RESTORE_TARGET_DATABASE'),    // tests only; null = the application database
        'kept_pre_restore' => 5,
        'stale_after_minutes' => 180,
    ],
    /*
     * Output documents (stage 5D, docs/62 §28): header lines of the PLN forms and the REKAP rows in workbook order. `volume_rows` = BOM rows (workbook cells REKAP!D14:D23:
     * SUTM!H11, MVTIC!H11, SKTM!H11+H24, GTT KHUSUS!H25, GTT UMUM!H25, KUBIKEL!H16, SUTR!H11, 53-197!H10, 6,6-41,5!H10) whose quantity is the group volume; SR1PH volume = row 13 (total SR 1 phase customers, SDES-1 + SDES-2).
     */
    'document' => [
        'company' => ['PT. PLN (PERSERO)', 'UNIT INDUK DISTRIBUSI JAWA TIMUR'],
        'funding_source' => 'Anggaran Investasi PLN',
        'proposal_number_format' => '{seq}/USULAN-PBPD/{dm}/{unit}/{year}',   // owner 7 Nov 2026: 00001/USULAN-PBPD/07-11/51543/2026
        'bastp_number_format' => '{seq}/BASTP/{dm}/{unit}/{year}',    // owner 7 Nov 2026: 00001/BASTP/07-11/51543/2026
        'kkf_number_format' => '{seq}/{ym}/{unit}',                   // owner 7 Nov 2026: nomor urut/tahunbulan/kodeunit
        'background' => ['Perbaikan mutu tegangan', 'Peningkatan kWh penjualan', 'Peningkatan keandalan jaringan', 'Mengurangi susut teknis', 'Peningkatan Rasio Elektrifikasi', 'Peningkatan citra PT. PLN (Persero)'],
        'rekap_rows' => [
            'SUTM' => ['title' => 'Pemasangan Saluran Udara Tegangan Menengah (SUTM)', 'unit' => 'ms', 'volume_rows' => [11]],
            'MVTIC' => ['title' => 'Pemasangan Saluan Kabel Udara Tegangan Menengah (SKUTM / MVTIC)', 'unit' => 'ms', 'volume_rows' => [11]],
            'SKTM' => ['title' => 'Pemasangan Saluan Kabel Tegangan Menengah (SKTM)', 'unit' => 'ms', 'volume_rows' => [11, 24]],
            'GTT_KHUSUS' => ['title' => 'Pemasangan Gardu Trafo Tiang Khusus (GTT Khusus)', 'unit' => 'U', 'volume_rows' => [25]],
            'GTT_UMUM' => ['title' => 'Pemasangan Gardu Trafo Tiang Umum (GTT Umum)', 'unit' => 'U', 'volume_rows' => [25]],
            'KUBIKEL' => ['title' => 'Pemasangan Kubikel', 'unit' => 'U', 'volume_rows' => [16]],
            'SUTR' => ['title' => 'Pemasangan Saluran Udara Tegangan Rendah (SUTR)', 'unit' => 'ms', 'volume_rows' => [11]],
            'PBPD_53_197' => ['title' => 'Pemasangan APP Pengukuran Tak Langsung (53 s/d 197 kVA)', 'unit' => 'Plg', 'volume_rows' => [10]],
            'PBPD_6_41' => ['title' => 'Pemasangan APP Pengukuran Langsung (6,6 s/d 41,5 kVA)', 'unit' => 'Plg', 'volume_rows' => [10]],
            'SR1PH' => ['title' => 'Pemasangan APP 1 Phasa (SDES-1 dan SDES-2)', 'unit' => 'Plg', 'volume_rows' => [13]],
        ],
    ],
    /*
     * Automatic pull of the ERP (MIMS) stock monitoring (docs/62 §40). The URL pattern seen in the browser is
     * `{base_url}/getMonitoringStock/{regional}&{unit_upi}&{plant}&{stor_loc}&{valuation}&&0/` with an `auth-token` header. Owner 7 Nov 2026: `04` = regional code (REGIONAL JAWA BAGIAN TIMUR, BALI & NUSA TENGGARA)
     * and `51` = unitUpi (UID JAWA TIMUR); the two trailing parameters (`&&0`) are sent unchanged: according to the owner, the stock request for the ending stock ends in zero (not verified).
     * The token is a SECRET: it comes only from the environment (never from the repository, a document or a log) and expires with the MIMS session — a stable service credential is still to be agreed.
     */
    'mims' => [
        'base_url' => env('DISTRIVA_MIMS_BASE_URL'),
        'auth_token' => env('DISTRIVA_MIMS_AUTH_TOKEN'),
        'stock_path' => env('DISTRIVA_MIMS_STOCK_PATH', '/project-i-agodist-api//getMonitoringStock/{regional}&{unit_upi}&{plant}&{stor_loc}&{valuation}&&0/'),
        'regional' => env('DISTRIVA_MIMS_REGIONAL', '04'),            // REGIONAL JAWA BAGIAN TIMUR, BALI & NUSA TENGGARA
        'unit_upi' => env('DISTRIVA_MIMS_UNIT_UPI', '51'),            // UID JAWA TIMUR
        'valuation' => env('DISTRIVA_MIMS_VALUATION', 'NORMAL'),
        // material issues (pengeluaran): the header list is a POST with the payload {plant, stor_loc, status_sap, …}; lines and customers are keyed by the reservation number (`no_pemesanan`)
        'issue_header_path' => env('DISTRIVA_MIMS_ISSUE_HEADER_PATH', '/project-i-agodist-api//getDataPengeluaranHeader/'),
        'issue_detail_path' => env('DISTRIVA_MIMS_ISSUE_DETAIL_PATH', '/project-i-agodist-api//getDataPengeluaranAll/{reservation}/'),
        'issue_mapping_path' => env('DISTRIVA_MIMS_ISSUE_MAPPING_PATH', '/project-i-agodist-api//getDataReservasiMapping/{reservation}/'),
        // material receipts (penerimaan): GET list of the deliveries to the warehouse, then the detail per delivery document
        'receipt_list_path' => env('DISTRIVA_MIMS_RECEIPT_LIST_PATH', '/project-i-agodist-api//getDataPengirimanForPenerimaan/{plant}&&{stor_loc}&&&&S&&/'),
        'receipt_detail_path' => env('DISTRIVA_MIMS_RECEIPT_DETAIL_PATH', '/project-i-agodist-api//getDataPenerimaanAll/{document}/'),
        'issue_days' => (int) env('DISTRIVA_MIMS_ISSUE_DAYS', 90),
        // Verifying the server certificate stays ON. Only switch it off (false) temporarily when MIMS' own certificate is expired/untrusted and cannot be fixed yet: the token is then sent without proof of who is answering.
        'verify_ssl' => filter_var(env('DISTRIVA_MIMS_VERIFY_SSL', true), FILTER_VALIDATE_BOOLEAN),
        'run_inline' => (bool) env('DISTRIVA_MIMS_PULL_INLINE', false),   // true: run a manual pull in the request (tests); false: detached `artisan` process
        'timeout_seconds' => (int) env('DISTRIVA_MIMS_TIMEOUT', 60),
        'mirror_timeout_seconds' => (int) env('DISTRIVA_MIMS_MIRROR_TIMEOUT', 180),   // the document lists (issues, receipts) are slower than the stock call
        'sync_user_email' => env('DISTRIVA_MIMS_SYNC_USER_EMAIL'),       // the account recorded as the creator of automatic snapshots
        'sync_time' => env('DISTRIVA_MIMS_SYNC_TIME', '02:00'),
    ],
];
