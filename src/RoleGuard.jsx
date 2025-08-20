import React from 'react';
import { useAuth } from './AuthContext.jsx';

export default function RoleGuard({ role, children }) {
  const { user } = useAuth();

  if (user === undefined) {
    return null;
  }

  const userRole = user?.profile?.role || 'user';
  const allowed = Array.isArray(role) ? role : [role];
  if (allowed.length && !allowed.includes(userRole)) {
    return <div className="p-4 text-red-500">Access denied</div>;
  }

  return <>{children}</>;
}
