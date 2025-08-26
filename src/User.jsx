import React from 'react';
import { useAuth } from './AuthContext.jsx';
import { logout } from './auth.js';

export default function User() {
  const { user } = useAuth();
  return (
    <div className="p-4 space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-medium">User Dashboard</h1>
        <button onClick={logout} className="underline">Log out</button>
      </header>
      <p>Welcome, {user?.email}</p>
    </div>
  );
}
