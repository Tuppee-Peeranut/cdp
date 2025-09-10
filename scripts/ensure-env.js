#!/usr/bin/env node
/**
 * Ensure local environment files exist with sensible defaults.
 * - backend/.env from backend/.env.example (if missing)
 * - frontend/.env.local from frontend/.env.example (if missing)
 */
import { existsSync, copyFileSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const root = resolve(process.cwd());
const beDir = resolve(root, 'backend');
const feDir = resolve(root, 'frontend');

function ensureBackendEnv() {
  const src = resolve(beDir, '.env.example');
  const dst = resolve(beDir, '.env');
  if (!existsSync(src)) return;
  if (!existsSync(dst)) {
    copyFileSync(src, dst);
    console.log('Created backend/.env from .env.example');
  } else {
    console.log('backend/.env exists');
  }
}

function ensureFrontendEnv() {
  const src = resolve(feDir, '.env.example');
  const dst = resolve(feDir, '.env.local');
  if (existsSync(dst)) {
    console.log('frontend/.env.local exists');
    return;
  }
  // Prefer example if present
  if (existsSync(src)) {
    const tmpl = readFileSync(src, 'utf8');
    // Create a minimal .env.local with placeholders if example is too bare
    let out = tmpl;
    if (!/VITE_SUPABASE_REDIRECT_URL=/.test(out)) {
      out += `\nVITE_SUPABASE_REDIRECT_URL=http://localhost:5173/confirm\n`;
    }
    writeFileSync(dst, out, 'utf8');
    console.log('Created frontend/.env.local from .env.example');
    return;
  }
  // Fallback default content
  const content = [
    'VITE_SUPABASE_URL=',
    'VITE_SUPABASE_ANON_KEY=',
    'VITE_SUPABASE_REDIRECT_URL=http://localhost:5173/confirm',
    '',
  ].join('\n');
  writeFileSync(dst, content, 'utf8');
  console.log('Created frontend/.env.local');
}

try {
  mkdirSync(resolve(root, 'scripts'), { recursive: true });
  ensureBackendEnv();
  ensureFrontendEnv();
  console.log('Env setup complete. Edit backend/.env and frontend/.env.local with your Supabase values.');
} catch (e) {
  console.error('Env setup failed:', e?.message || e);
  process.exit(1);
}

