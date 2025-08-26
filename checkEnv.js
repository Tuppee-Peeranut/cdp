import 'dotenv/config';

const required = [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'SUPERADMIN_SEED_EMAIL',
  'SUPERADMIN_SEED_PASSWORD',
  'SUPERADMIN_INVITATION_CODE'
];
const missing = required.filter((name) => !process.env[name]);

if (missing.length) {
  console.error(
    `Missing required environment variables:\n${missing.join('\n')}`
  );
  process.exit(1);
}
