import { supabase } from './supabaseClient.js';

export function login({ email, password }) {
  return supabase.auth.signInWithPassword({ email, password });
}

export function signup({ email, password }) {
  return supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: import.meta.env.VITE_SUPABASE_REDIRECT_URL,
      data: { role: 'admin' },
    },

  });
}

export function loginWithSSO(provider) {
  return supabase.auth.signInWithOAuth({ provider });
}

export function logout() {
  return supabase.auth.signOut();
}

export function getUser() {
  return supabase.auth.getUser().then(({ data }) => data.user);
}
