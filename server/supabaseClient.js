import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_KEY;

const missing = [];
if (!supabaseUrl) missing.push('SUPABASE_URL');
if (!serviceKey) missing.push('SUPABASE_SERVICE_KEY');
if (missing.length) {
  throw new Error(`Missing environment variables: ${missing.join(', ')}`);
}

export const supabaseAdmin = createClient(supabaseUrl, serviceKey);
