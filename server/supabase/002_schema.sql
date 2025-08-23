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

-- Create users table linked to auth.users and tenants
CREATE TABLE users (
  id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  username text UNIQUE,
  role text NOT NULL DEFAULT 'user',
  tenant_id uuid REFERENCES tenants (id) ON DELETE SET NULL
);
