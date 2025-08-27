import React from 'react';
import { useAuth } from './AuthContext.jsx';
import { logout } from './auth.js';

export default function RoleGuard({ role, children }) {
  const { user } = useAuth();

  if (user === undefined) {
    console.log('[RoleGuard] user loading');
    return (
      <div className="p-4 text-neutral-500">
        Loading...
      </div>
    );
  }

  if (!user) {
    console.warn('[RoleGuard] no user, redirecting');
    // Fire-and-forget logout so we don't block redirect on network latency.
    // Waiting for the promise could leave the UI stuck in a loading state
    // if the sign-out request is slow or fails. Redirect immediately.
    logout();
    window.location.href = '/login';
    return null;
  }

  const userRole =
    user?.user_metadata?.role || user?.app_metadata?.role || 'user';
  console.log('[RoleGuard] checking role', { required: role, userRole });
  const allowed = Array.isArray(role) ? role : [role];
  if (allowed.length && !allowed.includes(userRole)) {
    console.warn('[RoleGuard] access denied', { required: allowed, userRole });
    return <div className="p-4 text-red-500">Access denied</div>;
  }

  console.log('[RoleGuard] access granted', { userRole });
  return <>{children}</>;
}
