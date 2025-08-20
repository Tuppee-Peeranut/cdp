import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './index.css';
import { handleCallback } from './oidc.js';
import RoleGuard from './RoleGuard.jsx';

if (window.location.pathname === '/auth/callback') {
  handleCallback().then(() => {
    window.location.replace('/');
  });
} else {
  createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <RoleGuard role="admin">
        <App />
      </RoleGuard>
    </React.StrictMode>
  );
}
