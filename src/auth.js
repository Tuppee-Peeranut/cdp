import { supabase } from './supabaseClient.js';

// Ensure the Supabase user object contains a role. If the user metadata is
// missing the role (which can happen if the role is only stored in the public
// `users` table), fetch it from the table and merge it into the metadata. This
// allows client-side code to consistently rely on `user.user_metadata.role`.
export async function ensureUserRole(user) {
  if (!user) return user;
  const role = user?.user_metadata?.role || user?.app_metadata?.role;
  if (role) return user;
  const { data, error } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single();
  if (!error && data?.role) {
    return {
      ...user,
      user_metadata: { ...user.user_metadata, role: data.role },
    };
  }
  return user;
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
