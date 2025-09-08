import 'dotenv/config';

// Server requires backend Supabase credentials and superadmin seed vars.
const serverRequired = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_KEY',
  'SUPERADMIN_SEED_EMAIL',
  'SUPERADMIN_SEED_PASSWORD',
  'SUPERADMIN_INVITATION_CODE',
];

const missingServer = serverRequired.filter((name) => !process.env[name]);
if (missingServer.length) {
  console.error(
    `Missing required server environment variables:\n${missingServer.join('\n')}`
  );
  process.exit(1);
}

// Optional: warn (but do not fail) if client Vite envs are missing here.
const viteOptional = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'];
const missingVite = viteOptional.filter((name) => !process.env[name]);
if (missingVite.length) {
  console.warn(
    `Warning: missing Vite env variables (used by the frontend):\n${missingVite.join('\n')}`
  );
}
