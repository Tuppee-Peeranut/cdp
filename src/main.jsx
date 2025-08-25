import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import Login from './Login.jsx';
import Signup from './Signup.jsx';
import Confirm from './Confirm.jsx';
import SuperAdmin from './SuperAdmin.jsx';
import SuperAdminLogin from './SuperAdminLogin.jsx';
import './index.css';
import RoleGuard from './RoleGuard.jsx';
import { AuthProvider } from './AuthContext.jsx';

function Root() {
  const path = window.location.pathname;
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

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
