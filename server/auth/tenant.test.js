import test from 'node:test';
import assert from 'node:assert/strict';

process.env.ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || 'testsecret';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'testkey';

const { default: supabase } = await import('./db.js');
const { signup, login, refresh } = await import('./service.js');

test('users are isolated by tenant', async () => {
  await supabase.from('refresh_tokens').delete().neq('token', '');
  await supabase.from('mfa').delete().neq('user_id', 0);
  await supabase.from('oidc_users').delete().neq('id', 0);
  await supabase.from('users').delete().neq('id', 0);

  const { data: tenantRows } = await supabase
    .from('tenants')
    .select('id, name')
    .in('name', ['tenant_a', 'tenant_b'])
    .order('name');
  const [tenantA, tenantB] = tenantRows.map(r => r.id);

  await signup({ username: 'alice', password: 'pw', tenantId: tenantA });
  await signup({ username: 'bob', password: 'pw', tenantId: tenantB });

  const { refreshToken } = await login({ username: 'alice', password: 'pw', tenantId: tenantA });

  await assert.rejects(() => login({ username: 'alice', password: 'pw', tenantId: tenantB }), /Invalid credentials/);
  await assert.rejects(() => refresh({ refreshToken, tenantId: tenantB }), /Invalid token/);
});
