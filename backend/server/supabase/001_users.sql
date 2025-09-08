-- Create users table with full schema and tenant linkage
CREATE TABLE IF NOT EXISTS users (
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

-- Enforce row level security and soft delete behaviour
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_select ON users
  FOR SELECT USING (deleted_at IS NULL);

CREATE POLICY users_update ON users
  FOR UPDATE USING (deleted_at IS NULL);

CREATE POLICY users_insert ON users
  FOR INSERT WITH CHECK (deleted_at IS NULL);

CREATE POLICY users_delete ON users
  FOR DELETE USING (deleted_at IS NULL);

CREATE OR REPLACE FUNCTION soft_delete_users() RETURNS trigger AS $$
BEGIN
  UPDATE users SET deleted_at = now() WHERE id = OLD.id;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_soft_delete_users
  BEFORE DELETE ON users
  FOR EACH ROW EXECUTE FUNCTION soft_delete_users();
