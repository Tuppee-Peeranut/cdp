import { supabase } from './supabaseClient.js';

// Ensure the Supabase user object has an up‑to‑date role. Even if the auth
// metadata contains a role (which may become stale if the role is changed
// directly in the `users` table), fetch the latest value from the table and
// merge it into the user metadata. This keeps client-side role checks accurate.
export async function ensureUserRole(user) {
  if (!user) return user;
  try {
    const { data, error } = await supabase
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single();
    if (error || !data?.role) return user;
    const role = data.role;
    if (user.user_metadata?.role !== role) {
      // Best effort to sync the auth metadata; ignore errors.
      await supabase.auth.updateUser({ data: { role } }).catch(() => {});
    }
    return {
      ...user,
      user_metadata: { ...user.user_metadata, role },
    };
  } catch (err) {
    console.error('[Auth] ensureUserRole error', err);
    return user;
  }
}

export async function login({ email, password }) {
  console.log('[Auth] login attempt', { email });
  try {
    const res = await supabase.auth.signInWithPassword({ email, password });
    console.log('[Auth] login response', res);
    if (res.data?.user) {
      await supabase.auth.updateUser({ data: { last_login_at: new Date().toISOString() } });
    }
    return res;
  } catch (err) {
    console.error('[Auth] login error', err);
    throw err;
  }
}

export async function signup({ email, password, tenantId, profileUrl, phone, locale, consents }) {
  console.log('[Auth] signup attempt', { email });
  try {
    const res = await supabase.auth.signUp({
      email,
      password,
      phone,
      options: {
        emailRedirectTo: `${window.location.origin}/confirm`,
        data: {
          role: 'admin',
          tenant_id: tenantId ?? '00000000-0000-0000-0000-000000000001',
          profile_url: profileUrl,
          locale,
          consents
        },
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
