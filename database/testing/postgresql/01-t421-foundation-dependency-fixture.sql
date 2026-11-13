-- Contract-minimal fixture derived from docs/22-T4.2.1-FOUNDATION-SCHEMA.md.
-- This is TEST-ONLY dependency scaffolding, NOT a Laravel migration.
-- The DDL targets below reproduce the documented key types and FK targets.
CREATE TABLE users (
  id uuid PRIMARY KEY,
  nip varchar(30) UNIQUE,
  name varchar(150) NOT NULL,
  email varchar(150) NOT NULL UNIQUE,
  phone varchar(30),
  password varchar(255) NOT NULL,
  account_status varchar(30) NOT NULL,
  must_change_password boolean NOT NULL DEFAULT true,
  email_verified_at timestamptz,
  last_login_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  CONSTRAINT ck_fixture_users_status CHECK
    (account_status IN ('PENDING_ACTIVATION','ACTIVE','SUSPENDED','INACTIVE'))
);
CREATE UNIQUE INDEX uq_fixture_users_email_lower ON users (lower(email));

CREATE TABLE organizational_units (
  id uuid PRIMARY KEY,
  code varchar(30) NOT NULL UNIQUE,
  name varchar(150) NOT NULL,
  unit_type varchar(10) NOT NULL CHECK (unit_type IN ('UP3','ULP')),
  parent_id uuid REFERENCES organizational_units(id) ON DELETE RESTRICT,
  address text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz,
  updated_at timestamptz
);
CREATE INDEX idx_fixture_org_parent ON organizational_units(parent_id);
CREATE INDEX idx_fixture_org_type_active ON organizational_units(unit_type,is_active);

CREATE TABLE roles (
  id bigserial PRIMARY KEY,
  name varchar(255) NOT NULL,
  guard_name varchar(255) NOT NULL DEFAULT 'web',
  description text,
  requires_unit_scope boolean NOT NULL DEFAULT true,
  UNIQUE(name,guard_name)
);

CREATE TABLE permissions (
  id bigserial PRIMARY KEY,
  name varchar(255) NOT NULL,
  guard_name varchar(255) NOT NULL DEFAULT 'web',
  UNIQUE(name,guard_name)
);

CREATE TABLE role_has_permissions (
  permission_id bigint NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  role_id bigint NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY(role_id,permission_id)
);

CREATE TABLE user_role_assignments (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  role_id bigint NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  organizational_unit_id uuid REFERENCES organizational_units(id) ON DELETE RESTRICT,
  valid_from date NOT NULL,
  valid_until date,
  is_active boolean NOT NULL DEFAULT true,
  assigned_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  assignment_document varchar(255),
  created_at timestamptz,
  updated_at timestamptz,
  CHECK (valid_until IS NULL OR valid_until >= valid_from)
);

CREATE TABLE organizational_unit_histories (
  id uuid PRIMARY KEY,
  organizational_unit_id uuid NOT NULL REFERENCES organizational_units(id) ON DELETE RESTRICT,
  old_code varchar(30),
  new_code varchar(30),
  old_name varchar(150),
  new_name varchar(150),
  reason text,
  changed_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  changed_at timestamptz NOT NULL DEFAULT now()
);
