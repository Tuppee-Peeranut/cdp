import { supabaseAdmin } from '../supabaseClient.js';

export async function seedSuperAdmin(client = supabaseAdmin) {
  const SEED_EMAIL = process.env.SUPERADMIN_SEED_EMAIL;
  const SEED_PASSWORD = process.env.SUPERADMIN_SEED_PASSWORD;
  if (!SEED_EMAIL || !SEED_PASSWORD) {
    throw new Error(
      'Missing SUPERADMIN_SEED_EMAIL or SUPERADMIN_SEED_PASSWORD environment variable'
    );
  }
  const { data, error } = await client.auth.admin.listUsers({
    email: SEED_EMAIL,
    page: 1,
    perPage: 1,
  });
  if (error) throw error;
  let user = data?.users?.[0];
  if (!user) {
    const { data: created, error: createError } = await client.auth.admin.createUser({
      email: SEED_EMAIL,
      password: SEED_PASSWORD,
      email_confirm: true,
      user_metadata: { role: 'super_admin', username: 'skywalker' },
    });
    if (createError) throw createError;
    user = created.user;
  }
  const { error: tableError } = await client
    .from('super_admins')
    .upsert({ id: user.id, email: user.email });
  if (tableError) throw tableError;
}

export async function createUser(
  {
    email,
    password,
    role = 'user',
    tenantId,
    profileUrl,
    phone,
    locale,
    consents,
    lastLoginAt,
    deletedAt
  },
  client = supabaseAdmin
) {
  const meta = { role, tenant_id: tenantId };
  if (profileUrl) meta.profile_url = profileUrl;
  if (locale) meta.locale = locale;
  if (consents !== undefined) meta.consents = consents;
  if (lastLoginAt) meta.last_login_at = lastLoginAt;
  if (deletedAt) meta.deleted_at = deletedAt;
  const created = await client.auth.admin.createUser({
    email,
    password,
    phone,
    email_confirm: true,
    user_metadata: meta
  });
  if (created.error) return created;
  try {
    // Sync app users table
    await client
      .from('users')
      .upsert({
        id: created.data.user.id,
        username: email,
        role,
        tenant_id: tenantId,
        profile_url: profileUrl,
        phone,
        locale,
        consents,
        last_login_at: lastLoginAt,
        deleted_at: deletedAt,
        status: deletedAt ? 'disabled' : 'active',
      }, { onConflict: 'id' });
  } catch (e) {
    // ignore sync error but surface auth create success
  }
  return created;
}

export async function updateUser(
  id,
  {
    email,
    password,
    role,
    tenantId,
    disabled,
    profileUrl,
    phone,
    locale,
    consents,
    lastLoginAt,
    deletedAt
  },
  client = supabaseAdmin
) {
  const attrs = {};
  if (email) attrs.email = email;
  if (password) attrs.password = password;
  if (phone) attrs.phone = phone;
  const meta = {};
  if (role) meta.role = role;
  if (tenantId) meta.tenant_id = tenantId;
  if (disabled !== undefined) meta.disabled = disabled;
  if (profileUrl) meta.profile_url = profileUrl;
  if (locale) meta.locale = locale;
  if (consents !== undefined) meta.consents = consents;
  if (lastLoginAt) meta.last_login_at = lastLoginAt;
  if (deletedAt) meta.deleted_at = deletedAt;
  if (Object.keys(meta).length) attrs.user_metadata = meta;
  const updated = await client.auth.admin.updateUserById(id, attrs);
  if (updated.error) return updated;
  try {
    const appPatch = {};
    if (email) appPatch.username = email;
    if (role) appPatch.role = role;
    if (tenantId) appPatch.tenant_id = tenantId;
    if (profileUrl) appPatch.profile_url = profileUrl;
    if (phone) appPatch.phone = phone;
    if (locale) appPatch.locale = locale;
    if (consents !== undefined) appPatch.consents = consents;
    if (lastLoginAt) appPatch.last_login_at = lastLoginAt;
    if (deletedAt) appPatch.deleted_at = deletedAt;
    if (disabled !== undefined) appPatch.status = disabled ? 'disabled' : 'active';
    if (Object.keys(appPatch).length) {
      appPatch.id = id;
      await client.from('users').upsert(appPatch, { onConflict: 'id' });
    }
  } catch (e) {
    // ignore sync error
  }
  return updated;
}

export async function deleteUser(id, client = supabaseAdmin) {
  return updateUser(
    id,
    { deletedAt: new Date().toISOString(), disabled: true },
    client
  );
}

export const disableUser = (id, client = supabaseAdmin) => updateUser(id, { disabled: true }, client);
export const enableUser = (id, client = supabaseAdmin) => updateUser(id, { disabled: false }, client);
export const assignRole = (id, role, client = supabaseAdmin) => updateUser(id, { role }, client);

function addMonthsISO(iso, months) {
  try {
    const d = new Date(iso);
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth();
    const day = d.getUTCDate();
    const nd = new Date(Date.UTC(year, month + months, day, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()));
    return nd.toISOString();
  } catch {
    return null;
  }
}

function addDaysISO(iso, days) {
  try {
    const d = new Date(iso);
    d.setUTCDate(d.getUTCDate() + Number(days));
    return d.toISOString();
  } catch {
    return null;
  }
}

export async function createTenant(nameOrAttrs, client = supabaseAdmin) {
  const attrs =
    typeof nameOrAttrs === 'string' ? { name: nameOrAttrs } : (nameOrAttrs || {});
  if (!attrs.name) throw new Error('Tenant name is required');
  // Apply sensible defaults for new tenants
  const now = new Date();
  const defaults = {
    subscription_start: attrs.subscription_start || now.toISOString(),
    subscription_end: attrs.subscription_end || null,
    active_plan: attrs.active_plan || 'pro',
    trial: attrs.trial === undefined ? true : !!attrs.trial,
    settings: attrs.settings || {},
    subscription_active: attrs.subscription_active === undefined ? false : !!attrs.subscription_active,
    subscription_period_months: attrs.subscription_period_months || null,
    trial_days: attrs.trial_days || (attrs.trial ? 7 : null),
  };
  const payload = { ...attrs, ...defaults };
  if (!payload.subscription_end && payload.subscription_active && payload.subscription_period_months) {
    payload.subscription_end = addMonthsISO(payload.subscription_start, payload.subscription_period_months);
  }
  if (!payload.subscription_end && payload.trial && payload.trial_days) {
    payload.subscription_end = addDaysISO(payload.subscription_start, payload.trial_days);
  }
  return client.from('tenants').insert(payload).select().single();
}

export async function updateTenant(id, attrs, client = supabaseAdmin) {
  const patch = { ...(attrs || {}) };
  // If period or start changed, compute end. If start missing, fetch current.
  const needCompute =
    (patch.subscription_active !== undefined ||
      patch.subscription_period_months !== undefined ||
      patch.subscription_start !== undefined) &&
    (patch.subscription_active === true || patch.subscription_active === undefined);
  if (needCompute) {
    let start = patch.subscription_start;
    let period = patch.subscription_period_months;
    if (!start || !period) {
      const { data: current } = await client
        .from('tenants')
        .select('subscription_start, subscription_period_months')
        .eq('id', id)
        .single();
      if (!start) start = current?.subscription_start;
      if (!period) period = current?.subscription_period_months;
    }
    if (start && period) {
      patch.subscription_end = addMonthsISO(start, period);
    }
  }
  // Compute end for trial mode as well
  const needTrialCompute =
    (patch.trial !== undefined || patch.trial_days !== undefined || patch.subscription_start !== undefined) &&
    (patch.trial === true || patch.trial === undefined);
  if (needTrialCompute) {
    let startT = patch.subscription_start;
    let days = patch.trial_days;
    if (!startT || !days) {
      const { data: current } = await client
        .from('tenants')
        .select('subscription_start, trial_days')
        .eq('id', id)
        .single();
      if (!startT) startT = current?.subscription_start;
      if (!days) days = current?.trial_days || 7;
    }
    if (startT && days) {
      patch.subscription_end = addDaysISO(startT, days);
    }
  }
  return client.from('tenants').update(patch).eq('id', id).select().single();
}

// Access policies helpers
export async function getAccessPolicies(role, tenantId, client = supabaseAdmin) {
  let q = client
    .from('access_policies')
    .select('resource, can_create, can_update, can_delete')
    .eq('role', role);
  if (tenantId) q = q.eq('tenant_id', tenantId);
  return q;
}

export async function upsertAccessPolicies(role, items, tenantId, client = supabaseAdmin) {
  const rows = (items || []).map((it) => ({ role, tenant_id: tenantId || null, ...it }));
  return client
    .from('access_policies')
    .upsert(rows, { onConflict: 'tenant_id,role,resource' })
    .select();
}

// Audit log helper
export async function auditLog({ actorId, tenantId, action, resource, resourceId, meta }, client = supabaseAdmin) {
  try {
    await client
      .from('audit_logs')
      .insert({ actor_id: actorId || null, tenant_id: tenantId || null, action, resource, resource_id: resourceId, meta: meta || {} });
  } catch (_) {}
}

export async function deleteTenant(id, client = supabaseAdmin) {
  return client.from('tenants').delete().eq('id', id);
}

// Placeholder for managing page access by role.
// Implement persistence layer as needed.
export async function updateRolePages(role, pages, client = supabaseAdmin) {
  return client.from('roles').upsert({ name: role, pages }).select().single();
}
