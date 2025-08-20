import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import db from './db.js';
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

function generateAccessToken(userId, role) {
  return jwt.sign({ userId, role }, ACCESS_SECRET, { expiresIn: ACCESS_EXPIRES_IN });
}

function generateRefreshToken() {
  return crypto.randomBytes(40).toString('hex');
}

export async function signup({ username, password, role = 'user' }) {
  const passwordHash = bcrypt.hashSync(password, 10);
  try {
    await db.query('INSERT INTO users (username, password, role) VALUES ($1, $2, $3)', [username, passwordHash, role]);
    return { success: true };
  } catch (err) {
    if (err.code === '23505') {
      throw new Error('User exists');
    }
    throw err;
  }
}

export async function login({ username, password }) {
  const { rows: userRows } = await db.query('SELECT * FROM users WHERE username = $1', [username]);
  const user = userRows[0];
  if (!user) {
    logEvent('login_failed', { username });
    throw new Error('Invalid credentials');
  }
  const valid = bcrypt.compareSync(password, user.password);
  if (!valid) {
    logEvent('login_failed', { username });
    throw new Error('Invalid credentials');
  }
  const { rows: mfaRows } = await db.query('SELECT * FROM mfa WHERE user_id = $1', [user.id]);
  const mfa = mfaRows[0];
  if (mfa) {
    const mfaToken = jwt.sign({ userId: user.id }, ACCESS_SECRET, { expiresIn: '5m' });
    return { mfaRequired: true, mfaToken };
  }
  const accessToken = generateAccessToken(user.id, user.role);
  const refreshToken = generateRefreshToken();
  const expiresAt = Math.floor(Date.now() / 1000) + REFRESH_EXPIRES_SECONDS;
  await db.query('INSERT INTO refresh_tokens (token, user_id, expires_at) VALUES ($1, $2, $3)', [refreshToken, user.id, expiresAt]);
  logEvent('login_success', { userId: user.id, username });
  return { accessToken, refreshToken, role: user.role };
}

export async function logout({ refreshToken }) {
  const { rows } = await db.query('SELECT user_id FROM refresh_tokens WHERE token = $1', [refreshToken]);
  await db.query('DELETE FROM refresh_tokens WHERE token = $1', [refreshToken]);
  if (rows[0]) {
    logEvent('logout', { userId: rows[0].user_id });
  }
  return { success: true };
}

export async function refresh({ refreshToken }) {
  const { rows } = await db.query('SELECT * FROM refresh_tokens WHERE token = $1 AND revoked = false', [refreshToken]);
  const row = rows[0];
  if (!row) {
    logEvent('refresh_failed', { reason: 'invalid_token' });
    throw new Error('Invalid token');
  }
  if (row.expires_at < Math.floor(Date.now() / 1000)) {
    await db.query('DELETE FROM refresh_tokens WHERE token = $1', [refreshToken]);
    logEvent('refresh_failed', { reason: 'expired_token', userId: row.user_id });
    throw new Error('Expired token');
  }
  await db.query('DELETE FROM refresh_tokens WHERE token = $1', [refreshToken]);
  const newRefresh = generateRefreshToken();
  const expiresAt = Math.floor(Date.now() / 1000) + REFRESH_EXPIRES_SECONDS;
  await db.query('INSERT INTO refresh_tokens (token, user_id, expires_at) VALUES ($1, $2, $3)', [newRefresh, row.user_id, expiresAt]);
  const { rows: userRows } = await db.query('SELECT role FROM users WHERE id = $1', [row.user_id]);
  const user = userRows[0];
  const accessToken = generateAccessToken(row.user_id, user.role);
  logEvent('token_refresh', { userId: row.user_id });
  return { accessToken, refreshToken: newRefresh, role: user.role };
}

export async function enrollMfa({ username, password }) {
  const { rows: userRows } = await db.query('SELECT * FROM users WHERE username = $1', [username]);
  const user = userRows[0];
  if (!user) throw new Error('Invalid credentials');
  const valid = bcrypt.compareSync(password, user.password);
  if (!valid) throw new Error('Invalid credentials');
  const { rows: existingRows } = await db.query('SELECT * FROM mfa WHERE user_id = $1', [user.id]);
  const existing = existingRows[0];
  if (existing) {
    const otpauthUrl = `otpauth://totp/cdp:${encodeURIComponent(username)}?secret=${existing.secret}&issuer=cdp`;
    return { otpauthUrl, secret: existing.secret };
  }
  const secret = generateMfaSecret();
  await db.query(
    'INSERT INTO mfa (user_id, secret) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET secret = EXCLUDED.secret',
    [user.id, secret]
  );
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
  const { rows: mfaRows } = await db.query('SELECT * FROM mfa WHERE user_id = $1', [payload.userId]);
  const mfa = mfaRows[0];
  if (!mfa) throw new Error('MFA not enrolled');
  const valid = verifyTotp(mfa.secret, code);
  if (!valid) throw new Error('Invalid code');
  const { rows: userRows } = await db.query('SELECT role FROM users WHERE id = $1', [payload.userId]);
  const user = userRows[0];
  const accessToken = generateAccessToken(payload.userId, user.role);
  const refreshToken = generateRefreshToken();
  const expiresAt = Math.floor(Date.now() / 1000) + REFRESH_EXPIRES_SECONDS;
  await db.query('INSERT INTO refresh_tokens (token, user_id, expires_at) VALUES ($1, $2, $3)', [refreshToken, payload.userId, expiresAt]);
  return { accessToken, refreshToken, role: user.role };
}
