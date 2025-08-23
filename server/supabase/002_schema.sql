-- Refresh tenants and users tables with proper relationships

-- Drop existing tables if they exist
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS tenants CASCADE;

-- Create tenants table
CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE,
  subscription_start timestamptz,
  subscription_end timestamptz,
  active_plan text,
  trial boolean NOT NULL DEFAULT false,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- Seed initial tenants
INSERT INTO tenants (id, name) VALUES
  ('00000000-0000-0000-0000-000000000001', 'tenant_1'),
  ('00000000-0000-0000-0000-000000000002', 'tenant_2'),
  ('00000000-0000-0000-0000-000000000003', 'tenant_3'),
  ('00000000-0000-0000-0000-000000000004', 'tenant_4'),
  ('00000000-0000-0000-0000-000000000005', 'tenant_5');

-- Create users table linked to auth.users and tenants
CREATE TABLE users (
  id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  username text UNIQUE,
  role text NOT NULL DEFAULT 'user',
  tenant_id uuid REFERENCES tenants (id) ON DELETE SET NULL
);
