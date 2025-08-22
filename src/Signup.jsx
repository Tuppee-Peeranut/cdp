import React, { useState } from 'react';
import { signup } from './auth.js';

export default function Signup() {
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    console.log('[Signup] form submit', { email: form.email });
    setError('');
    try {
      const { data, error } = await signup(form);
      console.log('[Signup] signup response', { data, error });
      if (error) {
        console.error('[Signup] signup error', error);
        setError(error.message);
      } else {
        setSuccess(true);
      }
    } catch (err) {
      console.error('[Signup] unexpected error', err);
      setError(err.message);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <nav className="flex items-center justify-between p-4 border-b border-neutral-200">
        <div className="font-semibold">dP</div>
        <a href="/login" className="underline">Sign in</a>
      </nav>
      <div className="flex-grow flex items-center justify-center p-4">
        {success ? (
          <div className="w-full max-w-sm space-y-4 text-center">
            <h1 className="text-2xl font-medium">Check your email</h1>
            <p className="text-sm text-neutral-600">
              We've sent a verification link to {form.email}. Please verify your
              account to continue.
            </p>
            <button
              onClick={() => (window.location.href = '/login')}
              className="w-full bg-neutral-900 text-white rounded py-2"
            >
              Go to login
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4">
            <h1 className="text-2xl font-medium text-center">Create account</h1>
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
              Sign up
            </button>
            <p className="text-sm text-center text-neutral-600">
              Already have an account?{' '}
              <a href="/login" className="underline">
                Login
              </a>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
