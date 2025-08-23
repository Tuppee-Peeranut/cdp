import { supabase } from './supabaseClient.js';

export async function login({ email, password }) {
  console.log('[Auth] login attempt', { email });
  try {
    const res = await supabase.auth.signInWithPassword({ email, password });
    console.log('[Auth] login response', res);
    return res;
  } catch (err) {
    console.error('[Auth] login error', err);
    throw err;
  }
}

export async function signup({ email, password }) {
  console.log('[Auth] signup attempt', { email });
  try {
    const res = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/confirm`,
        data: { role: 'admin' },
      },
    });
    console.log('[Auth] signup response', res);
    return res;
  } catch (err) {
    console.error('[Auth] signup error', err);
    throw err;
  }
}

export function loginWithSSO(provider) {
  console.log('[Auth] login with SSO', { provider });
  return supabase.auth
    .signInWithOAuth({ provider })
    .then((res) => {
      console.log('[Auth] SSO response', res);
      return res;
    })
    .catch((err) => {
      console.error('[Auth] SSO error', err);
      throw err;
    });
}

export function logout() {
  console.log('[Auth] logout');
  return supabase.auth
    .signOut()
    .then((res) => {
      console.log('[Auth] logout response', res);
      return res;
    })
    .catch((err) => {
      console.error('[Auth] logout error', err);
      throw err;
    });
}

export function getUser() {
  console.log('[Auth] getUser');
  return supabase.auth
    .getUser()
    .then(({ data, error }) => {
      if (error) {
        console.error('[Auth] getUser error', error);
        return null;
      }
      console.log('[Auth] getUser response', data);
      return data.user;
    })
    .catch((err) => {
      console.error('[Auth] getUser unexpected error', err);
      throw err;
    });
}
