import React, { createContext, useContext, useEffect, useState } from 'react';
import { getUser } from './oidc.js';

const AuthContext = createContext({ user: undefined, setUser: () => {} });

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined);

  useEffect(() => {
    getUser().then(setUser).catch(() => setUser(null));
  }, []);

  return (
    <AuthContext.Provider value={{ user, setUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

