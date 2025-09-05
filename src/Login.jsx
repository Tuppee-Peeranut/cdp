import React, { useEffect, useState } from 'react';
import { login, ensureUserRole, logout } from './auth.js';
import { Loader2 } from 'lucide-react';
import { useAuth } from './AuthContext.jsx';

export default function Login() {
  const { user } = useAuth();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // If a user session already exists, redirect immediately to the main app.
  useEffect(() => {
    if (user) {
      window.location.href = '/';
    }
  }, [user]);

  if (user === undefined) {
    return (
      <div className="p-4 text-neutral-500">
        Loading...
      </div>
    );
  }

  if (user) return null;

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      handleSubmit(e);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;
    setError('');
    setLoading(true);
    try {
      const { data, error } = await login(form);
      if (error) {
        console.error('[Login] login error', error);
        if (
          error.message &&
          error.message.toLowerCase().includes('email not confirmed')
        ) {
          setError('Please verify your email before logging in.');
        } else {
          setError(error.message);
        }
      } else {
        const user = await ensureUserRole(data?.user);
        const role =
          user?.user_metadata?.role || user?.app_metadata?.role;
        if (role === 'super_admin') {
          await logout();
          setError('Please use the super admin login page.');
          return;
        }
        // All authenticated users land on the main application regardless of role.
        window.location.href = '/';
      }
    } catch (err) {
      console.error('[Login] unexpected error', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-white">
      {/* Top Navigation */}
      <nav className="flex items-center justify-between p-4">
        <div className="flex items-center gap-2">
          <div className="size-6 rounded-lg bg-emerald-200 grid place-items-center"><span className="text-emerald-700 text-xs">⚡</span></div>
          <div className="font-semibold">dP</div>
        </div>
        <a href="/docs" className="text-sm underline">Docs</a>
      </nav>

      {/* Hero */}
      <header className="px-6 md:px-10 lg:px-20 pt-8 pb-6 text-center">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-4xl md:text-6xl font-semibold tracking-tight leading-tight">
            The fastest platform for cleaning and shipping data
          </h1>
          <p className="mt-5 text-neutral-600 text-lg max-w-2xl mx-auto">
            Import. Chat. Generate rules. Version datasets. Move from raw → ready in minutes, not months.
          </p>
          {/* CTAs moved below login */}
        </div>
      </header>

      {/* Sign-in Card (moved up) */}
      <div id="signin" className="flex items-start justify-center p-6">
        <form onSubmit={handleSubmit} onKeyDown={handleKeyDown} className="w-full max-w-md space-y-4 border rounded-2xl p-6">
          <div className="text-center">
            <h3 className="text-2xl font-medium">Welcome back</h3>
            <p className="text-sm text-neutral-600 mt-1">Sign in to continue cleaning and shipping data.</p>
          </div>
          {error && <div className="text-sm text-red-500 text-center">{error}</div>}
          <input
            type="email"
            required
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            placeholder="Work email"
            className="w-full border rounded px-3 py-2"
          />
          <input
            type="password"
            required
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            placeholder="Password"
            className="w-full border rounded px-3 py-2"
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-neutral-900 text-white rounded py-2 flex items-center justify-center"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="sr-only">Signing in...</span>
              </>
            ) : (
              'Sign in'
            )}
          </button>
          <p className="text-sm text-center text-neutral-600">
            New to dP? <a href="/signup" className="underline">Create an account</a>
          </p>
          <p className="text-xs text-center text-neutral-500">By continuing you agree to our Terms and Privacy Policy.</p>
        </form>
      </div>

      

      {/* Post-signin highlights */}
      <section className="px-6 md:px-10 lg:px-20 py-12 text-center">
        <h2 className="text-2xl md:text-3xl font-medium">Access the power of our tools</h2>
        <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-neutral-100 px-3 py-1 text-sm">
          <span className="px-2 py-0.5 rounded-full bg-white border">Rules Engine</span>
          <span>Domain Versioning</span>
          <span>AI Chat</span>
          <span>APIs</span>
        </div>
        <div className="mt-8 grid md:grid-cols-2 gap-8 items-center max-w-5xl mx-auto">
          <div className="text-left md:pr-8">
            <h3 className="text-xl font-medium mb-2">Responses API</h3>
            <p className="text-sm text-neutral-600">
              A simple API for agents, combining AI chat with data tooling. Generate rules, profile data, and keep history with a single call.
            </p>
            <a href="/docs" className="text-sm underline mt-3 inline-block">Learn more</a>
          </div>
          <div className="rounded-2xl bg-neutral-100 h-64 grid place-items-center text-neutral-400 text-sm">
            <span>API code sample coming soon</span>
          </div>
        </div>
      </section>
    </div>
  );
}
