import React, { useEffect, useState } from 'react';
import { supabase } from './supabaseClient.js';

export default function Confirm() {
  const [error, setError] = useState('');

  useEffect(() => {
    async function handleConfirm() {
      try {
        const url = new URL(window.location.href);
        const code = url.searchParams.get('code');
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
          url.searchParams.delete('code');
          window.history.replaceState({}, document.title, url.toString());
        }

        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();
        if (userError) throw userError;
        if (!user) throw new Error('User not found after confirmation');

        const { error: upsertError } = await supabase.from('users').upsert(
          {
            id: user.id,
            username: user.email,
            role:
              user?.user_metadata?.role ||
              user?.app_metadata?.role ||
              'user',
            tenant_id:
              user?.user_metadata?.tenant_id ||
              user?.app_metadata?.tenant_id ||
              null,
          },
          { onConflict: 'id' }
        );
        if (upsertError) throw upsertError;

        window.location.replace('/');
      } catch (err) {
        console.error('[Confirm] error', err);
        setError(err.message);
      }
    }
    handleConfirm();
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center">
      {error ? (
        <div className="text-center space-y-4">
          <h1 className="text-2xl font-medium">Confirmation failed</h1>
          <p className="text-sm text-neutral-600">{error}</p>
          <button onClick={() => (window.location.href = '/login')} className="bg-neutral-900 text-white rounded px-4 py-2">Go to login</button>
        </div>
      ) : (
        <div className="text-center space-y-4">
          <h1 className="text-2xl font-medium">Confirming...</h1>
          <p className="text-sm text-neutral-600">Please wait while we set up your account.</p>
        </div>
      )}
    </div>
  );
}
