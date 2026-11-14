<?php

/*
 * Foundation administration permission catalog and grants (docs/54 §2-§3, decided 2026-11-06).
 * Only keys that have an endpoint are listed. Domain (business) keys are NOT here: O-033 is still
 * OPEN/BLOCKING for them. Guard = distriva.authorization_guard ("web").
 */
return [
    'foundation' => [
        'users.view' => ['UP3_ADMIN', 'SYS_ADMIN'],
        'users.create' => ['UP3_ADMIN', 'SYS_ADMIN'],
        'users.change_status' => ['UP3_ADMIN', 'SYS_ADMIN'],
        'role_assignments.view' => ['UP3_ADMIN', 'SYS_ADMIN'],
        'role_assignments.assign' => ['UP3_ADMIN', 'SYS_ADMIN'],
        'role_assignments.end' => ['UP3_ADMIN', 'SYS_ADMIN'],
        'organizational_units.view' => ['UP3_ADMIN', 'SYS_ADMIN'],
        // D-4 option A (owner, 2026-11-06): only SYS_ADMIN writes organizational units (UP3 and ULP).
        'organizational_units.create' => ['SYS_ADMIN'],
        'organizational_units.update' => ['SYS_ADMIN'],
    ],

    // Keys evaluable with ScopedAuthorizationService UP3_ADMIN_DELEGATION (own UP3 + child ULPs).
    'admin_delegation_keys' => [
        'users.view',
        'users.create',
        'users.change_status',
        'role_assignments.view',
        'role_assignments.assign',
        'role_assignments.end',
        'organizational_units.view',
        'organizational_units.create',
        'organizational_units.update',
    ],

    // Roles an UP3_ADMIN may never grant (docs/54 §4.3): system role and vendor (deny-all until O-029).
    'up3_admin_forbidden_roles' => ['SYS_ADMIN', 'VENDOR'],

    /*
     * Master data (T4.2.2, iteration 2A). Reference data is CENTRAL (docs/16: master SKU terpusat), so these keys are
     * evaluated without a unit target: the actor needs any effective assignment whose role holds the key.
     * Owner decision 2026-11-06 (accepting the proposal): ENGINEERING and PERENCANAAN manage; approval of active
     * versions (KHS/BOM, iterations 2B/2C) belongs to UP3_MANAGER. SYS_ADMIN holds every master-data key (owner decision 2026-11-06: full role, protected by MFA); VENDOR holds none.
     */
    'master_data' => [
        'master_data.view' => ['ENGINEERING', 'PERENCANAAN', 'TEKNIK', 'KONSTRUKSI_UP3', 'UP3_MANAGER', 'MANAGER_ULP', 'ASMAN_PERENCANAAN', 'ASMAN_NIAGA', 'ASMAN_KONSTRUKSI', 'NIAGA_RETAIL', 'VIEWER', 'SYS_ADMIN', 'SYS_ADMIN'],
        'materials.import' => ['ENGINEERING', 'PERENCANAAN', 'SYS_ADMIN'],
        'materials.update' => ['ENGINEERING', 'PERENCANAAN', 'SYS_ADMIN'],
        'material_categories.manage' => ['ENGINEERING', 'PERENCANAAN', 'SYS_ADMIN'],
        'units_of_measure.manage' => ['ENGINEERING', 'PERENCANAAN', 'SYS_ADMIN'],
        // KHS catalogue (iteration 2B-1): draft/import by the managers, approval by UP3_MANAGER (never by the creator).
        'khs.manage' => ['ENGINEERING', 'PERENCANAAN', 'SYS_ADMIN'],
        'khs.approve' => ['UP3_MANAGER', 'SYS_ADMIN'],
        // Construction types and their KHS mappings (iteration 2B-2): same split as KHS.
        'construction_types.manage' => ['ENGINEERING', 'PERENCANAAN', 'SYS_ADMIN'],
        'construction_types.approve' => ['UP3_MANAGER', 'SYS_ADMIN'],
        // BOM per construction group (iteration 2C-2, docs/60): same split — manage vs approve (never the creator).
        'bom.manage' => ['ENGINEERING', 'PERENCANAAN', 'SYS_ADMIN'],
        'bom.approve' => ['UP3_MANAGER', 'SYS_ADMIN'],
        // Price books per contract (stage 5A, docs/62 §19): import/zone by the managers, approval by UP3_MANAGER (never the creator).
        'prices.manage' => ['ENGINEERING', 'PERENCANAAN', 'SYS_ADMIN'],
        'prices.approve' => ['UP3_MANAGER', 'SYS_ADMIN'],
        // KKF parameter sets (stage 5C, docs/62 §25): discount rate, BPP, O&M, etc. Same split; approval never by the creator.
        'kkf_params.manage' => ['ENGINEERING', 'PERENCANAAN', 'SYS_ADMIN'],
        'kkf_params.approve' => ['UP3_MANAGER', 'SYS_ADMIN'],
        // Tariff books (stage 5C, docs/62 §26): average price, jam nyala, UJL per tariff x power; same split.
        'tariffs.manage' => ['ENGINEERING', 'PERENCANAAN', 'SYS_ADMIN'],
        'tariffs.approve' => ['UP3_MANAGER', 'SYS_ADMIN'],
        // Stock and pole contracts (stage 6A, docs/62 §30; owner 7 Nov 2026): PERENCANAAN imports the Kontrak Rinci and plots the concrete poles; the Konstruksi/Gudang side
        // (one role, KONSTRUKSI_UP3) imports stock and plots every other material.
        'stock.import' => ['KONSTRUKSI_UP3', 'SYS_ADMIN'],
        'warehouses.manage' => ['KONSTRUKSI_UP3', 'SYS_ADMIN'],
        'poles.manage' => ['PERENCANAAN', 'SYS_ADMIN'],
        // Vendor master (stage 7, docs/62 §32): companies and linked vendor accounts, by KONSTRUKSI_UP3 (owner 7 Nov 2026).
        'vendors.manage' => ['KONSTRUKSI_UP3', 'SYS_ADMIN'],
    ],

    /*
     * PB/PD applications (stage 1A, docs/62; owner decision 2026-11-06). Scope is by unit: ULP-assigned roles see their ULP,
     * UP3-assigned roles see their child ULPs (read only), SYS_ADMIN everything (MFA). Writes are exact-ULP only.
     * Keys listed in 'applications_descendant_keys' act down the UP3 -> ULP hierarchy (read, and the UP3-level survey decisions); all others are SAME_UNIT only.
     */
    'applications' => [
        'applications.view' => ['NIAGA_RETAIL', 'MANAGER_ULP', 'ASMAN_NIAGA', 'TEKNIK', 'UP3_MANAGER', 'ASMAN_PERENCANAAN', 'ASMAN_KONSTRUKSI', 'KONSTRUKSI_UP3', 'PERENCANAAN', 'ENGINEERING', 'SYS_ADMIN'],
        'applications.create' => ['NIAGA_RETAIL', 'SYS_ADMIN'],
        'applications.update' => ['NIAGA_RETAIL', 'SYS_ADMIN'],
        'applications.submit' => ['NIAGA_RETAIL', 'SYS_ADMIN'],
        'applications.cancel' => ['NIAGA_RETAIL', 'SYS_ADMIN'],
        // Import of the EIS / Bot Daftung download (stage 1B/1C): a ULP-assigned NIAGA_RETAIL imports the rows of its own ULP, a UP3-assigned NIAGA_RETAIL (owner 2026-11-09, the account of the scheduled EIS sync)
        // those of every active ULP below the UP3 (see applications_descendant_keys); SYS_ADMIN every unit (MFA). Creating or changing one application by hand stays exact-ULP.
        'applications.import' => ['NIAGA_RETAIL', 'SYS_ADMIN'],
        // EIS sync started and scheduled from DISTRIVA (EIS account, power range, automatic run); the run uses the import grant of whoever starts it / saved the schedule.
        'eis_sync.manage' => ['NIAGA_RETAIL', 'SYS_ADMIN'],
    ],
    'applications_descendant_keys' => [
        'applications.import', 'applications.view', 'surveys.view', 'surveys.review_perencanaan', 'surveys.review_konstruksi', 'surveys.approve_asman_perencanaan', 'surveys.approve_asman_konstruksi', 'surveys.approve_up3_manager',
        'drawings.view', 'drawings.review_perencanaan', 'drawings.review_konstruksi', 'drawings.approve_asman_perencanaan', 'drawings.approve_asman_niaga', 'drawings.approve_asman_konstruksi',
        'drawings.approve_up3_manager', 'drawings.escalate', 'mto.view', 'rab.view', 'rab.run', 'kkf.view', 'kkf.run', 'kko.view', 'kko.record', 'substations.view', 'substations.import', 'substations.manage', 'substations.reading', 'substations.sync', 'feeders.view', 'feeders.manage', 'customers.view', 'customers.import', 'customers.manage', 'allocations.view', 'allocations.manage', 'allocations.poles', 'pole_wo.view', 'pole_wo.manage', 'pole_wo.close', 'proposals.view', 'rkm.view', 'wo.view', 'wo.create', 'wo.issue', 'wo.progress_submit', 'wo.progress_verify', 'wo.complete', 'bastp.view', 'bastp.sign_konstruksi', 'bastp.close', 'material_requests.view', 'material_requests.manage', 'reports.view', 'reports.settings', 'tasks.view',
    ],

    /*
     * Survey (stage 2, owner decisions 2026-11-06): TEKNIK (ULP) is the surveyor; MANAGER_ULP assigns and approves first; at the UP3 the
     * PERENCANAAN and KONSTRUKSI_UP3 sections review, ASMAN_PERENCANAAN and ASMAN_KONSTRUKSI approve (both), UP3_MANAGER gives the last approval.
     * Any rejection returns the version to the surveyor. SYS_ADMIN holds every key (MFA); the one-decision-per-user rule still applies.
     */
    'surveys' => [
        'surveys.view' => ['NIAGA_RETAIL', 'MANAGER_ULP', 'ASMAN_NIAGA', 'TEKNIK', 'UP3_MANAGER', 'ASMAN_PERENCANAAN', 'ASMAN_KONSTRUKSI', 'KONSTRUKSI_UP3', 'PERENCANAAN', 'ENGINEERING', 'SYS_ADMIN'],
        'surveys.assign' => ['MANAGER_ULP', 'SYS_ADMIN'],
        'surveys.execute' => ['TEKNIK', 'SYS_ADMIN'],
        'surveys.approve_ulp' => ['MANAGER_ULP', 'SYS_ADMIN'],
        'surveys.review_perencanaan' => ['PERENCANAAN', 'SYS_ADMIN'],
        'surveys.review_konstruksi' => ['KONSTRUKSI_UP3', 'SYS_ADMIN'],
        'surveys.approve_asman_perencanaan' => ['ASMAN_PERENCANAAN', 'SYS_ADMIN'],
        'surveys.approve_asman_konstruksi' => ['ASMAN_KONSTRUKSI', 'SYS_ADMIN'],
        'surveys.approve_up3_manager' => ['UP3_MANAGER', 'SYS_ADMIN'],
    ],
    /*
     * Technical drawing (stage 3, owner decisions 2026-11-06): one package per application, many versions (one MAIN file + attachments).
     * Chain: TEKNIK ULP prepares -> MANAGER_ULP -> UP3 review PERENCANAAN + KONSTRUKSI_UP3 (both) -> ASMAN_PERENCANAAN + ASMAN_KONSTRUKSI (both) -> APPROVED.
     * When the feasibility study is "tidak layak" or PBP > 5 years (`extended_approval`) the Asman stage also needs ASMAN_NIAGA (all three) and then UP3_MANAGER.
     * Until RAB/KKF exists (stage 5) the flag is raised by MANAGER_ULP / PERENCANAAN / KONSTRUKSI_UP3 (escalation only, never lowered);
     * stage 5 will set it from the KKF result. Any rejection returns the version to the author and the chain restarts on a new version.
     */
    'drawings' => [
        'drawings.view' => ['NIAGA_RETAIL', 'MANAGER_ULP', 'ASMAN_NIAGA', 'TEKNIK', 'UP3_MANAGER', 'ASMAN_PERENCANAAN', 'ASMAN_KONSTRUKSI', 'KONSTRUKSI_UP3', 'PERENCANAAN', 'ENGINEERING', 'SYS_ADMIN'],
        'drawings.assign' => ['MANAGER_ULP', 'SYS_ADMIN'],
        'drawings.execute' => ['TEKNIK', 'SYS_ADMIN'],
        'drawings.approve_ulp' => ['MANAGER_ULP', 'SYS_ADMIN'],
        'drawings.review_perencanaan' => ['PERENCANAAN', 'SYS_ADMIN'],
        'drawings.review_konstruksi' => ['KONSTRUKSI_UP3', 'SYS_ADMIN'],
        'drawings.approve_asman_perencanaan' => ['ASMAN_PERENCANAAN', 'SYS_ADMIN'],
        'drawings.approve_asman_niaga' => ['ASMAN_NIAGA', 'SYS_ADMIN'],
        'drawings.approve_asman_konstruksi' => ['ASMAN_KONSTRUKSI', 'SYS_ADMIN'],
        'drawings.approve_up3_manager' => ['UP3_MANAGER', 'SYS_ADMIN'],
        'drawings.escalate' => ['MANAGER_ULP', 'PERENCANAAN', 'KONSTRUKSI_UP3', 'SYS_ADMIN'],
    ],
    /*
     * MTO / Auto MTO stage 4A (owner decisions 2026-11-06): the construction quantities of a drawing version are entered by the ULP technical officer
     * (TEKNIK, the author of that version), the material need is computed by the BOM engine, the TEKNIK verifies (snapshot) and MANAGER_ULP approves
     * (verifier != approver). The approved MTO is a PREREQUISITE of the drawing's ULP_MANAGER approval (docs/26 section 4); only then can UP3 review start.
     */
    'mto' => [
        'mto.view' => ['NIAGA_RETAIL', 'MANAGER_ULP', 'ASMAN_NIAGA', 'TEKNIK', 'UP3_MANAGER', 'ASMAN_PERENCANAAN', 'ASMAN_KONSTRUKSI', 'KONSTRUKSI_UP3', 'PERENCANAAN', 'ENGINEERING', 'SYS_ADMIN'],
        'mto.execute' => ['TEKNIK', 'SYS_ADMIN'],
        'mto.approve' => ['MANAGER_ULP', 'SYS_ADMIN'],
    ],

    /*
     * RAB (stage 5B, docs/62 §21; owner decision 2026-11-07): PERENCANAAN UP3 runs the RAB after the MTO is APPROVED; no RAB approval of its own
     * (it is an input of the KKF). Both keys act down the UP3 -> ULP hierarchy (see 'applications_descendant_keys').
     */
    /*
     * Planning keys (stage 6, docs/62 §30-31): allocations per application, RKM (owner decisions 7 Nov 2026: TEKNIK prepares and MANAGER_ULP submits the ULP proposal;
     * PERENCANAAN and KONSTRUKSI_UP3 both validate the same version as different users; UP3_MANAGER decides). Keys that act down UP3 -> ULP are in 'applications_descendant_keys'.
     */
    'planning' => [
        // Usulan with several customers (docs/62 §37): 3-phase customers are picked from a searchable table; ULP-level staff create and edit proposals.
        'proposals.view' => ['NIAGA_RETAIL', 'MANAGER_ULP', 'ASMAN_NIAGA', 'TEKNIK', 'UP3_MANAGER', 'ASMAN_PERENCANAAN', 'ASMAN_KONSTRUKSI', 'KONSTRUKSI_UP3', 'PERENCANAAN', 'ENGINEERING', 'SYS_ADMIN'],
        'proposals.manage' => ['NIAGA_RETAIL', 'MANAGER_ULP', 'TEKNIK', 'SYS_ADMIN'],
        'allocations.view' => ['MANAGER_ULP', 'ASMAN_NIAGA', 'TEKNIK', 'UP3_MANAGER', 'ASMAN_PERENCANAAN', 'ASMAN_KONSTRUKSI', 'KONSTRUKSI_UP3', 'PERENCANAAN', 'ENGINEERING', 'SYS_ADMIN'],
        'allocations.manage' => ['KONSTRUKSI_UP3', 'SYS_ADMIN'],        // the materials part (everything except concrete poles)
        'allocations.poles' => ['PERENCANAAN', 'SYS_ADMIN'],            // the poles part (TM/TR with the Kontrak Rinci number)
        'rkm.view' => ['MANAGER_ULP', 'ASMAN_NIAGA', 'TEKNIK', 'UP3_MANAGER', 'ASMAN_PERENCANAAN', 'ASMAN_KONSTRUKSI', 'KONSTRUKSI_UP3', 'PERENCANAAN', 'ENGINEERING', 'SYS_ADMIN'],
        'rkm.plan' => ['PERENCANAAN', 'SYS_ADMIN'],
        'rkm.prepare' => ['TEKNIK', 'SYS_ADMIN'],
        'rkm.submit' => ['MANAGER_ULP', 'SYS_ADMIN'],
        'rkm.validate_perencanaan' => ['PERENCANAAN', 'SYS_ADMIN'],
        'rkm.validate_konstruksi' => ['KONSTRUKSI_UP3', 'SYS_ADMIN'],
        'rkm.approve' => ['UP3_MANAGER', 'SYS_ADMIN'],
        // Work orders (stage 7, docs/62 §32; owner 7 Nov 2026): KONSTRUKSI_UP3 creates and selects the vendor, ASMAN_KONSTRUKSI approves/issues (WO + vendor in one decision) and completes;
        // progress is submitted by the assigned vendor (through the persisted relation, not a key) or internally, and verified by KONSTRUKSI_UP3 as a different user.
        'wo.view' => ['MANAGER_ULP', 'TEKNIK', 'KONSTRUKSI_UP3', 'ASMAN_KONSTRUKSI', 'UP3_MANAGER', 'PERENCANAAN', 'ASMAN_PERENCANAAN', 'ASMAN_NIAGA', 'ENGINEERING', 'SYS_ADMIN'],
        'wo.create' => ['KONSTRUKSI_UP3', 'SYS_ADMIN'],
        'wo.issue' => ['ASMAN_KONSTRUKSI', 'SYS_ADMIN'],
        'wo.progress_submit' => ['TEKNIK', 'KONSTRUKSI_UP3', 'SYS_ADMIN'],
        'wo.progress_verify' => ['KONSTRUKSI_UP3', 'SYS_ADMIN'],
        'wo.complete' => ['ASMAN_KONSTRUKSI', 'SYS_ADMIN'],
        // BASTP (stage 8, docs/62 §36; owner 7 Nov 2026): the assigned vendor (relation) or TEKNIK prepares and submits, MANAGER_ULP accepts, KONSTRUKSI_UP3 signs, ASMAN_KONSTRUKSI signs and closes
        // (closing completes the WO). Electronic signatures; one signature per user per round.
        'bastp.view' => ['MANAGER_ULP', 'TEKNIK', 'KONSTRUKSI_UP3', 'ASMAN_KONSTRUKSI', 'UP3_MANAGER', 'PERENCANAAN', 'ASMAN_PERENCANAAN', 'ASMAN_NIAGA', 'ENGINEERING', 'SYS_ADMIN'],
        'bastp.prepare' => ['TEKNIK', 'SYS_ADMIN'],
        'bastp.accept' => ['MANAGER_ULP', 'SYS_ADMIN'],
        'bastp.sign_konstruksi' => ['KONSTRUKSI_UP3', 'SYS_ADMIN'],
        'bastp.close' => ['ASMAN_KONSTRUKSI', 'SYS_ADMIN'],
        // WO Tiang (owner 12 Nov 2026): the pole vendor (a company of its own) works from a letter (AMS number) that may list several locations; PERENCANAAN creates/issues it and verifies the vendor's
        // progress, ASMAN_PERENCANAAN closes the pole BASTP (closing completes the pole WO). The vendor acts through the persisted relation, not a key.
        'pole_wo.view' => ['MANAGER_ULP', 'TEKNIK', 'KONSTRUKSI_UP3', 'ASMAN_KONSTRUKSI', 'UP3_MANAGER', 'PERENCANAAN', 'ASMAN_PERENCANAAN', 'ASMAN_NIAGA', 'ENGINEERING', 'SYS_ADMIN'],
        'pole_wo.manage' => ['PERENCANAAN', 'SYS_ADMIN'],
        'pole_wo.close' => ['ASMAN_PERENCANAAN', 'SYS_ADMIN'],
        // Material need handed to the existing material application (outbox, docs/62 §40) and reports (docs/62 §41).
        'material_requests.view' => ['MANAGER_ULP', 'TEKNIK', 'KONSTRUKSI_UP3', 'ASMAN_KONSTRUKSI', 'UP3_MANAGER', 'PERENCANAAN', 'ASMAN_PERENCANAAN', 'ENGINEERING', 'SYS_ADMIN'],
        'material_requests.manage' => ['KONSTRUKSI_UP3', 'SYS_ADMIN'],
        'reports.settings' => ['SYS_ADMIN'],
        // Application tasks and internal SLA (docs/24 §8): everyone who sees applications sees the tasks of their scope; the ULP manager assigns and reviews; only SYS_ADMIN edits the SLA and the holidays.
        'tasks.view' => ['NIAGA_RETAIL', 'MANAGER_ULP', 'ASMAN_NIAGA', 'TEKNIK', 'UP3_MANAGER', 'ASMAN_PERENCANAAN', 'ASMAN_KONSTRUKSI', 'KONSTRUKSI_UP3', 'PERENCANAAN', 'ENGINEERING', 'SYS_ADMIN'],
        'tasks.assign' => ['MANAGER_ULP', 'SYS_ADMIN'],
        'sla.manage' => ['SYS_ADMIN'],
        'reports.view' => ['NIAGA_RETAIL', 'MANAGER_ULP', 'ASMAN_NIAGA', 'TEKNIK', 'UP3_MANAGER', 'ASMAN_PERENCANAAN', 'ASMAN_KONSTRUKSI', 'KONSTRUKSI_UP3', 'PERENCANAAN', 'ENGINEERING', 'SYS_ADMIN'],
    ],

    'kkf' => [
        'kkf.view' => ['MANAGER_ULP', 'ASMAN_NIAGA', 'TEKNIK', 'UP3_MANAGER', 'ASMAN_PERENCANAAN', 'ASMAN_KONSTRUKSI', 'KONSTRUKSI_UP3', 'PERENCANAAN', 'ENGINEERING', 'SYS_ADMIN'],
        'kkf.run' => ['PERENCANAAN', 'SYS_ADMIN'],
    ],

    // KKO (owner 2026-11-09): technical study of the transformer loading and the voltage at the customer's location. TEKNIK (the surveyor) records the survey result and decides LAYAK / TIDAK LAYAK; the study never blocks the flow.
    'kko' => [
        'kko.view' => ['MANAGER_ULP', 'ASMAN_NIAGA', 'TEKNIK', 'UP3_MANAGER', 'ASMAN_PERENCANAAN', 'ASMAN_KONSTRUKSI', 'KONSTRUKSI_UP3', 'PERENCANAAN', 'ENGINEERING', 'SYS_ADMIN'],
        'kko.record' => ['TEKNIK', 'PERENCANAAN', 'SYS_ADMIN'],
        'kko.decide' => ['TEKNIK', 'SYS_ADMIN'],
    ],

    // Master gardu for KKO (owner 2026-11-10, docs/80): everyone who works on a KKO may read it; the UP3 planning / engineering sections manage and import it; the survey adds a reading;
    // the daily bot (an ENGINEERING / PERENCANAAN account at the UP3) only sends readings. All act down UP3 -> ULP (applications_descendant_keys); SYS_ADMIN every unit (MFA for writes).
    'substations' => [
        'substations.view' => ['MANAGER_ULP', 'ASMAN_NIAGA', 'TEKNIK', 'UP3_MANAGER', 'ASMAN_PERENCANAAN', 'ASMAN_KONSTRUKSI', 'KONSTRUKSI_UP3', 'PERENCANAAN', 'ENGINEERING', 'SYS_ADMIN'],
        'substations.import' => ['PERENCANAAN', 'ENGINEERING', 'SYS_ADMIN'],
        'substations.manage' => ['PERENCANAAN', 'ENGINEERING', 'SYS_ADMIN'],
        'substations.reading' => ['TEKNIK', 'PERENCANAAN', 'ENGINEERING', 'SYS_ADMIN'],
        'substations.sync' => ['PERENCANAAN', 'ENGINEERING', 'SYS_ADMIN'],
    ],

    // Master penyulang (owner 2026-11-12, docs/81): read like the gardu; the UP3 planning / engineering sections manage it. Scope: the owner unit (UP3 or ULP) and every unit with a gardu on the feeder.
    'feeders' => [
        'feeders.view' => ['MANAGER_ULP', 'ASMAN_NIAGA', 'TEKNIK', 'UP3_MANAGER', 'ASMAN_PERENCANAAN', 'ASMAN_KONSTRUKSI', 'KONSTRUKSI_UP3', 'PERENCANAAN', 'ENGINEERING', 'SYS_ADMIN'],
        'feeders.manage' => ['PERENCANAAN', 'ENGINEERING', 'SYS_ADMIN'],
    ],

    // Master pelanggan (owner 2026-11-12, docs/81): the customer connections (IDPEL) linked to gardu and feeder. Read by everyone who works with the network or the applications; the DIL is loaded by the Niaga account of the
    // UP3 (like the EIS sync) or the planning / engineering sections; fixing a customer's gardu by hand is for planning / engineering / the ULP technician. Same UP3 -> ULP scoping as the gardu.
    'customers' => [
        'customers.view' => ['NIAGA_RETAIL', 'MANAGER_ULP', 'ASMAN_NIAGA', 'TEKNIK', 'UP3_MANAGER', 'ASMAN_PERENCANAAN', 'ASMAN_KONSTRUKSI', 'KONSTRUKSI_UP3', 'PERENCANAAN', 'ENGINEERING', 'SYS_ADMIN'],
        'customers.import' => ['NIAGA_RETAIL', 'PERENCANAAN', 'ENGINEERING', 'SYS_ADMIN'],
        'customers.manage' => ['TEKNIK', 'PERENCANAAN', 'ENGINEERING', 'SYS_ADMIN'],
    ],

    'rab' => [
        'rab.view' => ['MANAGER_ULP', 'ASMAN_NIAGA', 'TEKNIK', 'UP3_MANAGER', 'ASMAN_PERENCANAAN', 'ASMAN_KONSTRUKSI', 'KONSTRUKSI_UP3', 'PERENCANAAN', 'ENGINEERING', 'SYS_ADMIN'],
        'rab.run' => ['PERENCANAAN', 'SYS_ADMIN'],
    ],

    /*
     * Backup and restore (docs/64; owner request 2026-11-06). Operational and sensitive (a dump holds every table): SYS_ADMIN only, which needs MFA.
     * `backups.restore` replaces the live data and is therefore its own key.
     */
    'backups' => [
        'backups.view' => ['SYS_ADMIN'],
        'backups.create' => ['SYS_ADMIN'],
        'backups.verify' => ['SYS_ADMIN'],
        'backups.download' => ['SYS_ADMIN'],
        'backups.manage' => ['SYS_ADMIN'],
        'backups.restore' => ['SYS_ADMIN'],
    ],

    // who may raise the extended-approval requirement at which moment (SYS_ADMIN at both)
    'drawing_escalation' => ['SUBMITTED' => ['MANAGER_ULP', 'SYS_ADMIN'], 'UP3_REVIEW' => ['PERENCANAAN', 'KONSTRUKSI_UP3', 'SYS_ADMIN']],
    // step -> [key, stage the version must be in, steps that must all be APPROVED to advance (normal / extended), next [status, stage] (normal / extended)]
    // Normal chain: ULP_MANAGER -> UP3_REVIEW (both) -> ASMAN (ASMAN_PERENCANAAN + ASMAN_KONSTRUKSI, both) -> APPROVED.
    // Extended chain (extended_approval): ... -> ASMAN (+ ASMAN_NIAGA, all three) -> UP3_MANAGER -> APPROVED. ASMAN_NIAGA exists only in the extended chain.
    'drawing_steps' => [
        'ULP_MANAGER' => ['key' => 'drawings.approve_ulp', 'stage' => 'ULP_MANAGER', 'group' => ['ULP_MANAGER'], 'next' => ['status' => 'UNDER_REVIEW', 'stage' => 'UP3_REVIEW']],
        'REVIEW_PERENCANAAN' => ['key' => 'drawings.review_perencanaan', 'stage' => 'UP3_REVIEW', 'group' => ['REVIEW_PERENCANAAN', 'REVIEW_KONSTRUKSI'], 'next' => ['status' => 'UNDER_REVIEW', 'stage' => 'ASMAN']],
        'REVIEW_KONSTRUKSI' => ['key' => 'drawings.review_konstruksi', 'stage' => 'UP3_REVIEW', 'group' => ['REVIEW_PERENCANAAN', 'REVIEW_KONSTRUKSI'], 'next' => ['status' => 'UNDER_REVIEW', 'stage' => 'ASMAN']],
        'ASMAN_PERENCANAAN' => ['key' => 'drawings.approve_asman_perencanaan', 'stage' => 'ASMAN', 'group' => ['ASMAN_PERENCANAAN', 'ASMAN_KONSTRUKSI'], 'group_extended' => ['ASMAN_PERENCANAAN', 'ASMAN_NIAGA', 'ASMAN_KONSTRUKSI'],
            'next' => ['status' => 'APPROVED', 'stage' => null], 'next_extended' => ['status' => 'UNDER_REVIEW', 'stage' => 'UP3_MANAGER']],
        'ASMAN_NIAGA' => ['key' => 'drawings.approve_asman_niaga', 'stage' => 'ASMAN', 'only_extended' => true, 'group' => ['ASMAN_PERENCANAAN', 'ASMAN_NIAGA', 'ASMAN_KONSTRUKSI'], 'group_extended' => ['ASMAN_PERENCANAAN', 'ASMAN_NIAGA', 'ASMAN_KONSTRUKSI'],
            'next' => ['status' => 'UNDER_REVIEW', 'stage' => 'UP3_MANAGER'], 'next_extended' => ['status' => 'UNDER_REVIEW', 'stage' => 'UP3_MANAGER']],
        'ASMAN_KONSTRUKSI' => ['key' => 'drawings.approve_asman_konstruksi', 'stage' => 'ASMAN', 'group' => ['ASMAN_PERENCANAAN', 'ASMAN_KONSTRUKSI'], 'group_extended' => ['ASMAN_PERENCANAAN', 'ASMAN_NIAGA', 'ASMAN_KONSTRUKSI'],
            'next' => ['status' => 'APPROVED', 'stage' => null], 'next_extended' => ['status' => 'UNDER_REVIEW', 'stage' => 'UP3_MANAGER']],
        'UP3_MANAGER' => ['key' => 'drawings.approve_up3_manager', 'stage' => 'UP3_MANAGER', 'group' => ['UP3_MANAGER'], 'next' => ['status' => 'APPROVED', 'stage' => null]],
    ],

    // approval step -> [permission key, stage the version must be in, steps that must all be APPROVED to advance, next [status, stage]]
    'survey_steps' => [
        'ULP_MANAGER' => ['key' => 'surveys.approve_ulp', 'stage' => 'ULP_MANAGER', 'group' => ['ULP_MANAGER'], 'next' => ['status' => 'ACCEPTED', 'stage' => null]],      // owner 2026-11-16: the ULP manager alone accepts every survey
        'REVIEW_PERENCANAAN' => ['key' => 'surveys.review_perencanaan', 'stage' => 'UP3_REVIEW', 'group' => ['REVIEW_PERENCANAAN', 'REVIEW_KONSTRUKSI'], 'next' => ['status' => 'UNDER_REVIEW', 'stage' => 'ASMAN']],
        'REVIEW_KONSTRUKSI' => ['key' => 'surveys.review_konstruksi', 'stage' => 'UP3_REVIEW', 'group' => ['REVIEW_PERENCANAAN', 'REVIEW_KONSTRUKSI'], 'next' => ['status' => 'UNDER_REVIEW', 'stage' => 'ASMAN']],
        'ASMAN_PERENCANAAN' => ['key' => 'surveys.approve_asman_perencanaan', 'stage' => 'ASMAN', 'group' => ['ASMAN_PERENCANAAN', 'ASMAN_KONSTRUKSI'], 'next' => ['status' => 'ACCEPTED', 'stage' => null]],
        'ASMAN_KONSTRUKSI' => ['key' => 'surveys.approve_asman_konstruksi', 'stage' => 'ASMAN', 'group' => ['ASMAN_PERENCANAAN', 'ASMAN_KONSTRUKSI'], 'next' => ['status' => 'ACCEPTED', 'stage' => null]],
    ],

    // Import limits.
    'master_data_import' => ['max_rows' => 20000, 'max_kb' => 5120],
];
