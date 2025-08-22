import { supabase } from './supabaseClient.js';

export function login({ email, password }) {
  return supabase.auth.signInWithPassword({ email, password });
}

export function signup({ email, password }) {
  return supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: window.location.origin },
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
