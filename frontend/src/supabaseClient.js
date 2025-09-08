import { createClient } from '@supabase/supabase-js';

// Read client-side credentials from Vite-prefixed env vars.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

const missing = [];
if (!supabaseUrl)
  missing.push('VITE_SUPABASE_URL (e.g., https://your-project.supabase.co)');
if (!supabaseAnonKey)
  missing.push('VITE_SUPABASE_ANON_KEY (e.g., public-anon-key)');

if (missing.length) {
  throw new Error(`Missing Supabase environment variables: ${missing.join(', ')}`);
}

// Correctly initialize Supabase using the Vite env vars.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
