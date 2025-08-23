-- Convert tenant identifiers to UUID and add subscription metadata

-- Add new subscription columns if missing
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS subscription_start TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS subscription_end TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS active_plan TEXT,
  ADD COLUMN IF NOT EXISTS trial BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Introduce UUID identifiers
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS id_uuid UUID DEFAULT gen_random_uuid();
ALTER TABLE tenants ALTER COLUMN id_uuid SET NOT NULL;

-- Add UUID columns to referencing tables
ALTER TABLE users ADD COLUMN IF NOT EXISTS tenant_id_uuid UUID;
UPDATE users SET tenant_id_uuid = t.id_uuid FROM tenants t WHERE users.tenant_id = t.id;

ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS tenant_id_uuid UUID;
UPDATE refresh_tokens SET tenant_id_uuid = t.id_uuid FROM tenants t WHERE refresh_tokens.tenant_id = t.id;

ALTER TABLE oidc_users ADD COLUMN IF NOT EXISTS tenant_id_uuid UUID;
UPDATE oidc_users SET tenant_id_uuid = t.id_uuid FROM tenants t WHERE oidc_users.tenant_id = t.id;

ALTER TABLE mfa ADD COLUMN IF NOT EXISTS tenant_id_uuid UUID;
UPDATE mfa SET tenant_id_uuid = t.id_uuid FROM tenants t WHERE mfa.tenant_id = t.id;

-- Drop existing constraints
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_tenant_id_fkey;
ALTER TABLE refresh_tokens DROP CONSTRAINT IF EXISTS refresh_tokens_tenant_id_fkey;
ALTER TABLE oidc_users DROP CONSTRAINT IF EXISTS oidc_users_tenant_id_fkey;
ALTER TABLE mfa DROP CONSTRAINT IF EXISTS mfa_tenant_id_fkey;

-- Replace old tenant id columns
ALTER TABLE users DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE refresh_tokens DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE oidc_users DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE mfa DROP COLUMN IF EXISTS tenant_id;

ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_pkey;
ALTER TABLE tenants DROP COLUMN IF EXISTS id;
ALTER TABLE tenants RENAME COLUMN id_uuid TO id;
ALTER TABLE tenants ADD PRIMARY KEY (id);

ALTER TABLE users RENAME COLUMN tenant_id_uuid TO tenant_id;
ALTER TABLE refresh_tokens RENAME COLUMN tenant_id_uuid TO tenant_id;
ALTER TABLE oidc_users RENAME COLUMN tenant_id_uuid TO tenant_id;
ALTER TABLE mfa RENAME COLUMN tenant_id_uuid TO tenant_id;

ALTER TABLE users ADD FOREIGN KEY (tenant_id) REFERENCES tenants(id);
ALTER TABLE refresh_tokens ADD FOREIGN KEY (tenant_id) REFERENCES tenants(id);
ALTER TABLE oidc_users ADD FOREIGN KEY (tenant_id) REFERENCES tenants(id);
ALTER TABLE mfa ADD FOREIGN KEY (tenant_id) REFERENCES tenants(id);

ALTER TABLE users ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE refresh_tokens ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE oidc_users ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE mfa ALTER COLUMN tenant_id SET NOT NULL;

-- Recreate policies with UUID casting
DROP POLICY IF EXISTS tenant_isolation_users ON users;
CREATE POLICY tenant_isolation_users ON users
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

DROP POLICY IF EXISTS tenant_isolation_refresh_tokens ON refresh_tokens;
CREATE POLICY tenant_isolation_refresh_tokens ON refresh_tokens
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

DROP POLICY IF EXISTS tenant_isolation_oidc_users ON oidc_users;
CREATE POLICY tenant_isolation_oidc_users ON oidc_users
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

DROP POLICY IF EXISTS tenant_isolation_mfa ON mfa;
CREATE POLICY tenant_isolation_mfa ON mfa
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
