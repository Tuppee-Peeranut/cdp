import { supabaseAdmin } from '../supabaseClient.js';

const SEED_EMAIL = 'skywalker@example.com';
const SEED_PASSWORD = "i'my0urfather";

export async function seedSuperAdmin(client = supabaseAdmin) {
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

export async function createUser({ email, password, role = 'user', tenantId }, client = supabaseAdmin) {
  return client.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { role, tenant_id: tenantId }
  });
}

export async function updateUser(id, { email, password, role, tenantId, disabled }, client = supabaseAdmin) {
  const attrs = {};
  if (email) attrs.email = email;
  if (password) attrs.password = password;
  const meta = {};
  if (role) meta.role = role;
  if (tenantId) meta.tenant_id = tenantId;
  if (disabled !== undefined) meta.disabled = disabled;
  if (Object.keys(meta).length) attrs.user_metadata = meta;
  return client.auth.admin.updateUserById(id, attrs);
}

export async function deleteUser(id, client = supabaseAdmin) {
  return client.auth.admin.deleteUser(id);
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
