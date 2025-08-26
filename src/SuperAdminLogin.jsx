import React, { useState } from 'react';
import { login, ensureUserRole, logout, signupSuperAdmin } from './auth.js';

const INVITE_CODE = import.meta.env.SUPERADMIN_INVITATION_CODE;

export default function SuperAdminLogin() {
  const [form, setForm] = useState({ email: '', password: '', code: '' });
  const [error, setError] = useState('');
  const [isSignup, setIsSignup] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const { data, error } = await login(form);
      if (error) {
        console.error('[SuperAdminLogin] login error', error);
        setError(error.message);
      } else {
        const user = await ensureUserRole(data?.user);
        const role = user?.user_metadata?.role || user?.app_metadata?.role;
        if (role !== 'super_admin') {
          await logout();
          setError('Access restricted to super admins.');
          return;
        }
        window.location.href = '/superadmin';
      }
    } catch (err) {
      console.error('[SuperAdminLogin] unexpected error', err);
      setError(err.message);
    }
  };

  const handleSignup = async (e) => {
    e.preventDefault();
    setError('');
    if (!INVITE_CODE || form.code !== INVITE_CODE) {
      setError('Invalid invitation code.');
      return;
    }
    try {
      const { error } = await signupSuperAdmin(form);
      if (error) {
        console.error('[SuperAdminSignup] signup error', error);
        setError(error.message);
      } else {
        setSuccess(true);
      }
    } catch (err) {
      console.error('[SuperAdminSignup] unexpected error', err);
      setError(err.message);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <nav className="flex items-center justify-between p-4 border-b border-neutral-200">
        <div className="font-semibold">dP</div>
      </nav>
      <div className="flex-grow flex items-center justify-center p-4">
        {isSignup ? (
          success ? (
            <div className="w-full max-w-sm space-y-4 text-center">
              <h1 className="text-2xl font-medium">Check your email</h1>
              <p className="text-sm text-neutral-600">
                We've sent a verification link to {form.email}. Please verify your
                account to continue.
              </p>
              <button
                onClick={() => {
                  setSuccess(false);
                  setIsSignup(false);
                }}
                className="w-full bg-neutral-900 text-white rounded py-2"
              >
                Go to login
              </button>
            </div>
          ) : (
            <form onSubmit={handleSignup} className="w-full max-w-sm space-y-4">
              <h1 className="text-2xl font-medium text-center">Super Admin Sign up</h1>
              {error && <div className="text-sm text-red-500 text-center">{error}</div>}
              <input
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="Email"
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
              <input
                type="text"
                required
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                placeholder="Invitation Code"
                className="w-full border rounded px-3 py-2"
              />
              <button type="submit" className="w-full bg-neutral-900 text-white rounded py-2">
                Sign up
              </button>
              <p className="text-sm text-center text-neutral-600">
                Already have an account?{' '}
                <button
                  type="button"
                  onClick={() => {
                    setIsSignup(false);
                    setError('');
                  }}
                  className="underline"
                >
                  Sign in
                </button>
              </p>
            </form>
          )
        ) : (
          <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4">
            <h1 className="text-2xl font-medium text-center">Super Admin Sign in</h1>
            {error && <div className="text-sm text-red-500 text-center">{error}</div>}
            <input
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="Email"
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
            <button type="submit" className="w-full bg-neutral-900 text-white rounded py-2">
              Sign in
            </button>
            <p className="text-sm text-center text-neutral-600">
              Need an account?{' '}
              <button
                type="button"
                onClick={() => {
                  setIsSignup(true);
                  setError('');
                }}
                className="underline"
              >
                Sign up
              </button>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
