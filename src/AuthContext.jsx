import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from './supabaseClient.js';
import { ensureUserRole } from './auth.js';

// undefined represents the loading state before we know the current user
const AuthContext = createContext({ user: undefined });

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined);

  useEffect(() => {
    let isMounted = true;
    console.log('[AuthContext] initializing');
    supabase.auth
      .getSession()
      .then(async ({ data, error }) => {
        let user = error ? null : data?.session?.user ?? null;
        if (error && error.name !== 'AuthSessionMissingError') {
          console.error('[AuthContext] getSession error', error);
        } else if (!error) {
          console.log('[AuthContext] getSession', user);
        }
        const enriched = await ensureUserRole(user);
        if (isMounted) setUser(enriched);
      })
      .catch((err) => {
        console.error('[AuthContext] getSession unexpected error', err);
        if (isMounted) setUser(null);
      });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('[AuthContext] auth state change', { event, session });
      const enriched = await ensureUserRole(session?.user ?? null);
      if (isMounted) setUser(enriched);
    });
    return () => {
      isMounted = false;
      console.log('[AuthContext] unsubscribing');
      subscription.unsubscribe();
    };
  }, []);

  return <AuthContext.Provider value={{ user }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
