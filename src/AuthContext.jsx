import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from './supabaseClient.js';
import { ensureUserRole } from './auth.js';

// undefined represents the loading state before we know the current user
const AuthContext = createContext({ user: undefined });

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined);

  useEffect(() => {
    console.log('[AuthContext] initializing');
    supabase.auth.getUser().then(async ({ data, error }) => {
      const user = data?.user;
      if (error && error.name !== 'AuthSessionMissingError') {
        console.error('[AuthContext] getUser error', error);
      } else if (!error) {
        console.log('[AuthContext] getUser', user);
      }
      const enriched = await ensureUserRole(user);
      setUser(enriched);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('[AuthContext] auth state change', { event, session });
      const enriched = await ensureUserRole(session?.user ?? null);
      setUser(enriched);
    });
    return () => {
      console.log('[AuthContext] unsubscribing');
      subscription.unsubscribe();
    };
  }, []);

  return <AuthContext.Provider value={{ user }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
