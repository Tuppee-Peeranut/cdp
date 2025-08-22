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

test('rejects tokens signed with non-HS256 algorithms', async () => {
  const token = jwt.sign(
    { app_metadata: { role: 'user' } },
    process.env.SUPABASE_JWT_SECRET,
    { algorithm: 'HS512' }
  );
  const req = { headers: { authorization: `Bearer ${token}` } };
  await assert.rejects(runMiddleware(authorize(), req), /Unauthorized/);
});

