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
  tenant_id uuid REFERENCES tenants (id) ON DELETE SET NULL,
  profile_url text,
  phone text,
  locale text,
  consents jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_login_at timestamptz,
  deleted_at timestamptz
);

-- Enable RLS and implement soft delete via deleted_at
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Only expose non-deleted users
CREATE POLICY users_select ON users
  FOR SELECT USING (deleted_at IS NULL);

CREATE POLICY users_update ON users
  FOR UPDATE USING (deleted_at IS NULL);

-- Convert deletes into soft deletes
CREATE OR REPLACE FUNCTION soft_delete_users() RETURNS trigger AS $$
BEGIN
  UPDATE users SET deleted_at = now() WHERE id = OLD.id;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_soft_delete_users
  BEFORE DELETE ON users
  FOR EACH ROW EXECUTE FUNCTION soft_delete_users();
