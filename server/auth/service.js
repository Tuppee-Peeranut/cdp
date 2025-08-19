import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import db from './db.js';

const ACCESS_SECRET = process.env.ACCESS_TOKEN_SECRET || 'access-secret';
const ACCESS_EXPIRES_IN = '15m';
const REFRESH_EXPIRES_SECONDS = 60 * 60 * 24 * 7; // 7 days

function generateAccessToken(userId) {
  return jwt.sign({ userId }, ACCESS_SECRET, { expiresIn: ACCESS_EXPIRES_IN });
}

function generateRefreshToken() {
  return crypto.randomBytes(40).toString('hex');
}

export async function signup({ username, password }) {
  const passwordHash = bcrypt.hashSync(password, 10);
  const stmt = db.prepare('INSERT INTO users (username, password) VALUES (?, ?)');
  try {
    stmt.run(username, passwordHash);
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
  if (!user) throw new Error('Invalid credentials');
  const valid = bcrypt.compareSync(password, user.password);
  if (!valid) throw new Error('Invalid credentials');
  const accessToken = generateAccessToken(user.id);
  const refreshToken = generateRefreshToken();
  const expiresAt = Math.floor(Date.now() / 1000) + REFRESH_EXPIRES_SECONDS;
  db.prepare('INSERT INTO refresh_tokens (token, user_id, expires_at) VALUES (?, ?, ?)').run(refreshToken, user.id, expiresAt);
  return { accessToken, refreshToken };
}

export async function logout({ refreshToken }) {
  db.prepare('DELETE FROM refresh_tokens WHERE token = ?').run(refreshToken);
  return { success: true };
}

export async function refresh({ refreshToken }) {
  const row = db.prepare('SELECT * FROM refresh_tokens WHERE token = ? AND revoked = 0').get(refreshToken);
  if (!row) throw new Error('Invalid token');
  if (row.expires_at < Math.floor(Date.now() / 1000)) {
    db.prepare('DELETE FROM refresh_tokens WHERE token = ?').run(refreshToken);
    throw new Error('Expired token');
  }
  db.prepare('DELETE FROM refresh_tokens WHERE token = ?').run(refreshToken);
  const newRefresh = generateRefreshToken();
  const expiresAt = Math.floor(Date.now() / 1000) + REFRESH_EXPIRES_SECONDS;
  db.prepare('INSERT INTO refresh_tokens (token, user_id, expires_at) VALUES (?, ?, ?)').run(newRefresh, row.user_id, expiresAt);
  const accessToken = generateAccessToken(row.user_id);
  return { accessToken, refreshToken: newRefresh };
}
