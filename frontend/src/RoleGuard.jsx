import React from 'react';
import { useAuth } from './AuthContext.jsx';
// import { logout } from './auth.js';

export default function RoleGuard({ role, children }) {
  const { user, loading } = useAuth();

  if (loading || user === undefined) {
    console.log('[RoleGuard] user loading');
    return (
      <div className="p-4 text-neutral-500">
        Loading...
      </div>
    );
  }

  if (!user) {
    console.warn('[RoleGuard] no user, redirecting');
    // Avoid signing out here to prevent races immediately after sign-in.
    // Just redirect to the login page.
    window.location.replace('/login');
    return null;
  }

  const userRole =
    user?.user_metadata?.role || user?.app_metadata?.role || 'user';
  console.log('[RoleGuard] checking role', { required: role, userRole });
  const allowed = Array.isArray(role) ? role : [role];
  if (allowed.length && !allowed.includes(userRole)) {
    console.warn('[RoleGuard] access denied', { required: allowed, userRole });
    // Redirect to an Unauthorized landing page; don't logout since the user might
    // still be authorized for other areas.
    window.location.replace('/unauthorized');
    return null;
  }

  console.log('[RoleGuard] access granted', { userRole });
  return <>{children}</>;
}
