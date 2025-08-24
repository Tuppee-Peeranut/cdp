CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  subscription_start TIMESTAMPTZ,
  subscription_end TIMESTAMPTZ,
  active_plan TEXT,
  trial BOOLEAN NOT NULL DEFAULT FALSE,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Seed initial tenants with fixed identifiers for legacy references
INSERT INTO tenants (id, name) VALUES
  ('00000000-0000-0000-0000-000000000001', 'tenant_1'),
  ('00000000-0000-0000-0000-000000000002', 'tenant_2'),
  ('00000000-0000-0000-0000-000000000003', 'tenant_3'),
  ('00000000-0000-0000-0000-000000000004', 'tenant_4'),
  ('00000000-0000-0000-0000-000000000005', 'tenant_5')
ON CONFLICT (id) DO NOTHING;


-- Add tenant_id to users and related tables, dropping conflicting columns first
ALTER TABLE users DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE users ADD COLUMN tenant_id UUID REFERENCES tenants(id);
UPDATE users SET tenant_id = (SELECT id FROM tenants WHERE name = 'tenant_1');
ALTER TABLE users ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE refresh_tokens DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE refresh_tokens ADD COLUMN tenant_id UUID REFERENCES tenants(id);
UPDATE refresh_tokens
  SET tenant_id = (
    SELECT tenant_id FROM users WHERE users.id::text = refresh_tokens.user_id::text
  );
ALTER TABLE refresh_tokens ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE oidc_users DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE oidc_users ADD COLUMN tenant_id UUID REFERENCES tenants(id);
UPDATE oidc_users SET tenant_id = (SELECT id FROM tenants WHERE name = 'tenant_1');
ALTER TABLE oidc_users ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE mfa DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE mfa ADD COLUMN tenant_id UUID REFERENCES tenants(id);
UPDATE mfa
  SET tenant_id = (
    SELECT tenant_id FROM users WHERE users.id::text = mfa.user_id::text
  );

ALTER TABLE mfa ALTER COLUMN tenant_id SET NOT NULL;

-- Enable Row Level Security
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens FORCE ROW LEVEL SECURITY;
ALTER TABLE oidc_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE oidc_users FORCE ROW LEVEL SECURITY;
ALTER TABLE mfa ENABLE ROW LEVEL SECURITY;
ALTER TABLE mfa FORCE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY tenant_isolation_users ON users
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE POLICY tenant_isolation_refresh_tokens ON refresh_tokens
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE POLICY tenant_isolation_oidc_users ON oidc_users
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE POLICY tenant_isolation_mfa ON mfa
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
