import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './index.css';
import RoleGuard from './RoleGuard.jsx';
import { AuthProvider } from './AuthContext.jsx';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <RoleGuard role="admin">
        <App />
      </RoleGuard>
    </AuthProvider>
  </React.StrictMode>
);
