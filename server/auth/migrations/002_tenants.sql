CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  subscription_start TIMESTAMPTZ,
  subscription_end TIMESTAMPTZ,
  active_plan TEXT,
  trial BOOLEAN NOT NULL DEFAULT FALSE,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Seed initial tenants
INSERT INTO tenants (name) VALUES ('tenant_a'), ('tenant_b')
ON CONFLICT (name) DO NOTHING;

-- Add tenant_id to users and related tables
ALTER TABLE users ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
UPDATE users SET tenant_id = (SELECT id FROM tenants WHERE name = 'tenant_a') WHERE tenant_id IS NULL;
ALTER TABLE users ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
UPDATE refresh_tokens
  SET tenant_id = (
    SELECT tenant_id FROM users WHERE users.id::text = refresh_tokens.user_id::text
  )
  WHERE tenant_id IS NULL;
ALTER TABLE refresh_tokens ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE oidc_users ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
UPDATE oidc_users SET tenant_id = (SELECT id FROM tenants WHERE name = 'tenant_a') WHERE tenant_id IS NULL;
ALTER TABLE oidc_users ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE mfa ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
UPDATE mfa
  SET tenant_id = (
    SELECT tenant_id FROM users WHERE users.id::text = mfa.user_id::text
  )
  WHERE tenant_id IS NULL;
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
