import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from './supabaseClient.js';
import { logout } from './auth.js';
import AuditLogs from './components/AuditLogs.jsx';
import {
  Zap,
  RefreshCw,
  Plus,
  Search,
  Trash2,
  Check,
  X,
  LogOut,
  Shield,
  Save,
  User as UserIcon,
  KeyRound,
  Upload,
  HelpCircle,
} from 'lucide-react';

export default function SuperAdmin() {
  const [token, setToken] = useState('');
  const [tenants, setTenants] = useState([]);
  const [tenantName, setTenantName] = useState('');
  const [selectedTenant, setSelectedTenant] = useState(null);
  const [users, setUsers] = useState([]);
  const [newUser, setNewUser] = useState({ email: '', password: '' });
  const [newUserRole, setNewUserRole] = useState('user');
  const [loadingTenants, setLoadingTenants] = useState(false);
  const [tenantsError, setTenantsError] = useState('');
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [usersError, setUsersError] = useState('');
  const [addingTenant, setAddingTenant] = useState(false);
  const [addTenantError, setAddTenantError] = useState('');
  const [addingUser, setAddingUser] = useState(false);
  const [addUserError, setAddUserError] = useState('');
  const [renamingTenantId, setRenamingTenantId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [deletingTenantId, setDeletingTenantId] = useState(null);
  const [search, setSearch] = useState('');
  const [showUserMenu, setShowUserMenu] = useState(false);
  const menuRef = useRef(null);
  const avatarInputRef = useRef(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [me, setMe] = useState(null);
  const [toasts, setToasts] = useState([]);
  const RESOURCES = ['dashboard', 'domain', 'rules'];
  const [policies, setPolicies] = useState({
    user: RESOURCES.reduce((acc, r) => ({ ...acc, [r]: { can_create: false, can_update: false, can_delete: false } }), {}),
    admin: RESOURCES.reduce((acc, r) => ({ ...acc, [r]: { can_create: false, can_update: false, can_delete: false } }), {}),
  });
  const AVAILABLE_PAGES = ['customers', 'products', 'settings'];
  const PLANS = ['pro', 'enterprise'];
  const PERIODS = [6, 12, 18, 24];

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setToken(data.session?.access_token || '');
      setMe(data.session?.user || null);
    });
    const { data } = supabase.auth.onAuthStateChange((_e, session) => {
      setToken(session?.access_token || '');
      setMe(session?.user || null);
    });
    return () => data?.subscription?.unsubscribe?.();
  }, []);

  useEffect(() => {
    if (!token) return;
    fetchTenants();
  }, [token]);

  useEffect(() => {
    if (!token) return;
    // prefetch access policies for common roles when tenant is selected
    if (selectedTenant) {
      Promise.all(['user', 'admin'].map(fetchAccessPolicies)).catch(() => {});
    }
  }, [token, selectedTenant]);

  const fetchTenants = async () => {
    setLoadingTenants(true);
    setTenantsError('');
    try {
      const res = await fetch('/api/superadmin/tenants', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const msg = await safeError(res);
        throw new Error(msg);
      }
      const data = await res.json();
      setTenants(data || []);
      toast('Tenants loaded');
    } catch (err) {
      setTenantsError(err.message || 'Failed to load tenants.');
      toast(err.message || 'Failed to load tenants', 'danger');
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
      if (!res.ok) {
        const msg = await safeError(res);
        throw new Error(msg);
      }
      const t = await res.json();
      setTenants((ts) => [...ts, t]);
      setTenantName('');
      toast('Tenant added', 'success');
    } catch (err) {
      setAddTenantError(err.message || 'Failed to add tenant.');
      toast(err.message || 'Failed to add tenant', 'danger');
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
      if (!res.ok) {
        const msg = await safeError(res);
        throw new Error(msg);
      }
      const data = await res.json();
      // Normalize for UI: derive disabled flag from status
      setUsers((data || []).map((u) => ({
        ...u,
        disabled: (u.status || 'active') === 'disabled',
      })));
      toast('Users loaded');
    } catch (err) {
      setUsersError(err.message || 'Failed to load users.');
      toast(err.message || 'Failed to load users', 'danger');
      setUsers([]);
    } finally {
      setLoadingUsers(false);
    }
  };

  const addUser = async () => {
    if (!selectedTenant) return;
    if (!validateEmail(newUser.email)) {
      setAddUserError('Valid email required');
      return;
    }
    if (!validateStrongPassword(newUser.password)) {
      setAddUserError('Password must be 8+ chars with upper, lower, number and symbol');
      return;
    }
    setAddingUser(true);
    setAddUserError('');
    try {
      const res = await fetch('/api/superadmin/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ ...newUser, tenantId: selectedTenant.id, role: newUserRole }),
      });
      if (!res.ok) {
        const msg = await safeError(res);
        throw new Error(msg);
      }
      const data = await res.json();
      setUsers((us) => [...us, { ...(data?.user || data), disabled: false }]);
      setNewUser({ email: '', password: '' });
      setNewUserRole('user');
      toast('User added', 'success');
    } catch (err) {
      setAddUserError(err.message || 'Failed to add user.');
      toast(err.message || 'Failed to add user', 'danger');
    } finally {
      setAddingUser(false);
    }
  };

  const renameTenant = async (tenantId) => {
    try {
      const res = await fetch(`/api/superadmin/tenants/${tenantId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: renameValue }),
      });
      if (!res.ok) {
        const msg = await safeError(res);
        throw new Error(msg);
      }
      const updated = await res.json();
      setTenants((ts) => ts.map((t) => (t.id === tenantId ? updated : t)));
      setRenamingTenantId(null);
      if (selectedTenant?.id === tenantId) setSelectedTenant(updated);
    } catch (err) {
      toast(err.message || 'Failed to rename tenant', 'danger');
    }
  };

  // Tenant details edit state
  const [tenantForm, setTenantForm] = useState({
    active_plan: 'pro',
    trial: true,
    subscription_start: '',
    subscription_end: '',
    subscription_active: false,
    subscription_period_months: '',
    trial_days: 7,
    settings: {},
  });

  useEffect(() => {
    if (!selectedTenant) return;
    setTenantForm({
      active_plan: selectedTenant.active_plan || 'pro',
      trial: !!selectedTenant.trial,
      subscription_start: selectedTenant.subscription_start || '',
      subscription_end: selectedTenant.subscription_end || '',
      subscription_active: !!selectedTenant.subscription_active,
      subscription_period_months: selectedTenant.subscription_period_months || '',
      trial_days: selectedTenant.trial_days || 7,
      settings: selectedTenant.settings || {},
    });
  }, [selectedTenant]);

  const persistTenantForm = async () => {
    if (!selectedTenant) return;
    try {
      const payload = {
        active_plan: tenantForm.active_plan,
        subscription_start: tenantForm.subscription_start || null,
        subscription_end: tenantForm.subscription_end || null,
        subscription_active: !!tenantForm.subscription_active,
        subscription_period_months: tenantForm.subscription_period_months || null,
        trial: !!tenantForm.trial,
        trial_days: tenantForm.trial ? (tenantForm.trial_days || 7) : null,
        settings: tenantForm.settings || {},
      };
      const res = await fetch(`/api/superadmin/tenants/${selectedTenant.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await safeError(res));
      const data = await res.json();
      setSelectedTenant(data);
      setTenants((ts) => ts.map((t) => (t.id === data.id ? data : t)));
      toast('Tenant updated', 'success');
    } catch (e) {
      toast(e.message || 'Failed to update tenant', 'danger');
    }
  };

  const extendSubscription = (days = 30) => {
    const start = tenantForm.subscription_start ? new Date(tenantForm.subscription_start) : new Date();
    const end = tenantForm.subscription_end ? new Date(tenantForm.subscription_end) : new Date(start);
    end.setDate(end.getDate() + days);
    setTenantForm((f) => ({ ...f, subscription_end: end.toISOString() }));
  };

  // subscription helpers
  function addMonths(iso, months) {
    try {
      const d = new Date(iso);
      const y = d.getUTCFullYear();
      const m = d.getUTCMonth();
      const day = d.getUTCDate();
      const nd = new Date(Date.UTC(y, m + Number(months), day, d.getUTCHours(), d.getUTCMinutes()));
      return nd.toISOString();
    } catch {
      return '';
    }
  }
  function addDays(iso, days) {
    try {
      const d = new Date(iso);
      d.setUTCDate(d.getUTCDate() + Number(days));
      return d.toISOString();
    } catch {
      return '';
    }
  }
  function prettyDate(iso) {
    if (!iso) return '';
    try { return new Date(iso).toLocaleString(); } catch { return iso; }
  }

  const deleteTenant = async (tenantId) => {
    if (!confirm('Delete this tenant? This cannot be undone.')) return;
    setDeletingTenantId(tenantId);
    try {
      const res = await fetch(`/api/superadmin/tenants/${tenantId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const msg = await safeError(res);
        throw new Error(msg);
      }
      setTenants((ts) => ts.filter((t) => t.id !== tenantId));
      if (selectedTenant?.id === tenantId) {
        setSelectedTenant(null);
        setUsers([]);
      }
      toast('Tenant deleted', 'success');
    } catch (err) {
      toast(err.message || 'Failed to delete tenant', 'danger');
    } finally {
      setDeletingTenantId(null);
    }
  };

  const changeUserRole = async (userId, role) => {
    try {
      const res = await fetch(`/api/superadmin/users/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ role }),
      });
      if (!res.ok) {
        const msg = await safeError(res);
        throw new Error(msg);
      }
      setUsers((us) => us.map((u) => (u.id === userId ? { ...u, role } : u)));
    } catch (err) {
      toast(err.message || 'Failed to update role', 'danger');
    }
  };

  const resetUserPassword = async (userId) => {
    const pwd = window.prompt('Enter a strong temporary password');
    if (!pwd) return;
    if (!validateStrongPassword(pwd)) {
      alert('Password must be 8+ chars with upper, lower, number and symbol');
      return;
    }
    try {
      const res = await fetch(`/api/superadmin/users/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ password: pwd }),
      });
      if (!res.ok) {
        const msg = await safeError(res);
        throw new Error(msg);
      }
      toast('Password updated', 'success');
    } catch (err) {
      toast(err.message || 'Failed to update password', 'danger');
    }
  };

  const disableUser = async (userId) => {
    if (!confirm('Disable this user?')) return;
    try {
      const res = await fetch(`/api/superadmin/users/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ disabled: true }),
      });
      if (!res.ok) throw new Error(await safeError(res));
      setUsers((us) => us.map((u) => (u.id === userId ? { ...u, disabled: true, status: 'disabled' } : u)));
      toast('User disabled', 'neutral');
    } catch (err) {
      toast(err.message || 'Failed to disable user', 'danger');
    }
  };

  const enableUser = async (userId) => {
    try {
      const res = await fetch(`/api/superadmin/users/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ disabled: false }),
      });
      if (!res.ok) throw new Error(await safeError(res));
      setUsers((us) => us.map((u) => (u.id === userId ? { ...u, disabled: false, status: 'active' } : u)));
      toast('User enabled', 'success');
    } catch (err) {
      toast(err.message || 'Failed to enable user', 'danger');
    }
  };

  async function fetchAccessPolicies(role) {
    try {
      const res = await fetch(`/api/superadmin/policies/${role}?tenantId=${selectedTenant?.id || ''}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(await safeError(res));
      const items = await res.json();
      const map = RESOURCES.reduce((acc, r) => ({ ...acc, [r]: { can_create: false, can_update: false, can_delete: false } }), {});
      items.forEach((it) => { map[it.resource] = { can_create: !!it.can_create, can_update: !!it.can_update, can_delete: !!it.can_delete }; });
      setPolicies((p) => ({ ...p, [role]: map }));
    } catch (e) { /* ignore */ }
  }
  async function saveAccessPolicies(role) {
    try {
      const items = RESOURCES.map((r) => ({ resource: r, ...policies[role][r] }));
      const res = await fetch(`/api/superadmin/policies/${role}?tenantId=${selectedTenant?.id || ''}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ items }),
      });
      if (!res.ok) throw new Error(await safeError(res));
      toast(`Policies saved for ${role}`, 'success');
    } catch (e) {
      toast(e.message || 'Failed to save policies', 'danger');
    }
  }

  // Toast helpers
  function toast(message, tone = 'neutral') {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const icon = tone === 'success' ? '🎉' : tone === 'danger' ? '⚠️' : '✨';
    setToasts((ts) => [...ts, { id, message, tone, icon }]);
    setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), 2600);
  }

  async function handleAvatarUpload(file) {
    if (!file || !me?.id) return;
    try {
      setUploadingAvatar(true);
      const bucket = 'avatars';
      // Ensure bucket exists (server uses service key)
      try {
        const t = token || (await supabase.auth.getSession()).data?.session?.access_token;
        await fetch('/api/storage/ensure-bucket', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
          body: JSON.stringify({ name: bucket, public: true }),
        });
      } catch (_) {}
      const path = `${me.id}/${Date.now()}_${file.name}`;
      const { error: upErr } = await supabase.storage.from(bucket).upload(path, file, { upsert: true, cacheControl: '3600' });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from(bucket).getPublicUrl(path);
      const publicUrl = pub?.publicUrl;
      if (!publicUrl) throw new Error('Failed to get public URL');
      await supabase.auth.updateUser({ data: { avatar_url: publicUrl } });
      await supabase.from('users').update({ profile_url: publicUrl }).eq('id', me.id);
      setMe((u) => (u ? { ...u, user_metadata: { ...u.user_metadata, avatar_url: publicUrl } } : u));
      toast('Profile photo updated', 'success');
    } catch (e) {
      console.error('avatar upload error', e);
      toast(e.message || 'Upload failed', 'danger');
    } finally {
      setUploadingAvatar(false);
    }
  }

  useEffect(() => {
    const onDocClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setShowUserMenu(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const filteredTenants = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tenants;
    return tenants.filter((t) => t.name.toLowerCase().includes(q));
  }, [tenants, search]);

  function validateEmail(value) {
    return /[^\s@]+@[^\s@]+\.[^\s@]+/.test(value);
  }
  function validateStrongPassword(value) {
    return (
      typeof value === 'string' &&
      value.length >= 8 &&
      /[a-z]/.test(value) &&
      /[A-Z]/.test(value) &&
      /[0-9]/.test(value) &&
      /[^A-Za-z0-9]/.test(value)
    );
  }
  async function safeError(res) {
    try {
      const body = await res.json();
      return body?.error || body?.errors?.map?.((e) => e.msg).join(', ') || res.statusText;
    } catch {
      return res.statusText;
    }
  }

  function toLocalInputValue(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      const off = d.getTimezoneOffset();
      const local = new Date(d.getTime() - off * 60 * 1000);
      return local.toISOString().slice(0, 16);
    } catch {
      return '';
    }
  }
  function toIso(localStr) {
    if (!localStr) return '';
    try {
      const d = new Date(localStr);
      return d.toISOString();
    } catch {
      return '';
    }
  }

  function sampleSettings() {
    return {
      features: {
        beta_access: false,
        seats: 5,
      },
      branding: {
        primary_color: '#10b981',
        logo_url: 'https://example.com/logo.png',
      },
      notifications: {
        billing_email: 'billing@example.com',
      },
    };
  }

  function daysUntil(iso) {
    try {
      const end = new Date(iso).getTime();
      const now = Date.now();
      const diff = Math.max(0, end - now);
      return Math.ceil(diff / (1000 * 60 * 60 * 24));
    } catch {
      return null;
    }
  }

  return (
    <div className="min-h-[calc(100vh-3rem)] flex flex-col">
      {/* Header */}
      <div className="h-12 border-b border-neutral-200 flex items-center justify-between px-4 md:px-6 lg:px-8 sticky top-0 bg-white/80 backdrop-blur z-40">
        <div className="flex items-center gap-3">
          <div className="size-6 rounded-lg bg-emerald-200 grid place-items-center">
            <Zap size={14} className="text-emerald-700" />
          </div>
          <div className="font-semibold">dP</div>
          <span className="text-neutral-400">/</span>
          <div className="text-sm text-neutral-700">Super Admin</div>
        </div>
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setShowUserMenu((s) => !s)}
            className="w-8 h-8 rounded-full bg-neutral-200 overflow-hidden flex items-center justify-center"
            aria-label="Account menu"
          >
            {me?.user_metadata?.avatar_url ? (
              <img src={me.user_metadata.avatar_url} alt="profile" className="w-full h-full object-cover" />
            ) : (
              me?.email ? (
                <span className="text-sm font-medium text-neutral-600">{me.email[0]?.toUpperCase()}</span>
              ) : (
                <UserIcon size={16} className="text-neutral-700" />
              )
            )}
          </button>
          {showUserMenu && (
            <div className="absolute right-0 mt-2 w-56 bg-white rounded-md shadow-lg border border-neutral-200 text-neutral-700 z-50">
              <div className="p-4 border-b border-neutral-200 flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-neutral-300 overflow-hidden flex items-center justify-center">
                  {me?.user_metadata?.avatar_url ? (
                    <img src={me.user_metadata.avatar_url} alt="profile" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-sm font-medium text-neutral-600">{me?.email?.[0]?.toUpperCase()}</span>
                  )}
                </div>
                <div>
                  <div className="text-sm font-medium">{me?.user_metadata?.full_name ?? me?.email}</div>
                  <div className="text-xs text-neutral-500">{me?.email}</div>
                </div>
              </div>
              <div className="py-1 border-b border-neutral-200">
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleAvatarUpload(f);
                    e.target.value = '';
                  }}
                />
                <button
                  onClick={() => avatarInputRef.current?.click()}
                  disabled={uploadingAvatar}
                  className="w-full text-left px-4 py-2 text-sm hover:bg-neutral-100 flex items-center gap-2 disabled:opacity-50"
                >
                  <Upload size={14} />
                  {uploadingAvatar ? 'Uploading...' : 'Upload Photo'}
                </button>
              </div>
              <div className="py-1">
                <button
                  onClick={async () => {
                    setShowUserMenu(false);
                    await logout();
                    window.location.replace('/login');
                  }}
                  className="w-full text-left px-4 py-2 text-sm hover:bg-neutral-100 text-red-600 flex items-center gap-2"
                >
                  <LogOut size={14} />
                  Logout
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 px-4 md:px-6 lg:px-8 py-4 flex gap-6">
      {/* Left: Tenants list */}
      <aside className="w-[320px] shrink-0">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-xl font-semibold">Tenants</h1>
          <button onClick={fetchTenants} className="p-2 rounded-lg hover:bg-neutral-100" title="Refresh">
            <RefreshCw size={16} />
          </button>
        </div>
        <div className="mb-3 flex items-center gap-2">
          <input
            type="text"
            placeholder="Search tenants..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 border rounded px-2 py-1"
          />
          <Search size={16} className="text-neutral-400" />
        </div>
        {loadingTenants ? (
          <div className="p-3 text-neutral-500">Loading tenants...</div>
        ) : tenantsError ? (
          <div className="mb-4 space-y-1 text-red-600">
            <p>{tenantsError}</p>
            <button onClick={fetchTenants} className="underline">Retry</button>
          </div>
        ) : (
          <ul className="mb-4 border rounded divide-y">
            {filteredTenants.map((t) => (
              <li key={t.id} className={`flex items-center justify-between px-3 py-2 ${selectedTenant?.id === t.id ? 'bg-neutral-100' : ''}`}>
                {renamingTenantId === t.id ? (
                  <div className="flex-1 flex items-center gap-2">
                    <input
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      className="flex-1 border rounded px-1 py-0.5"
                      placeholder="New name"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') renameTenant(t.id);
                        if (e.key === 'Escape') setRenamingTenantId(null);
                      }}
                    />
                    <button onClick={() => renameTenant(t.id)} className="p-1 hover:bg-neutral-100 rounded" title="Save">
                      <Check size={14} />
                    </button>
                    <button onClick={() => setRenamingTenantId(null)} className="p-1 hover:bg-neutral-100 rounded" title="Cancel">
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      if (selectedTenant?.id === t.id) {
                        setRenamingTenantId(t.id);
                        setRenameValue(t.name);
                      } else {
                        selectTenant(t);
                      }
                    }}
                    className="flex-1 text-left underline decoration-dotted"
                    title={selectedTenant?.id === t.id ? 'Click to rename' : 'Click to select'}
                  >
                    {t.name}
                  </button>
                )}
                <div className="flex items-center gap-2 text-xs">
                  {(!t.trial && !t.subscription_active && t.active_plan) && (
                    <span className="px-2 py-0.5 rounded-full border bg-neutral-50 text-neutral-700" title={`Plan: ${t.active_plan}`}>
                      {t.active_plan}
                    </span>
                  )}
                  {(t.trial && (t.trial_days || selectedTenant?.trial_days)) ? (
                    <span
                      className="px-2 py-0.5 rounded-full border bg-amber-50 text-amber-700"
                      title={t.subscription_end ? `Ends ${new Date(t.subscription_end).toLocaleString()}` : 'Trial'}
                    >
                      Trial {t.trial_days || 7}d
                    </span>
                  ) : t.subscription_active && t.subscription_period_months ? (
                    <span
                      className="px-2 py-0.5 rounded-full border bg-emerald-50 text-emerald-700"
                      title={t.subscription_end ? `Ends ${new Date(t.subscription_end).toLocaleString()}` : 'Subscription'}
                    >
                      Sub {t.subscription_period_months}m
                    </span>
                  ) : null}
                  {t.subscription_end && (
                    <HelpCircle
                      size={14}
                      className="text-neutral-400"
                      title={`Ends in ${daysUntil(t.subscription_end)} days`}
                      aria-label={`Ends in ${daysUntil(t.subscription_end)} days`}
                    />
                  )}
                  <button
                    disabled={deletingTenantId === t.id}
                    onClick={() => deleteTenant(t.id)}
                    className="p-1 rounded hover:bg-neutral-100 disabled:opacity-50"
                    title="Delete"
                    aria-label="Delete"
                  >
                    <Trash2 size={14} className="text-red-600" />
                  </button>
                </div>
              </li>
            ))}
            {filteredTenants.length === 0 && (
              <li className="px-3 py-2 text-sm text-neutral-500">No tenants found</li>
            )}
          </ul>
        )}

        <div className="space-y-2">
          <div className="relative">
            <input
              type="text"
              placeholder="New tenant name"
              value={tenantName}
              onChange={(e) => setTenantName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && tenantName.trim() && !addingTenant) addTenant();
              }}
              className="w-full border rounded px-2 pr-8 py-1"
            />
            <button
              onClick={addTenant}
              disabled={addingTenant || !tenantName.trim()}
              className="absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-neutral-100 disabled:opacity-50"
              title="Add tenant"
              aria-label="Add tenant"
            >
              {addingTenant ? (
                <RefreshCw size={14} className="animate-spin" />
              ) : (
                <Plus size={14} />
              )}
            </button>
          </div>
        </div>
      </aside>

      {/* Right: Users of selected tenant */}
      <main className="flex-1">
        {selectedTenant ? (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-medium">Users · {selectedTenant.name}</h2>
              <button onClick={() => fetchUsers(selectedTenant)} className="p-2 rounded-lg hover:bg-neutral-100" title="Refresh">
                <RefreshCw size={16} />
              </button>
            </div>

            {/* Tenant details */}
            <div className="mb-4 border rounded">
              <div className="px-3 py-2 border-b flex items-center gap-2 text-neutral-700 bg-neutral-50">
                <span className="text-sm font-medium">Tenant Details</span>
              </div>
              <div className="p-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 items-end">
                <div>
                  <label className="text-xs text-neutral-500">Plan</label>
                  <select
                    value={tenantForm.active_plan}
                    onChange={(e) => setTenantForm((f) => ({ ...f, active_plan: e.target.value }))}
                    className="w-full border rounded px-2 py-1"
                  >
                    {PLANS.map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-neutral-500">Mode</label>
                  <div className="flex border rounded overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setTenantForm((f) => ({ ...f, trial: true, subscription_active: false }))}
                      className={`px-3 py-1 text-sm ${tenantForm.trial ? 'bg-emerald-50 text-emerald-700' : 'bg-white text-neutral-700'}`}
                      style={{ borderRight: '1px solid #e5e7eb' }}
                    >
                      Trial
                    </button>
                    <button
                      type="button"
                      onClick={() => setTenantForm((f) => ({ ...f, trial: false, subscription_active: true }))}
                      className={`px-3 py-1 text-sm ${tenantForm.subscription_active ? 'bg-emerald-50 text-emerald-700' : 'bg-white text-neutral-700'}`}
                    >
                      Subscription
                    </button>
                  </div>
                </div>

                {tenantForm.trial ? (
                  <>
                    <div>
                      <label className="text-xs text-neutral-500">Trial days</label>
                      <select
                        value={tenantForm.trial_days}
                        onChange={(e) => setTenantForm((f) => {
                          const days = Number(e.target.value || 7);
                          const start = f.subscription_start || new Date().toISOString();
                          return { ...f, trial_days: days, subscription_start: start, subscription_end: addDays(start, days) };
                        })}
                        className="w-full border rounded px-2 py-1"
                      >
                        <option value={7}>7</option>
                        <option value={14}>14</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-neutral-500">Trial start</label>
                      <input
                        type="datetime-local"
                        value={toLocalInputValue(tenantForm.subscription_start)}
                        onChange={(e) => setTenantForm((f) => ({
                          ...f,
                          subscription_start: toIso(e.target.value),
                          subscription_end: f.trial_days ? addDays(toIso(e.target.value), f.trial_days) : f.subscription_end,
                        }))}
                        className="w-full border rounded px-2 py-1"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-neutral-500">Ends</label>
                      <div className="px-2 py-1 border rounded bg-neutral-50 text-neutral-700">
                        {tenantForm.subscription_end ? prettyDate(tenantForm.subscription_end) : '—'}
                      </div>
                    </div>
                  </>
                ) : tenantForm.subscription_active && (
                  <>
                    <div>
                      <label className="text-xs text-neutral-500">Period (months)</label>
                      <select
                        value={tenantForm.subscription_period_months}
                        onChange={(e) => {
                          const months = Number(e.target.value || 0);
                          setTenantForm((f) => {
                            const start = f.subscription_start || new Date().toISOString();
                            const end = months ? addMonths(start, months) : '';
                            return { ...f, subscription_period_months: months, subscription_start: start, subscription_end: end };
                          });
                        }}
                        className="w-full border rounded px-2 py-1"
                      >
                        <option value="">Select</option>
                        {PERIODS.map((m) => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-neutral-500">Subscription start</label>
                      <input
                        type="datetime-local"
                        value={toLocalInputValue(tenantForm.subscription_start)}
                        onChange={(e) => setTenantForm((f) => ({
                          ...f,
                          subscription_start: toIso(e.target.value),
                          subscription_end: f.subscription_period_months ? addMonths(toIso(e.target.value), f.subscription_period_months) : f.subscription_end,
                        }))}
                        className="w-full border rounded px-2 py-1"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-neutral-500">Ends</label>
                      <div className="px-2 py-1 border rounded bg-neutral-50 text-neutral-700">
                        {tenantForm.subscription_end ? prettyDate(tenantForm.subscription_end) : '—'}
                      </div>
                    </div>
                  </>
                )}
                <div className="md:col-span-2 lg:col-span-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs text-neutral-500">Settings (JSON)</label>
                    <button
                      type="button"
                      onClick={() => setTenantForm((f) => ({ ...f, settings: sampleSettings() }))}
                      className="text-xs underline"
                      title="Insert sample"
                    >Sample</button>
                  </div>
                  <textarea
                    value={JSON.stringify(tenantForm.settings || {}, null, 2)}
                    onChange={(e) => {
                      try {
                        const obj = JSON.parse(e.target.value || '{}');
                        setTenantForm((f) => ({ ...f, settings: obj }));
                      } catch {
                        // ignore parse errors while typing
                      }
                    }}
                    rows={6}
                    placeholder={JSON.stringify(sampleSettings(), null, 2)}
                    className="w-full border rounded px-2 py-1 font-mono text-xs"
                  />
                </div>
                <div className="md:col-span-2 lg:col-span-3 flex gap-2">
                  <button onClick={persistTenantForm} className="px-3 py-1 rounded bg-neutral-900 text-white text-sm">Save</button>
                  <button onClick={() => setTenantForm({
                    active_plan: selectedTenant.active_plan || 'free',
                    trial: !!selectedTenant.trial,
                    subscription_start: selectedTenant.subscription_start || '',
                    subscription_end: selectedTenant.subscription_end || '',
                    settings: selectedTenant.settings || {},
                  })} className="px-3 py-1 rounded border text-sm">Reset</button>
                </div>
              </div>
            </div>
            {loadingUsers ? (
              <div className="p-3 text-neutral-500">Loading users...</div>
            ) : usersError ? (
              <div className="mb-4 space-y-1 text-red-600">
                <p>{usersError}</p>
                <button onClick={() => fetchUsers(selectedTenant)} className="underline">Retry</button>
              </div>
            ) : (
              <table className="w-full text-sm border rounded overflow-hidden">
                <thead className="bg-neutral-100 text-neutral-700">
                  <tr>
                    <th className="text-left px-3 py-2">Email</th>
                    <th className="text-left px-3 py-2">Role</th>
                    <th className="text-left px-3 py-2">Status</th>
                    <th className="text-left px-3 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-t">
                      <td className="px-3 py-2">{u.username || u.email}</td>
                      <td className="px-3 py-2">
                        <select
                          value={u.role || 'user'}
                          onChange={(e) => changeUserRole(u.id, e.target.value)}
                          className="border rounded px-2 py-1"
                        >
                          <option value="user">user</option>
                          <option value="admin">admin</option>
                          <option value="super_admin">super_admin</option>
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`text-xs px-2 py-0.5 rounded-full border ${u.disabled ? 'bg-neutral-100 text-neutral-700 border-neutral-300' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>
                          {u.disabled ? 'Disabled' : 'Active'}
                        </span>
                      </td>
                      <td className="px-3 py-2 space-x-3">
                        <button onClick={() => resetUserPassword(u.id)} className="p-1 rounded hover:bg-neutral-100" title="Reset password">
                          <KeyRound size={16} />
                        </button>
                        {u.disabled ? (
                          <button onClick={() => enableUser(u.id)} className="p-1 rounded hover:bg-neutral-100" title="Enable">
                            <Check size={16} className="text-emerald-600" />
                          </button>
                        ) : (
                          <button onClick={() => disableUser(u.id)} className="p-1 rounded hover:bg-neutral-100" title="Disable">
                            <Trash2 size={16} className="text-red-600" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {users.length === 0 && (
                    <tr><td className="px-3 py-3 text-neutral-500" colSpan="4">No users for this tenant</td></tr>
                  )}

                  {/* Add-user row aligned to table */}
                  <tr className="border-t">
                    <td className="px-3 py-2">
                      <input
                        type="email"
                        placeholder="User email"
                        value={newUser.email}
                        onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                        className="w-full border rounded px-2 py-1"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={newUserRole}
                        onChange={(e) => setNewUserRole(e.target.value)}
                        className="w-full border rounded px-2 py-1"
                      >
                        <option value="user">user</option>
                        <option value="admin">admin</option>
                        <option value="super_admin">super_admin</option>
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="password"
                        placeholder="Password"
                        value={newUser.password}
                        onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                        className="w-full border rounded px-2 py-1"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <button
                        onClick={addUser}
                        disabled={addingUser || !newUser.email || !newUser.password}
                        className="px-3 py-1 rounded bg-neutral-900 text-white disabled:opacity-50"
                        title="Add user"
                      >
                        {addingUser ? (
                          <RefreshCw size={14} className="animate-spin" />
                        ) : (
                          <Plus size={14} />
                        )}
                      </button>
                    </td>
                  </tr>
                  {addUserError && (
                    <tr>
                      <td colSpan={4} className="px-3 pb-2 text-sm text-red-600">{addUserError}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}

            <div className="text-[11px] text-neutral-500 mt-2">Draft values persist across tenants</div>

            {/* Policies */}
            <div className="mt-6 border rounded">
              <div className="px-3 py-2 border-b flex items-center gap-2 text-neutral-700 bg-neutral-50">
                <Shield size={16} />
                <span className="text-sm font-medium">Policy Settings</span>
              </div>
              <div className="p-3 grid grid-cols-1 md:grid-cols-2 gap-4">
                {['user', 'admin'].map((role) => (
                  <div key={role} className="border rounded">
                    <div className="px-3 py-2 border-b text-sm font-medium capitalize bg-neutral-50">{role}</div>
                    <div className="p-3 space-y-2 text-sm">
                      <div className="grid grid-cols-4 gap-2 items-center">
                        <div className="text-neutral-500">Resource</div>
                        <div className="text-center">Create</div>
                        <div className="text-center">Update</div>
                        <div className="text-center">Delete</div>
                      </div>
                      {RESOURCES.map((r) => (
                        <div key={r} className="grid grid-cols-4 gap-2 items-center">
                          <div className="capitalize">{r}</div>
                          {['can_create','can_update','can_delete'].map((k) => (
                            <div key={k} className="text-center">
                              <input
                                type="checkbox"
                                checked={!!policies[role][r][k]}
                                onChange={(e) => setPolicies((ps) => ({
                                  ...ps,
                                  [role]: { ...ps[role], [r]: { ...ps[role][r], [k]: e.target.checked } },
                                }))}
                              />
                            </div>
                          ))}
                        </div>
                      ))}
                      <div className="pt-2" />
                    </div>
                  </div>
                ))}
              </div>
              <div className="p-3 border-t">
                <button
                  onClick={async () => {
                    await saveAccessPolicies('user');
                    await saveAccessPolicies('admin');
                  }}
                  className="px-3 py-1 rounded bg-neutral-900 text-white flex items-center gap-2 text-sm"
                >
                  <Save size={14} />
                  Save Policies
                </button>
              </div>
            </div>

            {/* Audit Logs */}
            <AuditLogs tenantId={selectedTenant.id} token={token} />
          </div>
        ) : (
          <div className="p-3 text-neutral-600">Select a tenant to view users.</div>
        )}
      </main>
      </div>

      {/* Toasts */}
      <div className="fixed top-4 left-1/2 -translate-x-1/2 space-y-2 z-50 w-[90%] max-w-md pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`mx-auto px-4 py-2 rounded-lg shadow-lg text-sm border backdrop-blur pointer-events-auto flex items-center gap-2 justify-center ${
              t.tone === 'success'
                ? 'bg-emerald-50/90 border-emerald-200 text-emerald-800'
                : t.tone === 'danger'
                ? 'bg-red-50/90 border-red-200 text-red-800'
                : 'bg-neutral-50/90 border-neutral-200 text-neutral-800'
            }`}
          >
            <span className="text-base">{t.icon}</span>
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
