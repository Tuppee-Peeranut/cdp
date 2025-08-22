import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from './supabaseClient.js';

// undefined represents the loading state before we know the current user
const AuthContext = createContext({ user: undefined });

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined);

  useEffect(() => {
    console.log('[AuthContext] initializing');
    supabase.auth.getUser().then(({ data: { user }, error }) => {
      if (error) {
        console.error('[AuthContext] getUser error', error);
      } else {
        console.log('[AuthContext] getUser', user);
      }
      setUser(user);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('[AuthContext] auth state change', { event, session });
      setUser(session?.user ?? null);
    });
    return () => {
      console.log('[AuthContext] unsubscribing');
      subscription.unsubscribe();
    };
  }, []);

  return <AuthContext.Provider value={{ user }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
