import React, { useEffect, useState } from 'react';

export default function AuditLogs({ tenantId, token }) {
  const [logs, setLogs] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!tenantId || !token) return;
    setLoading(true);
    fetch(`/api/superadmin/audit?tenantId=${tenantId}&limit=50`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error || res.statusText);
        return res.json();
      })
      .then((data) => setLogs(data || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [tenantId, token]);

  if (!tenantId) return null;
  return (
    <div className="mt-6 border rounded">
      <div className="px-3 py-2 border-b text-sm font-medium bg-neutral-50">Audit Logs</div>
      {loading ? (
        <div className="p-3 text-neutral-500">Loading...</div>
      ) : error ? (
        <div className="p-3 text-red-600 text-sm">{error}</div>
      ) : (
        <div className="p-3">
          {logs.length === 0 ? (
            <div className="text-sm text-neutral-500">No audit logs yet.</div>
          ) : (
            <ul className="text-sm space-y-2">
              {logs.map((l) => {
                const m = l.meta || {};
                let details = '';
                if (l.resource === 'user') {
                  const status = m.disabled ? 'disabled' : (m.status || 'active');
                  details = [m.email, m.role, status].filter(Boolean).join(' · ');
                } else if (l.resource === 'tenant') {
                  const parts = [];
                  if (m.trial) parts.push(`trial ${m.trial_days || ''}d`);
                  if (m.subscription_active) parts.push(`sub ${m.subscription_period_months || ''}m`);
                  if (m.active_plan) parts.push(`plan ${m.active_plan}`);
                  details = parts.join(' · ');
                } else if (l.resource === 'policy') {
                  const count = Array.isArray(m.items) ? m.items.length : 0;
                  details = `${count} rules saved`;
                }
                return (
                  <li key={l.id} className="flex items-start gap-2">
                    <span className="text-neutral-500 w-56 shrink-0">{new Date(l.created_at).toLocaleString()}</span>
                    <span className="px-2 py-0.5 rounded-full border bg-neutral-50 text-neutral-700">
                      {l.action}
                    </span>
                    <span className="capitalize">{l.resource}</span>
                    <span className="text-neutral-500 truncate">{l.resource_id || ''}</span>
                    {m.actor_email && (
                      <span className="ml-auto text-neutral-500">by {m.actor_email}</span>
                    )}
                    {details && (
                      <span className="ml-2 text-neutral-700">— {details}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
  </div>
  );
}
