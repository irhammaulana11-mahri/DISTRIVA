-- Apply T4.2.4 DDL from docs/27-T4.2.4-POSTGRESQL-DDL.sql separately
-- after 00..03 have succeeded. This file seeds only deterministic test fixtures.
-- Fixed UUIDs are reserved for this disposable test database.
INSERT INTO material_categories(id,code,name) VALUES
('10000000-0000-4000-8000-000000000001','FIXTURE_TEST','Fixture Test Category');

INSERT INTO units_of_measure(id,code,name,symbol) VALUES
('10000000-0000-4000-8000-000000000002','UNIT','Unit','u');

INSERT INTO materials(id,category_id,code,name,unit) VALUES
('10000000-0000-4000-8000-000000000003',
 '10000000-0000-4000-8000-000000000001',
 'FIXTURE-SKU-001','Fixture Material','u');

INSERT INTO khs_items(id,code) VALUES
('10000000-0000-4000-8000-000000000004','FIXTURE-KHS-001');

INSERT INTO khs_item_versions(
 id,khs_item_id,version_number,name,unit_id,valid_from,status
) VALUES (
 '10000000-0000-4000-8000-000000000005',
 '10000000-0000-4000-8000-000000000004',
 1,'Fixture KHS Version',
 '10000000-0000-4000-8000-000000000002',
 DATE '2026-01-01','APPROVED'
);

INSERT INTO construction_types(id,code) VALUES
('10000000-0000-4000-8000-000000000006','FIXTURE-CONSTRUCTION');

INSERT INTO construction_type_versions(
 id,construction_type_id,version_number,name,valid_from,status
) VALUES (
 '10000000-0000-4000-8000-000000000007',
 '10000000-0000-4000-8000-000000000006',
 1,'Fixture Construction Version',DATE '2026-01-01','APPROVED'
);

INSERT INTO bom_headers(
 id,construction_type_version_id,version_number,status,valid_from
) VALUES (
 '10000000-0000-4000-8000-000000000008',
 '10000000-0000-4000-8000-000000000007',
 1,'APPROVED',DATE '2026-01-01'
);

INSERT INTO bom_items(
 id,bom_header_id,material_id,quantity,unit_id,sequence,calculation_method
) VALUES (
 '10000000-0000-4000-8000-000000000009',
 '10000000-0000-4000-8000-000000000008',
 '10000000-0000-4000-8000-000000000003',
 1,'10000000-0000-4000-8000-000000000002',1,'FIXED'
);

INSERT INTO users(
 id,name,email,password,account_status,must_change_password
) VALUES
('20000000-0000-4000-8000-000000000001','Fixture Admin','fixture.admin@example.invalid',
 '$2y$12$fixturehashnotforlogin000000000000000000000000000000000000',
 'ACTIVE',false),
('20000000-0000-4000-8000-000000000002','Fixture Reviewer','fixture.reviewer@example.invalid',
 '$2y$12$fixturehashnotforlogin000000000000000000000000000000000000',
 'ACTIVE',false);

INSERT INTO organizational_units(id,code,name,unit_type,parent_id) VALUES
('30000000-0000-4000-8000-000000000001','FIX-UP3','Fixture UP3','UP3',NULL),
('30000000-0000-4000-8000-000000000002','FIX-ULP','Fixture ULP','ULP',
 '30000000-0000-4000-8000-000000000001');

INSERT INTO roles(id,name,guard_name,requires_unit_scope) VALUES
(9001,'SYS_ADMIN','web',false),
(9002,'MANAGER_ULP','web',true),
(9003,'UP3_MANAGER','web',true),
(9004,'ENGINEERING','web',true),
(9005,'PERENCANAAN','web',true),
(9006,'KONSTRUKSI_UP3','web',true);

INSERT INTO customers(id,customer_number,name,phone) VALUES
('40000000-0000-4000-8000-000000000001','FIX-CUST-001','Fixture Customer','+620000000001');

INSERT INTO applications(
 id,application_number,application_type,transaction_type,customer_id,
 organizational_unit_id,source_type,service_address,current_status
) VALUES (
 '50000000-0000-4000-8000-000000000001','FIX-APP-001','PB','PASANG BARU',
 '40000000-0000-4000-8000-000000000001',
 '30000000-0000-4000-8000-000000000002','MANUAL',
 'Fixture address','DRAFT'
);
