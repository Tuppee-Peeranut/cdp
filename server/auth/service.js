import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import supabase from './db.js';
import { logEvent } from './logger.js';

const ACCESS_SECRET = process.env.ACCESS_TOKEN_SECRET;
if (!ACCESS_SECRET) {
  throw new Error('ACCESS_TOKEN_SECRET environment variable is required');
}
const ACCESS_EXPIRES_IN = '15m';
const REFRESH_EXPIRES_SECONDS = 60 * 60 * 24 * 7; // 7 days

const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buffer) {
  let bits = 0, value = 0, output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += B32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

function base32Decode(str) {
  let bits = 0, value = 0;
  const bytes = [];
  str = str.replace(/=+$/, '').toUpperCase();
  for (const char of str) {
    const idx = B32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function generateMfaSecret() {
  return base32Encode(crypto.randomBytes(20));
}

function generateTotp(secret, step) {
  const key = base32Decode(secret);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(0, 0);
  buf.writeUInt32BE(step, 4);
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1000000;
  return code.toString().padStart(6, '0');
}

function verifyTotp(secret, token) {
  const step = Math.floor(Date.now() / 1000 / 30);
  for (let i = -1; i <= 1; i++) {
    if (generateTotp(secret, step + i) === token) return true;
  }
  return false;
}

function generateAccessToken(userId, role, tenantId) {
  return jwt.sign({ userId, role, tenantId }, ACCESS_SECRET, { expiresIn: ACCESS_EXPIRES_IN });
}

function generateRefreshToken() {
  return crypto.randomBytes(40).toString('hex');
}

export async function signup({ username, password, role = 'user', tenantId = 1 }) {
  const passwordHash = bcrypt.hashSync(password, 10);
  const { error } = await supabase
    .from('users')
    .insert({ username, password: passwordHash, role, tenant_id: tenantId });
  if (error) {
    if (error.code === '23505') {
      throw new Error('User exists');
    }
    throw error;
  }
  return { success: true };
}

export async function login({ username, password, tenantId = 1 }) {
  const { data: user, error } = await supabase
    .from('users')
    .select('*')
    .eq('username', username)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (error) throw error;
  if (!user) {
    logEvent('login_failed', { username });
    throw new Error('Invalid credentials');
  }
  const valid = bcrypt.compareSync(password, user.password);
  if (!valid) {
    logEvent('login_failed', { username });
    throw new Error('Invalid credentials');
  }
  const { data: mfa } = await supabase
    .from('mfa')
    .select('*')
    .eq('user_id', user.id)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (mfa) {
    const mfaToken = jwt.sign({ userId: user.id, tenantId }, ACCESS_SECRET, { expiresIn: '5m' });
    return { mfaRequired: true, mfaToken };
  }
  const accessToken = generateAccessToken(user.id, user.role, tenantId);
  const refreshToken = generateRefreshToken();
  const expiresAt = Math.floor(Date.now() / 1000) + REFRESH_EXPIRES_SECONDS;
  await supabase.from('refresh_tokens').insert({
    token: refreshToken,
    user_id: user.id,
    expires_at: expiresAt,
    tenant_id: tenantId
  });
  logEvent('login_success', { userId: user.id, username });
  return { accessToken, refreshToken, role: user.role };
}

export async function logout({ refreshToken, tenantId = 1 }) {
  const { data } = await supabase
    .from('refresh_tokens')
    .select('user_id')
    .eq('token', refreshToken)
    .eq('tenant_id', tenantId);
  await supabase
    .from('refresh_tokens')
    .delete()
    .eq('token', refreshToken)
    .eq('tenant_id', tenantId);
  if (data && data[0]) {
    logEvent('logout', { userId: data[0].user_id });
  }
  return { success: true };
}

export async function refresh({ refreshToken, tenantId = 1 }) {
  const { data: row, error } = await supabase
    .from('refresh_tokens')
    .select('*')
    .eq('token', refreshToken)
    .eq('tenant_id', tenantId)
    .eq('revoked', false)
    .maybeSingle();
  if (error) throw error;
  if (!row) {
    logEvent('refresh_failed', { reason: 'invalid_token' });
    throw new Error('Invalid token');
  }
  if (row.expires_at < Math.floor(Date.now() / 1000)) {
    await supabase
      .from('refresh_tokens')
      .delete()
      .eq('token', refreshToken)
      .eq('tenant_id', tenantId);
    logEvent('refresh_failed', { reason: 'expired_token', userId: row.user_id });
    throw new Error('Expired token');
  }
  await supabase
    .from('refresh_tokens')
    .delete()
    .eq('token', refreshToken)
    .eq('tenant_id', tenantId);
  const newRefresh = generateRefreshToken();
  const expiresAt = Math.floor(Date.now() / 1000) + REFRESH_EXPIRES_SECONDS;
  await supabase.from('refresh_tokens').insert({
    token: newRefresh,
    user_id: row.user_id,
    expires_at: expiresAt,
    tenant_id: tenantId
  });
  const { data: user } = await supabase
    .from('users')
    .select('role')
    .eq('id', row.user_id)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  const accessToken = generateAccessToken(row.user_id, user.role, tenantId);
  logEvent('token_refresh', { userId: row.user_id });
  return { accessToken, refreshToken: newRefresh, role: user.role };
}

export async function enrollMfa({ username, password, tenantId = 1 }) {
  const { data: user, error: userErr } = await supabase
    .from('users')
    .select('*')
    .eq('username', username)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (userErr) throw userErr;
  if (!user) throw new Error('Invalid credentials');
  const valid = bcrypt.compareSync(password, user.password);
  if (!valid) throw new Error('Invalid credentials');
  const { data: existing } = await supabase
    .from('mfa')
    .select('*')
    .eq('user_id', user.id)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (existing) {
    const otpauthUrl = `otpauth://totp/cdp:${encodeURIComponent(username)}?secret=${existing.secret}&issuer=cdp`;
    return { otpauthUrl, secret: existing.secret };
  }
  const secret = generateMfaSecret();
  await supabase.from('mfa').upsert({ user_id: user.id, secret, tenant_id: tenantId });
  const otpauthUrl = `otpauth://totp/cdp:${encodeURIComponent(username)}?secret=${secret}&issuer=cdp`;
  return { otpauthUrl, secret };
}

export async function verifyMfa({ mfaToken, code }) {
  let payload;
  try {
    payload = jwt.verify(mfaToken, ACCESS_SECRET);
  } catch (err) {
    throw new Error('Invalid token');
  }
  const tenantId = payload.tenantId;
  const { data: mfa, error: mfaErr } = await supabase
    .from('mfa')
    .select('*')
    .eq('user_id', payload.userId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (mfaErr) throw mfaErr;
  if (!mfa) throw new Error('MFA not enrolled');
  const valid = verifyTotp(mfa.secret, code);
  if (!valid) throw new Error('Invalid code');
  const { data: user } = await supabase
    .from('users')
    .select('role')
    .eq('id', payload.userId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  const accessToken = generateAccessToken(payload.userId, user.role, tenantId);
  const refreshToken = generateRefreshToken();
  const expiresAt = Math.floor(Date.now() / 1000) + REFRESH_EXPIRES_SECONDS;
  await supabase.from('refresh_tokens').insert({
    token: refreshToken,
    user_id: payload.userId,
    expires_at: expiresAt,
    tenant_id: tenantId
  });
  return { accessToken, refreshToken, role: user.role };
}
