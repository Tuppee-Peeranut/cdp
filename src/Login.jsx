import React, { useState } from 'react';
import { login } from './auth.js';

export default function Login() {
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const { error } = await login(form);
    if (error) setError(error.message);
    else window.location.href = '/';
  };

  return (
    <div className="min-h-screen flex flex-col">
      <nav className="flex items-center justify-between p-4 border-b border-neutral-200">
        <div className="font-semibold">dP</div>
        <a href="/signup" className="underline">Sign up</a>
      </nav>
      <div className="flex-grow flex items-center justify-center p-4">
        <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4">
          <h1 className="text-2xl font-medium text-center">Sign in</h1>
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
            Don't have an account?{' '}
            <a href="/signup" className="underline">
              Sign up
            </a>
          </p>
        </form>
      </div>
    </div>
  );
}
