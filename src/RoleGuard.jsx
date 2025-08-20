import React, { useEffect, useState } from 'react';
import { getUser } from './oidc.js';

export default function RoleGuard({ role, children }) {
  const [userRole, setUserRole] = useState(null);

  useEffect(() => {
    getUser().then(user => {
      setUserRole(user?.profile?.role || 'user');
    });
  }, []);

  if (userRole === null) {
    return null;
  }

  const allowed = Array.isArray(role) ? role : [role];
  if (allowed.length && !allowed.includes(userRole)) {
    return <div className="p-4 text-red-500">Access denied</div>;
  }

  return <>{children}</>;
}
