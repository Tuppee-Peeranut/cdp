CREATE TABLE IF NOT EXISTS tenants (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL
);

-- Seed initial tenants
INSERT INTO tenants (name) VALUES ('tenant_a'), ('tenant_b')
ON CONFLICT (name) DO NOTHING;

-- Add tenant_id to users and related tables
ALTER TABLE users ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id);
UPDATE users SET tenant_id = (SELECT id FROM tenants WHERE name = 'tenant_a') WHERE tenant_id IS NULL;
ALTER TABLE users ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id);
UPDATE refresh_tokens SET tenant_id = (SELECT tenant_id FROM users WHERE id = refresh_tokens.user_id) WHERE tenant_id IS NULL;
ALTER TABLE refresh_tokens ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE oidc_users ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id);
UPDATE oidc_users SET tenant_id = (SELECT id FROM tenants WHERE name = 'tenant_a') WHERE tenant_id IS NULL;
ALTER TABLE oidc_users ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE mfa ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id);
UPDATE mfa SET tenant_id = (SELECT tenant_id FROM users WHERE id = mfa.user_id) WHERE tenant_id IS NULL;
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
  USING (tenant_id = current_setting('app.tenant_id')::int)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::int);

CREATE POLICY tenant_isolation_refresh_tokens ON refresh_tokens
  USING (tenant_id = current_setting('app.tenant_id')::int)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::int);

CREATE POLICY tenant_isolation_oidc_users ON oidc_users
  USING (tenant_id = current_setting('app.tenant_id')::int)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::int);

CREATE POLICY tenant_isolation_mfa ON mfa
  USING (tenant_id = current_setting('app.tenant_id')::int)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::int);
