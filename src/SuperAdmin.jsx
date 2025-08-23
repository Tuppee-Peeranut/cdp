import React from 'react';

export default function SuperAdmin() {
  return (
    <div className="p-4">
      <h1 className="text-2xl font-medium mb-4">Super Admin Panel</h1>
      <p className="mb-2">Use this area to manage global settings across all tenants.</p>
      <ul className="list-disc list-inside space-y-1">
        <li>Manage users</li>
        <li>Manage tenants</li>
        <li>Configure role access</li>
      </ul>
    </div>
  );
}
