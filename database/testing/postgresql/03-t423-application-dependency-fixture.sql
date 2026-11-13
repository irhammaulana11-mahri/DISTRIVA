-- Contract-minimal fixture derived from docs/24-T4.2.3-APPLICATIONS-PB-PD-SCHEMA.md.
-- The T4.2.3 design still has open issues. This fixture is explicitly a
-- test contract for T4.2.4 FK validation only, NOT an approved full T4.2.3 schema.
CREATE TABLE customers (
  id uuid PRIMARY KEY,
  customer_number varchar(50) NOT NULL UNIQUE,
  name varchar(200) NOT NULL,
  phone varchar(30),
  email varchar(150),
  created_at timestamptz,
  updated_at timestamptz
);

CREATE TABLE customer_external_references (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  source_system varchar(50) NOT NULL,
  reference_type varchar(50) NOT NULL,
  reference_value varchar(150) NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  valid_from timestamptz,
  valid_until timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  CHECK(valid_until IS NULL OR valid_from IS NULL OR valid_until >= valid_from)
);
CREATE UNIQUE INDEX uq_fixture_customer_external_ref
  ON customer_external_references(source_system,reference_type,reference_value);

CREATE TABLE applications (
  id uuid PRIMARY KEY,
  application_number varchar(50) NOT NULL UNIQUE,
  application_type varchar(5) NOT NULL CHECK(application_type IN ('PB','PD')),
  transaction_type varchar(50),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  organizational_unit_id uuid NOT NULL REFERENCES organizational_units(id) ON DELETE RESTRICT,
  source_type varchar(30) NOT NULL,
  source_reference_id varchar(150),
  source_created_at timestamptz,
  imported_at timestamptz,
  service_address text,
  old_tariff_code varchar(30),
  old_power_value numeric(14,3),
  old_power_unit varchar(10),
  new_tariff_code varchar(30),
  new_power_value numeric(14,3),
  new_power_unit varchar(10),
  delta_power_kva numeric(14,3),
  sar_package varchar(150),
  total_cost numeric(18,2),
  service_criteria varchar(50),
  requires_drawing boolean NOT NULL DEFAULT false,
  requires_feasibility_study boolean NOT NULL DEFAULT false,
  requires_network_extension boolean NOT NULL DEFAULT false,
  current_status varchar(50) NOT NULL,
  submitted_at timestamptz,
  completed_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz,
  updated_at timestamptz
);
CREATE INDEX idx_fixture_applications_unit ON applications(organizational_unit_id);
CREATE INDEX idx_fixture_applications_customer ON applications(customer_id);
