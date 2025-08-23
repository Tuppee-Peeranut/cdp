import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

process.env.SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET || 'testsecret';
const { authorize } = await import('./supabaseAuth.js');

function runMiddleware(mw, req) {
  return new Promise((resolve, reject) => {
    mw(req, { status: () => ({ json: () => reject(new Error('Unauthorized')) }) }, resolve);
  });
}

test('users are isolated by tenant', async () => {
  const tokenA = jwt.sign(
    { app_metadata: { tenant_id: 'tenant_1', role: 'user' } },
    process.env.SUPABASE_JWT_SECRET
  );
  const tokenB = jwt.sign(
    { app_metadata: { tenant_id: 'tenant_2', role: 'user' } },
    process.env.SUPABASE_JWT_SECRET
  );

  const reqA = { headers: { authorization: `Bearer ${tokenA}` } };
  const reqB = { headers: { authorization: `Bearer ${tokenB}` } };

  await runMiddleware(authorize(), reqA);
  await runMiddleware(authorize(), reqB);

  assert.equal(reqA.user.tenantId, 'tenant_1');
  assert.equal(reqB.user.tenantId, 'tenant_2');
});
