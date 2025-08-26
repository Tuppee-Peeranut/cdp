import React, { useEffect, useState } from 'react';
import { supabase } from './supabaseClient.js';

export default function SuperAdmin() {
  const [token, setToken] = useState('');
  const [tenants, setTenants] = useState([]);
  const [tenantName, setTenantName] = useState('');
  const [selectedTenant, setSelectedTenant] = useState(null);
  const [users, setUsers] = useState([]);
  const [newUser, setNewUser] = useState({ email: '', password: '' });
  const [loadingTenants, setLoadingTenants] = useState(false);
  const [tenantsError, setTenantsError] = useState('');
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [usersError, setUsersError] = useState('');
  const [addingTenant, setAddingTenant] = useState(false);
  const [addTenantError, setAddTenantError] = useState('');
  const [addingUser, setAddingUser] = useState(false);
  const [addUserError, setAddUserError] = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setToken(data.session?.access_token || '');
    });
  }, []);

  useEffect(() => {
    if (!token) return;
    fetchTenants();
  }, [token]);

  const fetchTenants = async () => {
    setLoadingTenants(true);
    setTenantsError('');
    try {
      const res = await fetch('/api/superadmin/tenants', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setTenants(data || []);
    } catch (err) {
      setTenantsError('Failed to load tenants. Please try again.');
    } finally {
      setLoadingTenants(false);
    }
  };

  const addTenant = async () => {
    setAddingTenant(true);
    setAddTenantError('');
    try {
      const res = await fetch('/api/superadmin/tenants', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name: tenantName }),
      });
      if (!res.ok) throw new Error();
      const t = await res.json();
      setTenants((ts) => [...ts, t]);
      setTenantName('');
    } catch (err) {
      setAddTenantError('Failed to add tenant. Please try again.');
    } finally {
      setAddingTenant(false);
    }
  };

  const selectTenant = (tenant) => {
    setSelectedTenant(tenant);
    fetchUsers(tenant);
  };

  const fetchUsers = async (tenant) => {
    setLoadingUsers(true);
    setUsersError('');
    try {
      const res = await fetch(`/api/superadmin/tenants/${tenant.id}/users`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setUsers(data || []);
    } catch (err) {
      setUsersError('Failed to load users. Please try again.');
      setUsers([]);
    } finally {
      setLoadingUsers(false);
    }
  };

  const addUser = async () => {
    if (!selectedTenant) return;
    setAddingUser(true);
    setAddUserError('');
    try {
      const res = await fetch('/api/superadmin/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ ...newUser, tenantId: selectedTenant.id }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setUsers((us) => [...us, data?.user || data]);
      setNewUser({ email: '', password: '' });
    } catch (err) {
      setAddUserError('Failed to add user. Please try again.');
    } finally {
      setAddingUser(false);
    }
  };

  return (
    <div className="p-4 flex gap-8">
      <div className="w-1/3">
        <h1 className="text-2xl font-medium mb-4">Tenants</h1>
        {loadingTenants ? (
          <p>Loading tenants...</p>
        ) : tenantsError ? (
          <div className="mb-4 space-y-1">
            <p>{tenantsError}</p>
            <button onClick={fetchTenants} className="underline">
              Retry
            </button>
          </div>
        ) : (
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
        )}
        <div className="space-y-2">
          <input
            type="text"
            placeholder="New tenant name"
            value={tenantName}
            onChange={(e) => setTenantName(e.target.value)}
            className="w-full border rounded px-2 py-1"
          />
          {addTenantError && (
            <p className="text-red-600">{addTenantError}</p>
          )}
          <button
            onClick={addTenant}
            disabled={addingTenant}
            className="w-full bg-neutral-900 text-white rounded py-1 disabled:opacity-50"
          >
            {addingTenant ? 'Adding...' : 'Add Tenant'}
          </button>
        </div>
      </div>
      <div className="flex-1">
        {selectedTenant ? (
          <div>
            <h2 className="text-xl font-medium mb-4">
              Users for {selectedTenant.name}
            </h2>
            {loadingUsers ? (
              <p>Loading users...</p>
            ) : usersError ? (
              <div className="mb-4 space-y-1">
                <p>{usersError}</p>
                <button
                  onClick={() => fetchUsers(selectedTenant)}
                  className="underline"
                >
                  Retry
                </button>
              </div>
            ) : (
              <ul className="mb-4 space-y-1">
                {users.map((u) => (
                  <li key={u.id}>{u.username || u.email}</li>
                ))}
              </ul>
            )}
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
              {addUserError && (
                <p className="text-red-600">{addUserError}</p>
              )}
              <button
                onClick={addUser}
                disabled={addingUser}
                className="w-full bg-neutral-900 text-white rounded py-1 disabled:opacity-50"
              >
                {addingUser ? 'Adding...' : 'Add User'}
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
