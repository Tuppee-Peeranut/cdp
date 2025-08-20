import test from 'node:test';
import assert from 'node:assert/strict';

process.env.ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || 'testsecret';
process.env.PGHOST = process.env.PGHOST || '127.0.0.1';
process.env.PGUSER = process.env.PGUSER || 'postgres';
process.env.PGDATABASE = process.env.PGDATABASE || 'cdp_test';
process.env.PGPASSWORD = process.env.PGPASSWORD || 'postgres';
process.env.PGPORT = process.env.PGPORT || '5432';

const { default: db } = await import('./db.js');
const { signup, login, refresh } = await import('./service.js');

test('users are isolated by tenant', async () => {
  await db.query('TRUNCATE TABLE refresh_tokens, mfa, oidc_users, users RESTART IDENTITY CASCADE');
  const { rows: tenantRows } = await db.query("SELECT id FROM tenants WHERE name IN ('tenant_a','tenant_b') ORDER BY name");
  const [tenantA, tenantB] = tenantRows.map(r => r.id);

  await signup({ username: 'alice', password: 'pw', tenantId: tenantA });
  await signup({ username: 'bob', password: 'pw', tenantId: tenantB });

  const { refreshToken } = await login({ username: 'alice', password: 'pw', tenantId: tenantA });

  await assert.rejects(() => login({ username: 'alice', password: 'pw', tenantId: tenantB }), /Invalid credentials/);
  await assert.rejects(() => refresh({ refreshToken, tenantId: tenantB }), /Invalid token/);
});
