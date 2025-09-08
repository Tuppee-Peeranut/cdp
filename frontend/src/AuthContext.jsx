import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from './supabaseClient.js';
import { ensureUserRole } from './auth.js';

// undefined represents the loading state before we know the current user
const AuthContext = createContext({ user: undefined, loading: true });

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    console.log('[AuthContext] initializing');
    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        const baseUser = error ? null : data?.session?.user ?? null;
        if (error && error.name !== 'AuthSessionMissingError') {
          console.error('[AuthContext] getSession error', error);
        } else if (!error) {
          console.log('[AuthContext] getSession', baseUser);
        }
        // Set the immediate session user so the UI can render without waiting
        // on any database lookups for role enrichment.
        if (isMounted) {
          setUser(baseUser);
          setLoading(false);
        }
        // Enrich the user in the background and update when ready.
        ensureUserRole(baseUser)
          .then((enriched) => {
            if (isMounted) setUser(enriched);
          })
          .catch((err) => {
            console.error('[AuthContext] ensureUserRole(getSession) error', err);
          });
      })
      .catch((err) => {
        console.error('[AuthContext] getSession unexpected error', err);
        if (isMounted) {
          setUser(null);
          setLoading(false);
        }
      });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('[AuthContext] auth state change', { event, session });
      const baseUser = session?.user ?? null;
      if (isMounted) {
        setUser(baseUser);
        setLoading(false);
      }
      ensureUserRole(baseUser)
        .then((enriched) => {
          if (isMounted) setUser(enriched);
        })
        .catch((err) => {
          console.error('[AuthContext] ensureUserRole(onAuthStateChange) error', err);
        });
    });
    return () => {
      isMounted = false;
      console.log('[AuthContext] unsubscribing');
      subscription.unsubscribe();
    };
  }, []);

  return <AuthContext.Provider value={{ user, loading }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
