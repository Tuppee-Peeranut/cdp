import { createClient } from '@supabase/supabase-js';

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

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
