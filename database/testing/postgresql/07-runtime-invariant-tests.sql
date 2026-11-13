CREATE TEMP TABLE runtime_test_results (
  test_name text PRIMARY KEY,
  status text NOT NULL,
  expected_sqlstate text NOT NULL,
  actual_sqlstate text,
  message text
);

CREATE FUNCTION pg_temp.expect_rejected(test_name text, statement text, expected_sqlstate text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  actual_sqlstate text;
  actual_message text;
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS
      actual_sqlstate = RETURNED_SQLSTATE,
      actual_message = MESSAGE_TEXT;
    IF actual_sqlstate = expected_sqlstate THEN
      INSERT INTO runtime_test_results
        VALUES (test_name, 'PASS', expected_sqlstate, actual_sqlstate, actual_message);
      RETURN;
    END IF;
    INSERT INTO runtime_test_results
      VALUES (test_name, 'FAIL', expected_sqlstate, actual_sqlstate, actual_message);
    RAISE EXCEPTION 'Test % expected SQLSTATE %, got %: %',
      test_name, expected_sqlstate, actual_sqlstate, actual_message;
  END;
  INSERT INTO runtime_test_results
    VALUES (test_name, 'FAIL', expected_sqlstate, '00000', 'Statement was accepted');
  RAISE EXCEPTION 'Test % expected SQLSTATE %, but statement was accepted',
    test_name, expected_sqlstate;
END;
$$;

INSERT INTO material_categories(id,code,name) VALUES
('10000000-0000-4000-8000-000000000011','FIXTURE_TEST_2','Fixture Test Category 2');

INSERT INTO materials(id,category_id,code,name,unit) VALUES
('10000000-0000-4000-8000-000000000012',
 '10000000-0000-4000-8000-000000000011',
 'FIXTURE-SKU-002','Fixture Material 2','u');

INSERT INTO khs_items(id,code) VALUES
('10000000-0000-4000-8000-000000000013','FIXTURE-KHS-002');

INSERT INTO khs_item_versions(
 id,khs_item_id,version_number,name,unit_id,valid_from,status
) VALUES (
 '10000000-0000-4000-8000-000000000014',
 '10000000-0000-4000-8000-000000000013',
 1,'Fixture KHS Version 2',
 '10000000-0000-4000-8000-000000000002',
 DATE '2026-01-01','APPROVED'
);

INSERT INTO applications(
 id,application_number,application_type,transaction_type,customer_id,
 organizational_unit_id,source_type,service_address,current_status
) VALUES (
 '50000000-0000-4000-8000-000000000002','FIX-APP-002','PB','PASANG BARU',
 '40000000-0000-4000-8000-000000000001',
 '30000000-0000-4000-8000-000000000002','MANUAL',
 'Fixture address 2','DRAFT'
);

INSERT INTO document_categories(id,code,name) VALUES
('60000000-0000-4000-8000-000000000001','FIXTURE_DRAWING','Fixture Drawing');

INSERT INTO document_storage_locations(id,storage_name,storage_type,root_path) VALUES
('60000000-0000-4000-8000-000000000002','fixture-private','LOCAL_PRIVATE','/private/fixture');

INSERT INTO application_documents(
 id,application_id,category_id,document_code,title,created_by
) VALUES
('70000000-0000-4000-8000-000000000001',
 '50000000-0000-4000-8000-000000000001',
 '60000000-0000-4000-8000-000000000001','FIX-DOC-001','Fixture Document 1',
 '20000000-0000-4000-8000-000000000001'),
('70000000-0000-4000-8000-000000000002',
 '50000000-0000-4000-8000-000000000002',
 '60000000-0000-4000-8000-000000000001','FIX-DOC-002','Fixture Document 2',
 '20000000-0000-4000-8000-000000000001'),
('70000000-0000-4000-8000-000000000003',
 '50000000-0000-4000-8000-000000000001',
 '60000000-0000-4000-8000-000000000001','FIX-DOC-003','Fixture Document 3',
 '20000000-0000-4000-8000-000000000001');

INSERT INTO application_document_versions(
 id,document_id,version_number,previous_version_id,original_filename,stored_filename,
 storage_location_id,storage_key,mime_type,file_extension,file_size_bytes,sha256,uploaded_by
) VALUES
('71000000-0000-4000-8000-000000000001',
 '70000000-0000-4000-8000-000000000001',1,NULL,'drawing-v1.pdf','drawing-v1.pdf',
 '60000000-0000-4000-8000-000000000002','fixture/doc1/v1','application/pdf','pdf',100,
 repeat('1',64),'20000000-0000-4000-8000-000000000001'),
('71000000-0000-4000-8000-000000000002',
 '70000000-0000-4000-8000-000000000001',2,'71000000-0000-4000-8000-000000000001',
 'drawing-v2.pdf','drawing-v2.pdf','60000000-0000-4000-8000-000000000002',
 'fixture/doc1/v2','application/pdf','pdf',120,repeat('2',64),
 '20000000-0000-4000-8000-000000000001'),
('71000000-0000-4000-8000-000000000003',
 '70000000-0000-4000-8000-000000000002',1,NULL,'drawing-v1.pdf','drawing-app2-v1.pdf',
 '60000000-0000-4000-8000-000000000002','fixture/doc2/v1','application/pdf','pdf',100,
 repeat('3',64),'20000000-0000-4000-8000-000000000001'),
('71000000-0000-4000-8000-000000000004',
 '70000000-0000-4000-8000-000000000003',1,NULL,'support.pdf','support.pdf',
 '60000000-0000-4000-8000-000000000002','fixture/doc3/v1','application/pdf','pdf',80,
 repeat('4',64),'20000000-0000-4000-8000-000000000001');

UPDATE application_documents SET current_version_id='71000000-0000-4000-8000-000000000002'
WHERE id='70000000-0000-4000-8000-000000000001';
UPDATE application_documents SET current_version_id='71000000-0000-4000-8000-000000000003'
WHERE id='70000000-0000-4000-8000-000000000002';
UPDATE application_documents SET current_version_id='71000000-0000-4000-8000-000000000004'
WHERE id='70000000-0000-4000-8000-000000000003';

INSERT INTO document_workflow_templates(id,code,version_number,status,created_by) VALUES
('72000000-0000-4000-8000-000000000001','FIXTURE_WORKFLOW',1,'ACTIVE',
 '20000000-0000-4000-8000-000000000001'),
('72000000-0000-4000-8000-000000000002','FIXTURE_WORKFLOW_OTHER',1,'ACTIVE',
 '20000000-0000-4000-8000-000000000001');

INSERT INTO document_workflow_rules(
 id,template_id,category_id,application_type,workflow_stage,condition_key
) VALUES (
 '72000000-0000-4000-8000-000000000003',
 '72000000-0000-4000-8000-000000000001',
 '60000000-0000-4000-8000-000000000001','PB','DRAWING','FIXTURE'
);

INSERT INTO document_workflow_stages(
 id,template_id,stage_code,stage_name,sequence_number,stage_type,approval_mode
) VALUES
('73000000-0000-4000-8000-000000000001',
 '72000000-0000-4000-8000-000000000001','REVIEW','Review',1,'REVIEW','SEQUENTIAL'),
('73000000-0000-4000-8000-000000000002',
 '72000000-0000-4000-8000-000000000002','REVIEW','Other Review',1,'REVIEW','SEQUENTIAL');

INSERT INTO document_workflow_stage_actors(
 id,stage_id,role_id,unit_scope,decision_required,minimum_approvals
) VALUES
('74000000-0000-4000-8000-000000000001',
 '73000000-0000-4000-8000-000000000001',9004,'UP3',true,1),
('74000000-0000-4000-8000-000000000002',
 '73000000-0000-4000-8000-000000000002',9004,'UP3',true,1);

INSERT INTO document_review_cycles(
 id,document_id,document_version_id,workflow_template_id,workflow_version,
 cycle_number,created_by
) VALUES (
 '75000000-0000-4000-8000-000000000001',
 '70000000-0000-4000-8000-000000000001',
 '71000000-0000-4000-8000-000000000002',
 '72000000-0000-4000-8000-000000000001',1,1,
 '20000000-0000-4000-8000-000000000001'
);

INSERT INTO document_review_cycle_stages(
 id,review_cycle_id,source_workflow_stage_id,stage_code,stage_name,sequence_number,
 stage_type,approval_mode,is_required
) VALUES (
 '76000000-0000-4000-8000-000000000001',
 '75000000-0000-4000-8000-000000000001',
 '73000000-0000-4000-8000-000000000001',
 'REVIEW','Review',1,'REVIEW','SEQUENTIAL',true
);

INSERT INTO document_review_cycle_stage_actors(
 id,cycle_stage_id,source_stage_actor_id,role_id,unit_scope,decision_required,minimum_approvals
) VALUES (
 '77000000-0000-4000-8000-000000000001',
 '76000000-0000-4000-8000-000000000001',
 '74000000-0000-4000-8000-000000000001',9004,'UP3',true,1
);

INSERT INTO document_review_assignments(
 id,review_cycle_stage_id,cycle_stage_actor_id,reviewer_id,role_id,organizational_unit_id,
 review_type
) VALUES (
 '78000000-0000-4000-8000-000000000001',
 '76000000-0000-4000-8000-000000000001',
 '77000000-0000-4000-8000-000000000001',
 '20000000-0000-4000-8000-000000000002',9004,
 '30000000-0000-4000-8000-000000000001','REVIEW'
);

INSERT INTO auto_mto_packages(
 id,application_id,package_number,package_version,status,created_by
) VALUES
('80000000-0000-4000-8000-000000000001',
 '50000000-0000-4000-8000-000000000001','FIXTURE-PACKAGE-1',1,'PROCESSING',
 '20000000-0000-4000-8000-000000000001'),
('80000000-0000-4000-8000-000000000002',
 '50000000-0000-4000-8000-000000000002','FIXTURE-PACKAGE-2',1,'PROCESSING',
 '20000000-0000-4000-8000-000000000001');

INSERT INTO auto_mto_package_documents(
 id,package_id,application_id,document_id,document_version_id,document_role,sequence_number,is_primary
) VALUES
('81000000-0000-4000-8000-000000000001',
 '80000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001',
 '70000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000002',
 'DRAWING',1,true),
('81000000-0000-4000-8000-000000000002',
 '80000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001',
 '70000000-0000-4000-8000-000000000003','71000000-0000-4000-8000-000000000004',
 'SUPPORTING',2,false),
('81000000-0000-4000-8000-000000000003',
 '80000000-0000-4000-8000-000000000002','50000000-0000-4000-8000-000000000002',
 '70000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000003',
 'DRAWING',1,true);

INSERT INTO auto_mto_processing_jobs(id,package_id,job_reference,job_type,engine_name,requested_by) VALUES
('82000000-0000-4000-8000-000000000001',
 '80000000-0000-4000-8000-000000000001','FIXTURE-JOB-1','INITIAL','TEST','20000000-0000-4000-8000-000000000001'),
('82000000-0000-4000-8000-000000000002',
 '80000000-0000-4000-8000-000000000002','FIXTURE-JOB-2','INITIAL','TEST','20000000-0000-4000-8000-000000000001'),
('82000000-0000-4000-8000-000000000003',
 '80000000-0000-4000-8000-000000000001','FIXTURE-JOB-3','INITIAL','TEST','20000000-0000-4000-8000-000000000001');

INSERT INTO auto_mto_processing_job_files(
 id,processing_job_id,package_id,package_document_id,document_version_id,checksum
) VALUES
('83000000-0000-4000-8000-000000000001',
 '82000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001',
 '81000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000002',repeat('a',64)),
('83000000-0000-4000-8000-000000000002',
 '82000000-0000-4000-8000-000000000002','80000000-0000-4000-8000-000000000002',
 '81000000-0000-4000-8000-000000000003','71000000-0000-4000-8000-000000000003',repeat('b',64)),
('83000000-0000-4000-8000-000000000003',
 '82000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001',
 '81000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000004',repeat('c',64));

INSERT INTO auto_mto_processing_file_attempts(id,job_file_id,attempt_number,status) VALUES
('84000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001',1,'SUCCESS'),
('84000000-0000-4000-8000-000000000002','83000000-0000-4000-8000-000000000002',1,'SUCCESS'),
('84000000-0000-4000-8000-000000000003','83000000-0000-4000-8000-000000000003',1,'FAILED');

INSERT INTO auto_mto_file_access_tokens(
 id,processing_job_id,job_file_id,processing_file_attempt_id,token_hash,expires_at
) VALUES (
 '85000000-0000-4000-8000-000000000001',
 '82000000-0000-4000-8000-000000000001',
 '83000000-0000-4000-8000-000000000001',
 '84000000-0000-4000-8000-000000000001',repeat('d',64),now()+interval '1 hour'
);

INSERT INTO auto_mto_processing_results(
 id,processing_file_attempt_id,engine_name,result_status
) VALUES
('86000000-0000-4000-8000-000000000001','84000000-0000-4000-8000-000000000001','TEST','SUCCESS'),
('86000000-0000-4000-8000-000000000002','84000000-0000-4000-8000-000000000002','TEST','PARTIAL'),
('86000000-0000-4000-8000-000000000003','84000000-0000-4000-8000-000000000003','TEST','FAILED');

INSERT INTO auto_mto_extractions(
 id,package_id,processing_result_id,processing_file_attempt_id,extraction_type,source_locator,
 detected_code,detected_quantity,detected_unit_text,confidence
) VALUES
('87000000-0000-4000-8000-000000000001',
 '80000000-0000-4000-8000-000000000001',
 '86000000-0000-4000-8000-000000000001',
 '84000000-0000-4000-8000-000000000001','TABLE_ROW','{}','FIXTURE-KHS-001',1,'u',0.95),
('87000000-0000-4000-8000-000000000002',
 '80000000-0000-4000-8000-000000000002',
 '86000000-0000-4000-8000-000000000002',
 '84000000-0000-4000-8000-000000000002','TABLE_ROW','{}','FIXTURE-KHS-001',1,'u',0.90);

INSERT INTO auto_mto_items(
 id,package_id,khs_id,khs_item_version_id,khs_code_snapshot,description_snapshot,
 installation_type,detected_quantity,verified_quantity,detected_unit_id,verified_unit_id,
 verification_status
) VALUES
('88000000-0000-4000-8000-000000000001',
 '80000000-0000-4000-8000-000000000001',
 '10000000-0000-4000-8000-000000000004',
 '10000000-0000-4000-8000-000000000005','FIXTURE-KHS-001','Fixture MTO Item',
 'PSG',1,1,'10000000-0000-4000-8000-000000000002',
 '10000000-0000-4000-8000-000000000002','VERIFIED'),
('88000000-0000-4000-8000-000000000002',
 '80000000-0000-4000-8000-000000000002',
 '10000000-0000-4000-8000-000000000004',
 '10000000-0000-4000-8000-000000000005','FIXTURE-KHS-001','Fixture MTO Item 2',
 'BKR',1,1,'10000000-0000-4000-8000-000000000002',
 '10000000-0000-4000-8000-000000000002','VERIFIED');

INSERT INTO auto_mto_item_sources(package_id,mto_item_id,extraction_id,id,source_role) VALUES
('80000000-0000-4000-8000-000000000001',
 '88000000-0000-4000-8000-000000000001',
 '87000000-0000-4000-8000-000000000001',
 '89000000-0000-4000-8000-000000000001','PRIMARY');

INSERT INTO auto_mto_material_requirements(
 id,package_id,mto_item_id,material_id,bom_version_id,bom_item_id,formula_snapshot,
 base_quantity,calculated_quantity,verified_quantity,unit_id,calculation_status,verification_status
) VALUES (
 '89000000-0000-4000-8000-000000000002',
 '80000000-0000-4000-8000-000000000001',
 '88000000-0000-4000-8000-000000000001',
 '10000000-0000-4000-8000-000000000003',
 '10000000-0000-4000-8000-000000000008',
 '10000000-0000-4000-8000-000000000009',
 '{"method":"FIXED"}',1,1,1,'10000000-0000-4000-8000-000000000002',
 'CALCULATED','VERIFIED'
);

INSERT INTO auto_mto_verifications(
 id,package_id,mto_item_id,verifier_id,decision
) VALUES (
 '89000000-0000-4000-8000-000000000003',
 '80000000-0000-4000-8000-000000000001',
 '88000000-0000-4000-8000-000000000001',
 '20000000-0000-4000-8000-000000000002','VERIFIED'
);

INSERT INTO auto_mto_package_snapshots(
 id,package_id,snapshot_number,snapshot_type,snapshot_data,snapshot_hash,created_by
) VALUES
('90000000-0000-4000-8000-000000000001',
 '80000000-0000-4000-8000-000000000001',1,'APPROVAL','{}',repeat('e',64),
 '20000000-0000-4000-8000-000000000001'),
('90000000-0000-4000-8000-000000000002',
 '80000000-0000-4000-8000-000000000002',1,'APPROVAL','{}',repeat('f',64),
 '20000000-0000-4000-8000-000000000001');

INSERT INTO auto_mto_approval_histories(
 id,package_id,snapshot_id,approver_id,role_id,organizational_unit_id,decision
) VALUES (
 '91000000-0000-4000-8000-000000000001',
 '80000000-0000-4000-8000-000000000001',
 '90000000-0000-4000-8000-000000000001',
 '20000000-0000-4000-8000-000000000002',9002,
 '30000000-0000-4000-8000-000000000002','APPROVED'
);

SET CONSTRAINTS fk_application_documents_current_version IMMEDIATE;

SELECT pg_temp.expect_rejected(
 '01 current pointer from another document',
 'UPDATE application_documents SET current_version_id = ''71000000-0000-4000-8000-000000000003'' WHERE id = ''70000000-0000-4000-8000-000000000001''',
 '23503'
);
SELECT pg_temp.expect_rejected(
 '02 previous version from another document',
 'INSERT INTO application_document_versions(id,document_id,version_number,previous_version_id,original_filename,stored_filename,storage_location_id,storage_key,mime_type,file_extension,file_size_bytes,sha256,uploaded_by) VALUES (''71000000-0000-4000-8000-000000000005'',''70000000-0000-4000-8000-000000000001'',3,''71000000-0000-4000-8000-000000000003'',''bad.pdf'',''bad.pdf'',''60000000-0000-4000-8000-000000000002'',''fixture/bad'',''application/pdf'',''pdf'',10,repeat(''5'',64),''20000000-0000-4000-8000-000000000001'')',
 'P0001'
);
SELECT pg_temp.expect_rejected(
 '03 package document from another application',
 'INSERT INTO auto_mto_package_documents(id,package_id,application_id,document_id,document_version_id,document_role,sequence_number) VALUES (''81000000-0000-4000-8000-000000000004'',''80000000-0000-4000-8000-000000000001'',''50000000-0000-4000-8000-000000000001'',''70000000-0000-4000-8000-000000000002'',''71000000-0000-4000-8000-000000000003'',''DRAWING'',3)',
 '23503'
);
SELECT pg_temp.expect_rejected(
 '04 job file package differs from job',
 'INSERT INTO auto_mto_processing_job_files(id,processing_job_id,package_id,package_document_id,document_version_id,checksum) VALUES (''83000000-0000-4000-8000-000000000004'',''82000000-0000-4000-8000-000000000002'',''80000000-0000-4000-8000-000000000001'',''81000000-0000-4000-8000-000000000001'',''71000000-0000-4000-8000-000000000002'',repeat(''6'',64))',
 '23503'
);
SELECT pg_temp.expect_rejected(
 '05 job file package document and version mismatch',
 'INSERT INTO auto_mto_processing_job_files(id,processing_job_id,package_id,package_document_id,document_version_id,checksum) VALUES (''83000000-0000-4000-8000-000000000005'',''82000000-0000-4000-8000-000000000003'',''80000000-0000-4000-8000-000000000001'',''81000000-0000-4000-8000-000000000001'',''71000000-0000-4000-8000-000000000003'',repeat(''7'',64))',
 '23503'
);
SELECT pg_temp.expect_rejected(
 '06 token attempt from another job file',
 'INSERT INTO auto_mto_file_access_tokens(id,processing_job_id,job_file_id,processing_file_attempt_id,token_hash,expires_at) VALUES (''85000000-0000-4000-8000-000000000002'',''82000000-0000-4000-8000-000000000001'',''83000000-0000-4000-8000-000000000001'',''84000000-0000-4000-8000-000000000002'',repeat(''8'',64),now()+interval ''1 hour'')',
 '23503'
);
SELECT pg_temp.expect_rejected(
 '07 KHS version does not belong to KHS identity',
 'INSERT INTO auto_mto_items(id,package_id,khs_id,khs_item_version_id,description_snapshot,installation_type) VALUES (''88000000-0000-4000-8000-000000000003'',''80000000-0000-4000-8000-000000000001'',''10000000-0000-4000-8000-000000000004'',''10000000-0000-4000-8000-000000000014'',''Invalid KHS version'',''PSG'')',
 'P0001'
);
SELECT pg_temp.expect_rejected(
 '08 BOM item material mismatch',
 'INSERT INTO auto_mto_material_requirements(id,package_id,mto_item_id,material_id,bom_version_id,bom_item_id,formula_snapshot,base_quantity,unit_id,calculation_status) VALUES (''89000000-0000-4000-8000-000000000004'',''80000000-0000-4000-8000-000000000001'',''88000000-0000-4000-8000-000000000001'',''10000000-0000-4000-8000-000000000012'',''10000000-0000-4000-8000-000000000008'',''10000000-0000-4000-8000-000000000009'',''{}'',1,''10000000-0000-4000-8000-000000000002'',''CALCULATED'')',
 'P0001'
);
SELECT pg_temp.expect_rejected(
 '09 verification item from another package',
 'INSERT INTO auto_mto_verifications(id,package_id,mto_item_id,verifier_id,decision) VALUES (''89000000-0000-4000-8000-000000000005'',''80000000-0000-4000-8000-000000000002'',''88000000-0000-4000-8000-000000000001'',''20000000-0000-4000-8000-000000000002'',''VERIFIED'')',
 '23503'
);
SELECT pg_temp.expect_rejected(
 '10 approval snapshot from another package',
 'INSERT INTO auto_mto_approval_histories(id,package_id,snapshot_id,approver_id,role_id,organizational_unit_id,decision) VALUES (''91000000-0000-4000-8000-000000000002'',''80000000-0000-4000-8000-000000000001'',''90000000-0000-4000-8000-000000000002'',''20000000-0000-4000-8000-000000000002'',9002,''30000000-0000-4000-8000-000000000002'',''APPROVED'')',
 '23503'
);
SELECT pg_temp.expect_rejected(
 '11 copied actor from another workflow stage',
 'INSERT INTO document_review_cycle_stage_actors(id,cycle_stage_id,source_stage_actor_id,role_id,unit_scope,decision_required,minimum_approvals) VALUES (''77000000-0000-4000-8000-000000000002'',''76000000-0000-4000-8000-000000000001'',''74000000-0000-4000-8000-000000000002'',9004,''UP3'',true,1)',
 'P0001'
);
SELECT pg_temp.expect_rejected(
 '12 extraction package differs from job attempt package',
 'INSERT INTO auto_mto_extractions(id,package_id,processing_result_id,processing_file_attempt_id,extraction_type,source_locator) VALUES (''87000000-0000-4000-8000-000000000003'',''80000000-0000-4000-8000-000000000002'',''86000000-0000-4000-8000-000000000001'',''84000000-0000-4000-8000-000000000001'',''TABLE_ROW'',''{}'')',
 'P0001'
);
SELECT pg_temp.expect_rejected(
 '13 item source extraction from another package',
 'INSERT INTO auto_mto_item_sources(id,package_id,mto_item_id,extraction_id,source_role) VALUES (''89000000-0000-4000-8000-000000000006'',''80000000-0000-4000-8000-000000000001'',''88000000-0000-4000-8000-000000000001'',''87000000-0000-4000-8000-000000000002'',''SUPPORTING'')',
 '23503'
);
SELECT pg_temp.expect_rejected(
 '14 document version payload update',
 'UPDATE application_document_versions SET stored_filename = ''tampered.pdf'' WHERE id = ''71000000-0000-4000-8000-000000000001''',
 'P0001'
);
SELECT pg_temp.expect_rejected(
 '15a package snapshot deletion',
 'DELETE FROM auto_mto_package_snapshots WHERE id = ''90000000-0000-4000-8000-000000000001''',
 'P0001'
);
SELECT pg_temp.expect_rejected(
 '15b approval history deletion',
 'DELETE FROM auto_mto_approval_histories WHERE id = ''91000000-0000-4000-8000-000000000001''',
 'P0001'
);
SELECT pg_temp.expect_rejected(
 '16 duplicate active workflow rule',
 'INSERT INTO document_workflow_rules(id,template_id,category_id,application_type,workflow_stage,condition_key) VALUES (''72000000-0000-4000-8000-000000000004'',''72000000-0000-4000-8000-000000000001'',''60000000-0000-4000-8000-000000000001'',''PB'',''DRAWING'',''FIXTURE'')',
 '23505'
);

SELECT test_name,status,expected_sqlstate,actual_sqlstate,message
FROM runtime_test_results
ORDER BY test_name;

DO $$
BEGIN
  IF (SELECT count(*) FROM runtime_test_results WHERE status='PASS') <> 17 THEN
    RAISE EXCEPTION 'Expected 17 passing negative runtime checks';
  END IF;
END $$;
