import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import db from './db.js';
import { logEvent } from './logger.js';

const ACCESS_SECRET = process.env.ACCESS_TOKEN_SECRET || 'access-secret';
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
  const stmt = db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)');
  try {
    stmt.run(username, passwordHash, role);
    return { success: true };
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      throw new Error('User exists');
    }
    throw err;
  }
}

export async function login({ username, password }) {
  const stmt = db.prepare('SELECT * FROM users WHERE username = ?');
  const user = stmt.get(username);
  if (!user) {
    logEvent('login_failed', { username });
    throw new Error('Invalid credentials');
  }
  const valid = bcrypt.compareSync(password, user.password);
  if (!valid) {
    logEvent('login_failed', { username });
    throw new Error('Invalid credentials');
  }
  const mfa = db.prepare('SELECT * FROM mfa WHERE user_id = ?').get(user.id);
  if (mfa) {
    const mfaToken = jwt.sign({ userId: user.id }, ACCESS_SECRET, { expiresIn: '5m' });
    return { mfaRequired: true, mfaToken };
  }
  const accessToken = generateAccessToken(user.id, user.role);
  const refreshToken = generateRefreshToken();
  const expiresAt = Math.floor(Date.now() / 1000) + REFRESH_EXPIRES_SECONDS;
  db.prepare('INSERT INTO refresh_tokens (token, user_id, expires_at) VALUES (?, ?, ?)').run(refreshToken, user.id, expiresAt);
  logEvent('login_success', { userId: user.id, username });
  return { accessToken, refreshToken, role: user.role };
}

export async function logout({ refreshToken }) {
  const row = db.prepare('SELECT user_id FROM refresh_tokens WHERE token = ?').get(refreshToken);
  db.prepare('DELETE FROM refresh_tokens WHERE token = ?').run(refreshToken);
  if (row) {
    logEvent('logout', { userId: row.user_id });
  }
  return { success: true };
}

export async function refresh({ refreshToken }) {
  const row = db.prepare('SELECT * FROM refresh_tokens WHERE token = ? AND revoked = 0').get(refreshToken);
  if (!row) {
    logEvent('refresh_failed', { reason: 'invalid_token' });
    throw new Error('Invalid token');
  }
  if (row.expires_at < Math.floor(Date.now() / 1000)) {
    db.prepare('DELETE FROM refresh_tokens WHERE token = ?').run(refreshToken);
    logEvent('refresh_failed', { reason: 'expired_token', userId: row.user_id });
    throw new Error('Expired token');
  }
  db.prepare('DELETE FROM refresh_tokens WHERE token = ?').run(refreshToken);
  const newRefresh = generateRefreshToken();
  const expiresAt = Math.floor(Date.now() / 1000) + REFRESH_EXPIRES_SECONDS;
  db.prepare('INSERT INTO refresh_tokens (token, user_id, expires_at) VALUES (?, ?, ?)').run(newRefresh, row.user_id, expiresAt);
  const user = db.prepare('SELECT role FROM users WHERE id = ?').get(row.user_id);
  const accessToken = generateAccessToken(row.user_id, user.role);
  logEvent('token_refresh', { userId: row.user_id });
  return { accessToken, refreshToken: newRefresh, role: user.role };
}

export async function enrollMfa({ username, password }) {
  const stmt = db.prepare('SELECT * FROM users WHERE username = ?');
  const user = stmt.get(username);
  if (!user) throw new Error('Invalid credentials');
  const valid = bcrypt.compareSync(password, user.password);
  if (!valid) throw new Error('Invalid credentials');
  const existing = db.prepare('SELECT * FROM mfa WHERE user_id = ?').get(user.id);
  if (existing) {
    const otpauthUrl = `otpauth://totp/cdp:${encodeURIComponent(username)}?secret=${existing.secret}&issuer=cdp`;
    return { otpauthUrl, secret: existing.secret };
  }
  const secret = generateMfaSecret();
  db.prepare('INSERT OR REPLACE INTO mfa (user_id, secret) VALUES (?, ?)').run(user.id, secret);
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
  const mfa = db.prepare('SELECT * FROM mfa WHERE user_id = ?').get(payload.userId);
  if (!mfa) throw new Error('MFA not enrolled');
  const valid = verifyTotp(mfa.secret, code);
  if (!valid) throw new Error('Invalid code');
  const user = db.prepare('SELECT role FROM users WHERE id = ?').get(payload.userId);
  const accessToken = generateAccessToken(payload.userId, user.role);
  const refreshToken = generateRefreshToken();
  const expiresAt = Math.floor(Date.now() / 1000) + REFRESH_EXPIRES_SECONDS;
  db.prepare('INSERT INTO refresh_tokens (token, user_id, expires_at) VALUES (?, ?, ?)').run(refreshToken, payload.userId, expiresAt);
  return { accessToken, refreshToken, role: user.role };
}
