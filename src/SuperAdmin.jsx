import React, { useEffect, useState } from 'react';
import { supabase } from './supabaseClient.js';

export default function SuperAdmin() {
  const [token, setToken] = useState('');
  const [tenants, setTenants] = useState([]);
  const [tenantName, setTenantName] = useState('');
  const [selectedTenant, setSelectedTenant] = useState(null);
  const [users, setUsers] = useState([]);
  const [newUser, setNewUser] = useState({ email: '', password: '' });

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setToken(data.session?.access_token || '');
    });
  }, []);

  useEffect(() => {
    if (!token) return;
    fetch('/api/superadmin/tenants', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.json())
      .then((data) => setTenants(data || []));
  }, [token]);

  const addTenant = async () => {
    const res = await fetch('/api/superadmin/tenants', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ name: tenantName }),
    });
    if (res.ok) {
      const t = await res.json();
      setTenants((ts) => [...ts, t]);
      setTenantName('');
    }
  };

  const selectTenant = async (tenant) => {
    setSelectedTenant(tenant);
    const res = await fetch(`/api/superadmin/tenants/${tenant.id}/users`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    setUsers(data || []);
  };

  const addUser = async () => {
    const res = await fetch('/api/superadmin/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ ...newUser, tenantId: selectedTenant.id }),
    });
    if (res.ok) {
      const data = await res.json();
      setUsers((us) => [...us, data?.user || data]);
      setNewUser({ email: '', password: '' });
    }
  };

  return (
    <div className="p-4 flex gap-8">
      <div className="w-1/3">
        <h1 className="text-2xl font-medium mb-4">Tenants</h1>
        <ul className="mb-4 space-y-1">
          {tenants.map((t) => (
            <li key={t.id}>
              <button
                onClick={() => selectTenant(t)}
                className="underline"
              >
                {t.name}
              </button>
            </li>
          ))}
        </ul>
        <div className="space-y-2">
          <input
            type="text"
            placeholder="New tenant name"
            value={tenantName}
            onChange={(e) => setTenantName(e.target.value)}
            className="w-full border rounded px-2 py-1"
          />
          <button
            onClick={addTenant}
            className="w-full bg-neutral-900 text-white rounded py-1"
          >
            Add Tenant
          </button>
        </div>
      </div>
      <div className="flex-1">
        {selectedTenant ? (
          <div>
            <h2 className="text-xl font-medium mb-4">
              Users for {selectedTenant.name}
            </h2>
            <ul className="mb-4 space-y-1">
              {users.map((u) => (
                <li key={u.id}>{u.username || u.email}</li>
              ))}
            </ul>
            <div className="space-y-2">
              <input
                type="email"
                placeholder="User email"
                value={newUser.email}
                onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                className="w-full border rounded px-2 py-1"
              />
              <input
                type="password"
                placeholder="Password"
                value={newUser.password}
                onChange={(e) =>
                  setNewUser({ ...newUser, password: e.target.value })
                }
                className="w-full border rounded px-2 py-1"
              />
              <button
                onClick={addUser}
                className="w-full bg-neutral-900 text-white rounded py-1"
              >
                Add User
              </button>
            </div>
          </div>
        ) : (
          <p>Select a tenant to view users.</p>
        )}
      </div>
    </div>
  );
}
