-- DISTRIVA v3.2 — T4.2.4 PostgreSQL DDL baseline
-- Design artifact only. Run only after review and after dependency migrations exist.
-- Dependencies: users(id UUID), roles(id BIGINT), organizational_units(id UUID),
-- applications(id UUID, application_type), materials(id UUID), units_of_measure(id UUID),
-- khs_items(id UUID), khs_item_versions(id UUID), bom_headers(id UUID), bom_items(id UUID),
-- bom_formula_definitions(id UUID). This script does not create those tables.

CREATE TABLE document_categories (
 id uuid PRIMARY KEY, code varchar(50) NOT NULL UNIQUE, name varchar(150) NOT NULL,
 description text, allowed_extensions jsonb NOT NULL DEFAULT '[]'::jsonb,
 requires_versioning boolean NOT NULL DEFAULT true, is_active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK (jsonb_typeof(allowed_extensions)='array')
);
CREATE TABLE document_requirements (
 id uuid PRIMARY KEY, category_id uuid NOT NULL REFERENCES document_categories(id) ON DELETE RESTRICT,
 application_type varchar(5), workflow_stage varchar(60) NOT NULL, requirement_name varchar(180) NOT NULL,
 is_required boolean NOT NULL DEFAULT true, condition_key varchar(100), min_files integer NOT NULL DEFAULT 1,
 max_files integer, allowed_extensions jsonb,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK (application_type IS NULL OR application_type IN ('PB','PD')),
 CHECK (min_files >= 0 AND (max_files IS NULL OR max_files >= min_files)),
 CHECK (allowed_extensions IS NULL OR jsonb_typeof(allowed_extensions)='array')
);
CREATE INDEX idx_document_requirements_match ON document_requirements(category_id,application_type,workflow_stage);
CREATE TABLE document_requirement_compliances (
 id uuid PRIMARY KEY, application_id uuid NOT NULL REFERENCES applications(id) ON DELETE RESTRICT,
 document_requirement_id uuid NOT NULL REFERENCES document_requirements(id) ON DELETE RESTRICT,
 status varchar(24) NOT NULL DEFAULT 'PENDING', fulfilled_at timestamptz,
 checked_by uuid REFERENCES users(id) ON DELETE RESTRICT, notes text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(application_id,document_requirement_id),
 CHECK(status IN ('PENDING','FULFILLED','NOT_APPLICABLE','REJECTED'))
);
CREATE INDEX idx_doc_compliance_app_status ON document_requirement_compliances(application_id,status);
CREATE TABLE document_storage_locations (
 id uuid PRIMARY KEY, storage_name varchar(100) NOT NULL UNIQUE,
 storage_type varchar(24) NOT NULL, root_path text NOT NULL, is_active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(storage_type IN ('LOCAL_PRIVATE','OBJECT_PRIVATE'))
);
CREATE TABLE application_documents (
 id uuid PRIMARY KEY, application_id uuid NOT NULL REFERENCES applications(id) ON DELETE RESTRICT,
 category_id uuid NOT NULL REFERENCES document_categories(id) ON DELETE RESTRICT,
 requirement_id uuid REFERENCES document_requirements(id) ON DELETE RESTRICT,
 document_code varchar(100) NOT NULL UNIQUE, title varchar(255) NOT NULL, description text,
 current_version_id uuid, document_status varchar(30) NOT NULL DEFAULT 'DRAFT',
 created_by uuid REFERENCES users(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(document_status IN ('DRAFT','ACTIVE','UNDER_REVIEW','REVISION_REQUIRED','APPROVED','REJECTED','ARCHIVED')),
 UNIQUE(id,application_id)
);
CREATE INDEX idx_application_documents_app_category ON application_documents(application_id,category_id);
CREATE INDEX idx_application_documents_status ON application_documents(document_status);
CREATE TABLE application_document_versions (
 id uuid PRIMARY KEY, document_id uuid NOT NULL REFERENCES application_documents(id) ON DELETE RESTRICT,
 version_number integer NOT NULL, previous_version_id uuid,
 original_filename text NOT NULL, stored_filename varchar(255) NOT NULL,
 storage_location_id uuid NOT NULL REFERENCES document_storage_locations(id) ON DELETE RESTRICT,
 storage_key text NOT NULL, mime_type varchar(150) NOT NULL, file_extension varchar(15) NOT NULL,
 file_size_bytes bigint NOT NULL, sha256 char(64) NOT NULL, revision_reason text,
 lifecycle_status varchar(20) NOT NULL DEFAULT 'UPLOADED', uploaded_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 uploaded_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(document_id,version_number), UNIQUE(document_id,id),
 FOREIGN KEY(document_id,previous_version_id) REFERENCES application_document_versions(document_id,id) ON DELETE RESTRICT,
 CHECK(version_number > 0), CHECK(file_size_bytes > 0), CHECK(sha256 ~ '^[0-9a-fA-F]{64}$'),
 CHECK(lifecycle_status IN ('UPLOADED','SUPERSEDED','ARCHIVED','QUARANTINED','REJECTED')),
 CHECK(previous_version_id IS NULL OR previous_version_id <> id)
);
ALTER TABLE application_documents ADD CONSTRAINT fk_application_documents_current_version
 FOREIGN KEY(id,current_version_id) REFERENCES application_document_versions(document_id,id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX idx_doc_versions_checksum ON application_document_versions(sha256);
CREATE INDEX idx_doc_versions_uploaded ON application_document_versions(uploaded_at DESC);
CREATE TABLE document_access_logs (
 id uuid PRIMARY KEY, document_id uuid NOT NULL, document_version_id uuid NOT NULL,
 actor_user_id uuid REFERENCES users(id) ON DELETE RESTRICT, actor_type varchar(20) NOT NULL DEFAULT 'USER',
 action varchar(20) NOT NULL, source varchar(100), reference_id varchar(150), accessed_at timestamptz NOT NULL DEFAULT now(),
 metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
 FOREIGN KEY(document_id,document_version_id) REFERENCES application_document_versions(document_id,id) ON DELETE RESTRICT,
 CHECK(actor_type IN ('USER','SERVICE')), CHECK(action IN ('VIEW','DOWNLOAD','PREVIEW'))
);
CREATE INDEX idx_document_access_logs_doc_time ON document_access_logs(document_id,accessed_at DESC);
CREATE INDEX idx_document_access_logs_actor_time ON document_access_logs(actor_user_id,accessed_at DESC);

CREATE TABLE document_workflow_templates (
 id uuid PRIMARY KEY, code varchar(80) NOT NULL, version_number integer NOT NULL,
 status varchar(24) NOT NULL DEFAULT 'DRAFT', effective_from date, effective_until date,
 created_by uuid REFERENCES users(id) ON DELETE RESTRICT, approved_by uuid REFERENCES users(id) ON DELETE RESTRICT,
 approved_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(code,version_number), UNIQUE(id,version_number), CHECK(version_number>0),
 CHECK(status IN ('DRAFT','PENDING_APPROVAL','APPROVED','ACTIVE','INACTIVE','REJECTED')),
 CHECK(effective_until IS NULL OR effective_from IS NULL OR effective_until>=effective_from)
);
CREATE TABLE document_workflow_rules (
 id uuid PRIMARY KEY, template_id uuid NOT NULL REFERENCES document_workflow_templates(id) ON DELETE RESTRICT,
 category_id uuid NOT NULL REFERENCES document_categories(id) ON DELETE RESTRICT,
 application_type varchar(5), workflow_stage varchar(60) NOT NULL, condition_key varchar(100),
 priority integer NOT NULL DEFAULT 100, is_active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(application_type IS NULL OR application_type IN ('PB','PD'))
);
CREATE INDEX idx_workflow_rules_match ON document_workflow_rules(category_id,application_type,workflow_stage,is_active,priority);
-- Prevent duplicate active rules for the same matching key within one template.
CREATE UNIQUE INDEX uq_workflow_rule_active_key ON document_workflow_rules
 (template_id,category_id,COALESCE(application_type,''),workflow_stage,COALESCE(condition_key,''))
 WHERE is_active=true;
CREATE TABLE document_workflow_stages (
 id uuid PRIMARY KEY, template_id uuid NOT NULL REFERENCES document_workflow_templates(id) ON DELETE RESTRICT,
 stage_code varchar(60) NOT NULL, stage_name varchar(150) NOT NULL, sequence_number integer NOT NULL,
 stage_type varchar(20) NOT NULL, approval_mode varchar(20) NOT NULL DEFAULT 'SEQUENTIAL',
 is_required boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(template_id,stage_code), UNIQUE(template_id,sequence_number), UNIQUE(id,template_id),
 CHECK(sequence_number>0), CHECK(stage_type IN ('REVIEW','APPROVAL')),
 CHECK(approval_mode IN ('SEQUENTIAL','PARALLEL'))
);
CREATE TABLE document_workflow_stage_actors (
 id uuid PRIMARY KEY, stage_id uuid NOT NULL REFERENCES document_workflow_stages(id) ON DELETE RESTRICT,
 role_id bigint NOT NULL REFERENCES roles(id) ON DELETE RESTRICT, unit_scope varchar(10) NOT NULL,
 decision_required boolean NOT NULL DEFAULT true, minimum_approvals integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(stage_id,role_id,unit_scope), UNIQUE(id,stage_id),
 CHECK(unit_scope IN ('ULP','UP3','GLOBAL')), CHECK(minimum_approvals>0)
);
CREATE TABLE document_review_cycles (
 id uuid PRIMARY KEY, document_id uuid NOT NULL, document_version_id uuid NOT NULL,
 workflow_template_id uuid NOT NULL REFERENCES document_workflow_templates(id) ON DELETE RESTRICT,
 workflow_version integer NOT NULL, cycle_number integer NOT NULL, status varchar(24) NOT NULL DEFAULT 'PENDING',
 created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT, created_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz,
 FOREIGN KEY(document_id,document_version_id) REFERENCES application_document_versions(document_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(workflow_template_id,workflow_version) REFERENCES document_workflow_templates(id,version_number) ON DELETE RESTRICT,
 UNIQUE(document_id,document_version_id,cycle_number), UNIQUE(id,document_id,document_version_id),
 CHECK(cycle_number>0), CHECK(status IN ('PENDING','IN_PROGRESS','REVISION_REQUIRED','APPROVED','REJECTED','CANCELLED'))
);
CREATE INDEX idx_review_cycles_status ON document_review_cycles(status,created_at);
CREATE TABLE document_review_cycle_stages (
 id uuid PRIMARY KEY, review_cycle_id uuid NOT NULL REFERENCES document_review_cycles(id) ON DELETE RESTRICT,
 source_workflow_stage_id uuid REFERENCES document_workflow_stages(id) ON DELETE RESTRICT,
 stage_code varchar(60) NOT NULL, stage_name varchar(150) NOT NULL, sequence_number integer NOT NULL,
 stage_type varchar(20) NOT NULL, approval_mode varchar(20) NOT NULL, is_required boolean NOT NULL,
 status varchar(24) NOT NULL DEFAULT 'PENDING', started_at timestamptz, completed_at timestamptz,
 UNIQUE(review_cycle_id,sequence_number), UNIQUE(id,review_cycle_id),
 CHECK(sequence_number>0), CHECK(stage_type IN ('REVIEW','APPROVAL')),
 CHECK(approval_mode IN ('SEQUENTIAL','PARALLEL')),
 CHECK(status IN ('PENDING','IN_PROGRESS','REVISION_REQUIRED','APPROVED','REJECTED','SKIPPED'))
);
CREATE TABLE document_review_cycle_stage_actors (
 id uuid PRIMARY KEY, cycle_stage_id uuid NOT NULL REFERENCES document_review_cycle_stages(id) ON DELETE RESTRICT,
 source_stage_actor_id uuid REFERENCES document_workflow_stage_actors(id) ON DELETE RESTRICT,
 role_id bigint NOT NULL REFERENCES roles(id) ON DELETE RESTRICT, unit_scope varchar(10) NOT NULL,
 decision_required boolean NOT NULL, minimum_approvals integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(cycle_stage_id,role_id,unit_scope), UNIQUE(id,cycle_stage_id), UNIQUE(id,cycle_stage_id,role_id),
 CHECK(unit_scope IN ('ULP','UP3','GLOBAL')), CHECK(minimum_approvals>0)
);
CREATE TABLE document_review_assignments (
 id uuid PRIMARY KEY, review_cycle_stage_id uuid NOT NULL REFERENCES document_review_cycle_stages(id) ON DELETE RESTRICT,
 cycle_stage_actor_id uuid NOT NULL,
 reviewer_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 role_id bigint NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
 organizational_unit_id uuid REFERENCES organizational_units(id) ON DELETE RESTRICT,
 review_type varchar(20) NOT NULL, status varchar(24) NOT NULL DEFAULT 'PENDING',
 decision varchar(24), assigned_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz,
 decided_at timestamptz, notes text,
 UNIQUE(review_cycle_stage_id,reviewer_id),
 FOREIGN KEY(cycle_stage_actor_id,review_cycle_stage_id,role_id) REFERENCES document_review_cycle_stage_actors(id,cycle_stage_id,role_id) ON DELETE RESTRICT,
 CHECK(review_type IN ('REVIEW','APPROVAL')),
 CHECK(status IN ('PENDING','IN_PROGRESS','SUBMITTED','REVISION_REQUIRED','APPROVED','REJECTED','CANCELLED')),
 CHECK(decision IS NULL OR decision IN ('APPROVED','REVISION_REQUIRED','REJECTED'))
);
CREATE INDEX idx_review_assignments_reviewer_status ON document_review_assignments(reviewer_id,status);
CREATE INDEX idx_review_assignments_scope_status ON document_review_assignments(organizational_unit_id,status);
CREATE TABLE document_review_comments (
 id uuid PRIMARY KEY, assignment_id uuid NOT NULL REFERENCES document_review_assignments(id) ON DELETE RESTRICT,
 comment_type varchar(20) NOT NULL, comment_text text NOT NULL, source_locator jsonb,
 author_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(comment_type IN ('GENERAL','REVISION','APPROVAL'))
);
CREATE INDEX idx_review_comments_assignment ON document_review_comments(assignment_id,created_at);

CREATE TABLE auto_mto_packages (
 id uuid PRIMARY KEY, application_id uuid NOT NULL REFERENCES applications(id) ON DELETE RESTRICT,
 package_number varchar(80) NOT NULL, package_version integer NOT NULL, previous_package_id uuid,
 status varchar(24) NOT NULL DEFAULT 'DRAFT', created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 submitted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(application_id,package_number,package_version), UNIQUE(application_id,id), UNIQUE(id,application_id),
 FOREIGN KEY(application_id,previous_package_id) REFERENCES auto_mto_packages(application_id,id) ON DELETE RESTRICT,
 CHECK(package_version>0), CHECK(status IN ('DRAFT','PROCESSING','EXTRACTED','VERIFIED','PENDING_APPROVAL','APPROVED','REVISION_REQUIRED','REJECTED','SUPERSEDED'))
);
CREATE TABLE auto_mto_package_documents (
 id uuid PRIMARY KEY, package_id uuid NOT NULL, application_id uuid NOT NULL,
 document_id uuid NOT NULL, document_version_id uuid NOT NULL, document_role varchar(40) NOT NULL,
 sequence_number integer NOT NULL, is_primary boolean NOT NULL DEFAULT false,
 is_required boolean NOT NULL DEFAULT true, processing_priority integer NOT NULL DEFAULT 100,
 FOREIGN KEY(package_id,application_id) REFERENCES auto_mto_packages(id,application_id) ON DELETE RESTRICT,
 FOREIGN KEY(document_id,application_id) REFERENCES application_documents(id,application_id) ON DELETE RESTRICT,
 FOREIGN KEY(document_id,document_version_id) REFERENCES application_document_versions(document_id,id) ON DELETE RESTRICT,
 UNIQUE(package_id,document_id,document_version_id), UNIQUE(package_id,id,document_version_id),
 CHECK(sequence_number>0), CHECK(processing_priority>=0)
);
CREATE UNIQUE INDEX uq_mto_package_document_sequence ON auto_mto_package_documents(package_id,sequence_number);
CREATE UNIQUE INDEX uq_mto_package_primary_document ON auto_mto_package_documents(package_id) WHERE is_primary=true;
CREATE TABLE auto_mto_processing_jobs (
 id uuid PRIMARY KEY, package_id uuid NOT NULL REFERENCES auto_mto_packages(id) ON DELETE RESTRICT,
 job_reference varchar(100) NOT NULL UNIQUE, job_type varchar(20) NOT NULL, parent_job_id uuid REFERENCES auto_mto_processing_jobs(id) ON DELETE RESTRICT,
 engine_name varchar(100), status varchar(24) NOT NULL DEFAULT 'QUEUED', requested_by uuid REFERENCES users(id) ON DELETE RESTRICT,
 started_at timestamptz, completed_at timestamptz, error_summary text, metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,package_id),
 CHECK(job_type IN ('INITIAL','RETRY','REPROCESS')),
 CHECK(status IN ('QUEUED','PROCESSING','PARTIAL_SUCCESS','SUCCESS','FAILED','CANCELLED'))
);
CREATE TABLE auto_mto_processing_job_files (
 id uuid PRIMARY KEY, processing_job_id uuid NOT NULL, package_id uuid NOT NULL,
 package_document_id uuid NOT NULL, document_version_id uuid NOT NULL,
 checksum char(64) NOT NULL, processing_status varchar(24) NOT NULL DEFAULT 'QUEUED',
 attempt_count integer NOT NULL DEFAULT 0, started_at timestamptz, completed_at timestamptz, error_summary text,
 FOREIGN KEY(processing_job_id,package_id) REFERENCES auto_mto_processing_jobs(id,package_id) ON DELETE RESTRICT,
 FOREIGN KEY(package_id,package_document_id,document_version_id) REFERENCES auto_mto_package_documents(package_id,id,document_version_id) ON DELETE RESTRICT,
 UNIQUE(processing_job_id,package_document_id), UNIQUE(id,processing_job_id),
 CHECK(attempt_count>=0), CHECK(processing_status IN ('QUEUED','PROCESSING','SUCCESS','FAILED','RETRY','SKIPPED'))
);
CREATE INDEX idx_mto_job_files_status ON auto_mto_processing_job_files(processing_job_id,processing_status);
CREATE TABLE auto_mto_processing_file_attempts (
 id uuid PRIMARY KEY, job_file_id uuid NOT NULL REFERENCES auto_mto_processing_job_files(id) ON DELETE RESTRICT,
 attempt_number integer NOT NULL, status varchar(20) NOT NULL, started_at timestamptz, completed_at timestamptz,
 error_code varchar(80), error_message text, input_checksum char(64), output_checksum char(64),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(job_file_id,attempt_number), UNIQUE(id,job_file_id),
 CHECK(attempt_number>0), CHECK(status IN ('RUNNING','SUCCESS','FAILED','TIMEOUT','CANCELLED'))
);
CREATE TABLE auto_mto_file_access_tokens (
 id uuid PRIMARY KEY, processing_job_id uuid NOT NULL, job_file_id uuid NOT NULL, processing_file_attempt_id uuid NOT NULL,
 token_hash char(64) NOT NULL UNIQUE, access_type varchar(20) NOT NULL DEFAULT 'DOWNLOAD',
 expires_at timestamptz NOT NULL, revoked_at timestamptz, used_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(job_file_id,processing_job_id) REFERENCES auto_mto_processing_job_files(id,processing_job_id) ON DELETE RESTRICT,
 FOREIGN KEY(processing_file_attempt_id,job_file_id) REFERENCES auto_mto_processing_file_attempts(id,job_file_id) ON DELETE RESTRICT,
 CHECK(access_type='DOWNLOAD'), CHECK(expires_at>created_at)
);
CREATE INDEX idx_mto_tokens_expiry ON auto_mto_file_access_tokens(expires_at) WHERE revoked_at IS NULL;
CREATE TABLE auto_mto_processing_results (
 id uuid PRIMARY KEY, processing_file_attempt_id uuid NOT NULL UNIQUE REFERENCES auto_mto_processing_file_attempts(id) ON DELETE RESTRICT,
 result_reference varchar(255), checksum char(64), engine_name varchar(100) NOT NULL,
 result_status varchar(20) NOT NULL, metadata jsonb NOT NULL DEFAULT '{}'::jsonb, received_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,processing_file_attempt_id), CHECK(result_status IN ('SUCCESS','PARTIAL','FAILED'))
);
CREATE TABLE auto_mto_extractions (
 id uuid PRIMARY KEY, package_id uuid NOT NULL REFERENCES auto_mto_packages(id) ON DELETE RESTRICT,
 processing_result_id uuid NOT NULL, processing_file_attempt_id uuid NOT NULL,
 extraction_type varchar(40) NOT NULL, source_locator jsonb NOT NULL,
 detected_code varchar(100), detected_name text, detected_quantity numeric(24,9), detected_unit_text varchar(40),
 confidence numeric(6,5), raw_result jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(package_id,id),
 FOREIGN KEY(processing_result_id,processing_file_attempt_id) REFERENCES auto_mto_processing_results(id,processing_file_attempt_id) ON DELETE RESTRICT,
 CHECK(detected_quantity IS NULL OR detected_quantity>=0), CHECK(confidence IS NULL OR confidence BETWEEN 0 AND 1)
);
CREATE INDEX idx_mto_extractions_result ON auto_mto_extractions(processing_result_id);
CREATE INDEX idx_mto_extractions_package ON auto_mto_extractions(package_id);
CREATE TABLE auto_mto_items (
 id uuid PRIMARY KEY, package_id uuid NOT NULL REFERENCES auto_mto_packages(id) ON DELETE RESTRICT,
 khs_id uuid REFERENCES khs_items(id) ON DELETE RESTRICT, khs_item_version_id uuid REFERENCES khs_item_versions(id) ON DELETE RESTRICT,
 khs_code_snapshot varchar(80), description_snapshot text NOT NULL,
 installation_type varchar(10) NOT NULL, detected_quantity numeric(24,9), verified_quantity numeric(24,9),
 detected_unit_id uuid REFERENCES units_of_measure(id) ON DELETE RESTRICT,
 verified_unit_id uuid REFERENCES units_of_measure(id) ON DELETE RESTRICT,
 calculation_source varchar(10) NOT NULL DEFAULT 'AUTO', verification_status varchar(24) NOT NULL DEFAULT 'PENDING',
 item_status varchar(20) NOT NULL DEFAULT 'ACTIVE', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(package_id,id), CHECK(installation_type IN ('PSG','BKR')),
 CHECK(detected_quantity IS NULL OR detected_quantity>=0), CHECK(verified_quantity IS NULL OR verified_quantity>=0),
 CHECK(calculation_source IN ('AUTO','MANUAL')),
 CHECK(verification_status IN ('PENDING','VERIFIED','REVISION_REQUIRED','REJECTED')),
 CHECK(item_status IN ('ACTIVE','REMOVED')),
 CHECK((khs_id IS NULL AND khs_item_version_id IS NULL) OR (khs_id IS NOT NULL AND khs_item_version_id IS NOT NULL))
);
CREATE INDEX idx_mto_items_package_status ON auto_mto_items(package_id,verification_status,item_status);
CREATE TABLE auto_mto_item_sources (
 id uuid PRIMARY KEY, package_id uuid NOT NULL, mto_item_id uuid NOT NULL,
 extraction_id uuid NOT NULL,
 source_role varchar(20) NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(package_id,mto_item_id) REFERENCES auto_mto_items(package_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(package_id,extraction_id) REFERENCES auto_mto_extractions(package_id,id) ON DELETE RESTRICT,
 UNIQUE(mto_item_id,extraction_id), CHECK(source_role IN ('PRIMARY','SUPPORTING','CONFLICT'))
);
CREATE TABLE auto_mto_item_revisions (
 id uuid PRIMARY KEY, mto_item_id uuid NOT NULL REFERENCES auto_mto_items(id) ON DELETE RESTRICT,
 revision_number integer NOT NULL, change_type varchar(10) NOT NULL, before_data jsonb, after_data jsonb,
 correction_reason text NOT NULL, changed_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 changed_at timestamptz NOT NULL DEFAULT now(), UNIQUE(mto_item_id,revision_number),
 CHECK(revision_number>0), CHECK(change_type IN ('ADD','UPDATE','REMOVE'))
);
CREATE TABLE auto_mto_material_requirements (
 id uuid PRIMARY KEY, package_id uuid NOT NULL, mto_item_id uuid NOT NULL,
 material_id uuid NOT NULL REFERENCES materials(id) ON DELETE RESTRICT,
 bom_version_id uuid NOT NULL REFERENCES bom_headers(id) ON DELETE RESTRICT,
 bom_item_id uuid NOT NULL REFERENCES bom_items(id) ON DELETE RESTRICT,
 formula_definition_id uuid REFERENCES bom_formula_definitions(id) ON DELETE RESTRICT,
 formula_snapshot jsonb NOT NULL, base_quantity numeric(24,9) NOT NULL,
 calculated_quantity numeric(24,9), verified_quantity numeric(24,9), unit_id uuid NOT NULL REFERENCES units_of_measure(id) ON DELETE RESTRICT,
 calculation_status varchar(24) NOT NULL, verification_status varchar(24) NOT NULL DEFAULT 'PENDING',
 item_status varchar(20) NOT NULL DEFAULT 'ACTIVE', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(package_id,mto_item_id) REFERENCES auto_mto_items(package_id,id) ON DELETE RESTRICT,
 UNIQUE(package_id,id), CHECK(base_quantity>=0), CHECK(calculated_quantity IS NULL OR calculated_quantity>=0),
 CHECK(verified_quantity IS NULL OR verified_quantity>=0),
 CHECK(calculation_status IN ('PENDING','CALCULATED','ERROR','MANUAL')),
 CHECK(verification_status IN ('PENDING','VERIFIED','REVISION_REQUIRED','REJECTED')),
 CHECK(item_status IN ('ACTIVE','REMOVED'))
);
CREATE INDEX idx_mto_material_req_package ON auto_mto_material_requirements(package_id,verification_status,item_status);
CREATE TABLE auto_mto_material_requirement_revisions (
 id uuid PRIMARY KEY, material_requirement_id uuid NOT NULL REFERENCES auto_mto_material_requirements(id) ON DELETE RESTRICT,
 revision_number integer NOT NULL, change_type varchar(10) NOT NULL, before_data jsonb, after_data jsonb,
 reason text NOT NULL, changed_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 changed_at timestamptz NOT NULL DEFAULT now(), UNIQUE(material_requirement_id,revision_number),
 CHECK(revision_number>0), CHECK(change_type IN ('ADD','UPDATE','REMOVE'))
);
CREATE TABLE auto_mto_verifications (
 id uuid PRIMARY KEY, package_id uuid NOT NULL REFERENCES auto_mto_packages(id) ON DELETE RESTRICT,
 mto_item_id uuid, material_requirement_id uuid,
 verifier_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 decision varchar(24) NOT NULL, notes text, verified_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(package_id,mto_item_id) REFERENCES auto_mto_items(package_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(package_id,material_requirement_id) REFERENCES auto_mto_material_requirements(package_id,id) ON DELETE RESTRICT,
 CHECK ((CASE WHEN mto_item_id IS NOT NULL THEN 1 ELSE 0 END) + (CASE WHEN material_requirement_id IS NOT NULL THEN 1 ELSE 0 END) = 1),
 CHECK(decision IN ('VERIFIED','REVISION_REQUIRED','REJECTED'))
);
CREATE TABLE auto_mto_package_snapshots (
 id uuid PRIMARY KEY, package_id uuid NOT NULL REFERENCES auto_mto_packages(id) ON DELETE RESTRICT,
 snapshot_number integer NOT NULL, snapshot_type varchar(20) NOT NULL, snapshot_data jsonb NOT NULL,
 snapshot_hash char(64) NOT NULL, created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(package_id,snapshot_number), UNIQUE(package_id,id),
 CHECK(snapshot_number>0), CHECK(snapshot_type IN ('VERIFIED','APPROVAL')),
 CHECK(snapshot_hash ~ '^[0-9a-fA-F]{64}$')
);
CREATE TABLE auto_mto_approval_histories (
 id uuid PRIMARY KEY, package_id uuid NOT NULL, snapshot_id uuid NOT NULL,
 approver_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 role_id bigint NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
 organizational_unit_id uuid NOT NULL REFERENCES organizational_units(id) ON DELETE RESTRICT,
 decision varchar(24) NOT NULL, notes text, decided_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(package_id,snapshot_id) REFERENCES auto_mto_package_snapshots(package_id,id) ON DELETE RESTRICT,
 CHECK(decision IN ('APPROVED','REVISION_REQUIRED','REJECTED'))
);
CREATE INDEX idx_mto_approval_package_time ON auto_mto_approval_histories(package_id,decided_at DESC);

-- Cross-row consistency triggers: references that require checking attributes on parent rows.
CREATE OR REPLACE FUNCTION distriva_validate_document_version_chain() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.previous_version_id IS NOT NULL AND NOT EXISTS (
   SELECT 1 FROM application_document_versions v WHERE v.id=NEW.previous_version_id AND v.document_id=NEW.document_id
 ) THEN RAISE EXCEPTION 'previous_version_id must belong to the same document'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_document_version_chain BEFORE INSERT OR UPDATE OF document_id,previous_version_id
 ON application_document_versions FOR EACH ROW EXECUTE FUNCTION distriva_validate_document_version_chain();

CREATE OR REPLACE FUNCTION distriva_validate_mto_khs_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.khs_item_version_id IS NOT NULL AND NOT EXISTS (
   SELECT 1 FROM khs_item_versions v WHERE v.id=NEW.khs_item_version_id AND v.khs_item_id=NEW.khs_id
 ) THEN RAISE EXCEPTION 'KHS version does not belong to khs_id'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_mto_khs_version BEFORE INSERT OR UPDATE OF khs_id,khs_item_version_id
 ON auto_mto_items FOR EACH ROW EXECUTE FUNCTION distriva_validate_mto_khs_version();

CREATE OR REPLACE FUNCTION distriva_validate_mto_bom_item() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b_item record;
BEGIN
 SELECT bi.bom_header_id,bi.material_id,bi.formula_definition_id INTO b_item
 FROM bom_items bi WHERE bi.id=NEW.bom_item_id;
 IF NOT FOUND OR b_item.bom_header_id<>NEW.bom_version_id OR b_item.material_id<>NEW.material_id THEN
   RAISE EXCEPTION 'BOM item/header/material mismatch in Auto MTO requirement';
 END IF;
 IF NEW.formula_definition_id IS DISTINCT FROM b_item.formula_definition_id THEN
   RAISE EXCEPTION 'Formula definition mismatch with BOM item';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_mto_bom_item BEFORE INSERT OR UPDATE OF bom_version_id,bom_item_id,material_id,formula_definition_id
 ON auto_mto_material_requirements FOR EACH ROW EXECUTE FUNCTION distriva_validate_mto_bom_item();

-- Validate copied actor rules and extraction lineage against their source records.
CREATE OR REPLACE FUNCTION distriva_validate_cycle_actor_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_stage_id uuid; cycle_source_stage_id uuid;
BEGIN
 IF NEW.source_stage_actor_id IS NULL THEN RETURN NEW; END IF;
 SELECT source_workflow_stage_id INTO cycle_source_stage_id
 FROM document_review_cycle_stages WHERE id=NEW.cycle_stage_id;
 SELECT stage_id INTO source_stage_id FROM document_workflow_stage_actors
 WHERE id=NEW.source_stage_actor_id
   AND role_id=NEW.role_id AND unit_scope=NEW.unit_scope
   AND decision_required=NEW.decision_required
   AND minimum_approvals=NEW.minimum_approvals;
 IF cycle_source_stage_id IS NULL OR source_stage_id IS DISTINCT FROM cycle_source_stage_id THEN
   RAISE EXCEPTION 'Cycle actor snapshot must match the source stage, role, scope and approval rule';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_cycle_actor_source BEFORE INSERT OR UPDATE OF cycle_stage_id,source_stage_actor_id
 ON document_review_cycle_stage_actors FOR EACH ROW EXECUTE FUNCTION distriva_validate_cycle_actor_source();

CREATE OR REPLACE FUNCTION distriva_validate_extraction_package() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actual_package_id uuid;
BEGIN
 SELECT jf.package_id INTO actual_package_id
 FROM auto_mto_processing_results r
 JOIN auto_mto_processing_file_attempts a ON a.id=r.processing_file_attempt_id
 JOIN auto_mto_processing_job_files jf ON jf.id=a.job_file_id
 WHERE r.id=NEW.processing_result_id AND r.processing_file_attempt_id=NEW.processing_file_attempt_id;
 IF actual_package_id IS NULL OR actual_package_id<>NEW.package_id THEN
   RAISE EXCEPTION 'Extraction package must match processing result attempt package';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_extraction_package BEFORE INSERT OR UPDATE OF package_id,processing_result_id,processing_file_attempt_id
 ON auto_mto_extractions FOR EACH ROW EXECUTE FUNCTION distriva_validate_extraction_package();

-- Immutability: application-level DB role should not own tables. This trigger blocks edits/deletes of version payload.
CREATE OR REPLACE FUNCTION distriva_reject_document_version_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Document versions are immutable'; END IF;
 IF (to_jsonb(NEW)-'lifecycle_status') IS DISTINCT FROM (to_jsonb(OLD)-'lifecycle_status') THEN
   RAISE EXCEPTION 'Document version content is immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_document_version_immutable BEFORE UPDATE OR DELETE ON application_document_versions
 FOR EACH ROW EXECUTE FUNCTION distriva_reject_document_version_mutation();

-- NOTE: snapshot, approval, access/audit immutability and cross-table workflow actor authorization
-- must additionally be enforced with restricted DB privileges and Laravel transaction/policy checks.
-- Do not treat this design script as production-ready until the test matrix in document 27 passes.

-- Immutable approval/snapshot records. Corrections are appended as new records/versions.
CREATE OR REPLACE FUNCTION distriva_reject_row_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION '% rows are append-only; create a new version or history record', TG_TABLE_NAME;
END $$;
CREATE TRIGGER trg_mto_snapshot_immutable BEFORE UPDATE OR DELETE ON auto_mto_package_snapshots
 FOR EACH ROW EXECUTE FUNCTION distriva_reject_row_mutation();
CREATE TRIGGER trg_mto_approval_history_immutable BEFORE UPDATE OR DELETE ON auto_mto_approval_histories
 FOR EACH ROW EXECUTE FUNCTION distriva_reject_row_mutation();
CREATE TRIGGER trg_document_cycle_actor_snapshot_immutable BEFORE UPDATE OR DELETE ON document_review_cycle_stage_actors
 FOR EACH ROW EXECUTE FUNCTION distriva_reject_row_mutation();

-- A source stage attached to a review cycle must belong to the template snapshotted by that cycle.
CREATE OR REPLACE FUNCTION distriva_validate_review_source_stage() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cycle_template_id uuid;
BEGIN
 IF NEW.source_workflow_stage_id IS NULL THEN RETURN NEW; END IF;
 SELECT workflow_template_id INTO cycle_template_id FROM document_review_cycles WHERE id=NEW.review_cycle_id;
 IF NOT EXISTS (
   SELECT 1 FROM document_workflow_stages s
   WHERE s.id=NEW.source_workflow_stage_id AND s.template_id=cycle_template_id
 ) THEN RAISE EXCEPTION 'Review stage source must belong to the cycle workflow template'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_review_source_stage BEFORE INSERT OR UPDATE OF review_cycle_id,source_workflow_stage_id
 ON document_review_cycle_stages FOR EACH ROW EXECUTE FUNCTION distriva_validate_review_source_stage();
