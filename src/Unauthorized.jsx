import React, { useState } from 'react';
import { logout } from './auth.js';

export default function Unauthorized() {
  const [loading, setLoading] = useState(false);
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-md w-full border rounded-lg shadow-sm p-6 text-center">
        <h1 className="text-2xl font-semibold mb-2">Unauthorized</h1>
        <p className="text-sm text-neutral-600 mb-6">
          You don't have permission to access this page.
        </p>
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={async () => {
              if (loading) return;
              try {
                setLoading(true);
                await logout();
              } catch {}
              window.location.replace('/login');
            }}
            disabled={loading}
            className="px-4 py-2 rounded bg-neutral-900 text-white disabled:opacity-50"
          >
            {loading ? 'Signing out...' : 'Go to login'}
          </button>
        </div>
      </div>
    </div>
  );
}
