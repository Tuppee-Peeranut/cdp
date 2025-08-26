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
    perPage: 1
  });
  if (error) throw error;
  if (!data?.users?.length) {
    const { error: createError } = await client.auth.admin.createUser({
      email: SEED_EMAIL,
      password: SEED_PASSWORD,
      email_confirm: true,
      user_metadata: { role: 'super_admin', username: 'skywalker' }
    });
    if (createError) throw createError;
  }
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
  return client.auth.admin.createUser({
    email,
    password,
    phone,
    email_confirm: true,
    user_metadata: meta
  });
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
  return client.auth.admin.updateUserById(id, attrs);
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

export async function createTenant(name, client = supabaseAdmin) {
  return client.from('tenants').insert({ name }).select().single();
}

export async function updateTenant(id, attrs, client = supabaseAdmin) {
  return client.from('tenants').update(attrs).eq('id', id).select().single();
}

export async function deleteTenant(id, client = supabaseAdmin) {
  return client.from('tenants').delete().eq('id', id);
}

// Placeholder for managing page access by role.
// Implement persistence layer as needed.
export async function updateRolePages(role, pages, client = supabaseAdmin) {
  return client.from('roles').upsert({ name: role, pages }).select().single();
}
