import React from 'react';
import App from './App.jsx';
import Login from './Login.jsx';
import Signup from './Signup.jsx';
import Confirm from './Confirm.jsx';
import SuperAdmin from './SuperAdmin.jsx';
import SuperAdminLogin from './SuperAdminLogin.jsx';
import RoleGuard from './RoleGuard.jsx';
import { AuthProvider } from './AuthContext.jsx';
import User from './User.jsx';

function Root() {
  // Normalize the path by trimming any trailing slashes so that
  // `/superadmin` and `/superadmin/` are treated the same. Without this
  // normalization, redirects that include a trailing slash could fail to match
  // the intended route, leaving the user on the login screen.
  const path = window.location.pathname.replace(/\/+$/, '');
  if (path === '/login') {
    return (
      <AuthProvider>
        <Login />
      </AuthProvider>
    );
  }
  if (path === '/superadmin/login' || path === '/super-admin/login') {
    return (
      <AuthProvider>
        <SuperAdminLogin />
      </AuthProvider>
    );
  }
  if (path === '/signup') {
    return (
      <AuthProvider>
        <Signup />
      </AuthProvider>
    );
  }
  if (path === '/confirm') {
    return (
      <AuthProvider>
        <Confirm />
      </AuthProvider>
    );
  }
  if (path === '/user') {
    return (
      <AuthProvider>
        <RoleGuard role="user">
          <User />
        </RoleGuard>
      </AuthProvider>
    );
  }
  if (path === '/superadmin' || path === '/super-admin') {
    return (
      <AuthProvider>
        <RoleGuard role="super_admin">
          <SuperAdmin />
        </RoleGuard>
      </AuthProvider>
    );
  }
  return (
    <AuthProvider>
      <RoleGuard role="admin">
        <App />
      </RoleGuard>
    </AuthProvider>
  );
}

export default Root;

