-- Contract-minimal fixture derived from docs/23-T4.2.2-MASTER-DATA-SCHEMA.md.
-- Only dependency tables/columns needed by T4.2.4 are included.
-- This is NOT the complete T4.2.2 implementation and NOT a production migration.
CREATE TABLE material_categories (
  id uuid PRIMARY KEY,
  code varchar(30) NOT NULL UNIQUE,
  name varchar(100) NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz,
  updated_at timestamptz
);

CREATE TABLE units_of_measure (
  id uuid PRIMARY KEY,
  code varchar(30) NOT NULL UNIQUE,
  name varchar(100) NOT NULL,
  symbol varchar(20) NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz,
  updated_at timestamptz
);

CREATE TABLE materials (
  id uuid PRIMARY KEY,
  category_id uuid NOT NULL REFERENCES material_categories(id) ON DELETE RESTRICT,
  code varchar(100) NOT NULL UNIQUE,
  name varchar(255) NOT NULL,
  unit varchar(30) NOT NULL,
  spec text,
  source_system varchar(50) NOT NULL DEFAULT 'ERP_MATERIAL',
  external_updated_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz,
  updated_at timestamptz
);

CREATE TABLE khs_items (
  id uuid PRIMARY KEY,
  code varchar(100) NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz,
  updated_at timestamptz
);

CREATE TABLE khs_item_versions (
  id uuid PRIMARY KEY,
  khs_item_id uuid NOT NULL REFERENCES khs_items(id) ON DELETE RESTRICT,
  version_number integer NOT NULL,
  name varchar(255) NOT NULL,
  description text,
  unit_id uuid NOT NULL REFERENCES units_of_measure(id) ON DELETE RESTRICT,
  category varchar(100),
  valid_from date NOT NULL,
  valid_until date,
  status varchar(20) NOT NULL,
  source_reference text,
  created_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  approved_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  approved_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  UNIQUE(khs_item_id,version_number),
  UNIQUE(khs_item_id,id),
  CHECK(version_number > 0),
  CHECK(valid_until IS NULL OR valid_until >= valid_from)
);

CREATE TABLE construction_types (
  id uuid PRIMARY KEY,
  code varchar(100) NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz,
  updated_at timestamptz
);

CREATE TABLE construction_type_versions (
  id uuid PRIMARY KEY,
  construction_type_id uuid NOT NULL REFERENCES construction_types(id) ON DELETE RESTRICT,
  version_number integer NOT NULL,
  name varchar(255) NOT NULL,
  description text,
  symbol text,
  reference text,
  valid_from date NOT NULL,
  valid_until date,
  status varchar(20) NOT NULL,
  created_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  approved_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  approved_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  UNIQUE(construction_type_id,version_number),
  CHECK(version_number > 0),
  CHECK(valid_until IS NULL OR valid_until >= valid_from)
);


CREATE TABLE bom_formula_definitions (
  id uuid PRIMARY KEY,
  code varchar(100) NOT NULL,
  version_number integer NOT NULL,
  name varchar(255) NOT NULL,
  expression_ast jsonb NOT NULL,
  allowed_variables jsonb NOT NULL DEFAULT '[]'::jsonb,
  input_units jsonb NOT NULL DEFAULT '[]'::jsonb,
  output_unit_id uuid REFERENCES units_of_measure(id) ON DELETE RESTRICT,
  validation_status varchar(30) NOT NULL,
  status varchar(20) NOT NULL,
  created_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  approved_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  approved_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  UNIQUE(code,version_number),
  UNIQUE(id,version_number),
  CHECK(version_number > 0)
);

CREATE TABLE bom_headers (
  id uuid PRIMARY KEY,
  construction_type_version_id uuid NOT NULL REFERENCES construction_type_versions(id) ON DELETE RESTRICT,
  version_number integer NOT NULL,
  status varchar(20) NOT NULL,
  valid_from date NOT NULL,
  valid_until date,
  created_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  approved_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  approved_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  UNIQUE(construction_type_version_id,version_number),
  UNIQUE(id,construction_type_version_id),
  CHECK(version_number > 0),
  CHECK(valid_until IS NULL OR valid_until >= valid_from)
);

CREATE TABLE bom_items (
  id uuid PRIMARY KEY,
  bom_header_id uuid NOT NULL REFERENCES bom_headers(id) ON DELETE RESTRICT,
  material_id uuid NOT NULL REFERENCES materials(id) ON DELETE RESTRICT,
  quantity numeric(24,9) NOT NULL CHECK(quantity >= 0),
  unit_id uuid NOT NULL REFERENCES units_of_measure(id) ON DELETE RESTRICT,
  sequence integer NOT NULL,
  calculation_method varchar(30) NOT NULL,
  formula_definition_id uuid REFERENCES bom_formula_definitions(id) ON DELETE RESTRICT,
  basis_description text,
  notes text,
  UNIQUE(id,bom_header_id),
  UNIQUE(bom_header_id,sequence)
);
CREATE INDEX idx_fixture_bom_items_material ON bom_items(material_id);
