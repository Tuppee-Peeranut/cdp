import React from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import Root from './Root.jsx';

// Vite's HTML template may use either `id="root"` or `id="app"` for the
// mounting container. Support both to avoid rendering a blank page when the
// expected element id changes.
const container =
  document.getElementById('root') || document.getElementById('app');

if (!container) {
  throw new Error('Root container missing. Expected #root or #app');
}

createRoot(container).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
