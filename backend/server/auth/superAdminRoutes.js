import express from 'express';
import { authorize } from './supabaseAuth.js';
import {
  createTenant,
  updateTenant,
  deleteTenant,
  createUser,
  updateUser,
  deleteUser,
  updateRolePages,
} from './superAdmin.js';
import { supabaseAdmin } from '../supabaseClient.js';
import { auditLog, getAccessPolicies, upsertAccessPolicies } from './superAdmin.js';

// Simple validators to avoid external dependencies
const allowedRoles = ['user', 'admin', 'super_admin'];

const isEmail = (email) =>
  typeof email === 'string' && /[^\s@]+@[^\s@]+\.[^\s@]+/.test(email);

const isStrongPassword = (password) =>
  typeof password === 'string' &&
  password.length >= 8 &&
  /[a-z]/.test(password) &&
  /[A-Z]/.test(password) &&
  /[0-9]/.test(password) &&
  /[^A-Za-z0-9]/.test(password);

async function validateTenant(req, res, next) {
  const errors = [];
  const { name } = req.body;
  if (!name || typeof name !== 'string' || !name.trim()) {
    errors.push({ param: 'name', msg: 'Name is required' });
  } else {
    const { data, error } = await supabaseAdmin
      .from('tenants')
      .select('id')
      .eq('name', name)
      .limit(1);
    if (error) errors.push({ param: 'name', msg: error.message });
    else if (data.length) errors.push({ param: 'name', msg: 'Tenant already exists' });
  }
  if (errors.length) return res.status(400).json({ errors });
  next();
}

async function validateTenantUpdate(req, res, next) {
  // Only validate name if present in payload; allow partial updates (plan, trial, etc.).
  const { name } = req.body || {};
  if (name === undefined) return next();
  const errors = [];
  const { id } = req.params;
  if (!name || typeof name !== 'string' || !name.trim()) {
    errors.push({ param: 'name', msg: 'Name is required' });
  } else {
    const { data, error } = await supabaseAdmin
      .from('tenants')
      .select('id, name')
      .eq('name', name)
      .limit(1);
    if (error) errors.push({ param: 'name', msg: error.message });
    else if (data.length && data[0].id !== id)
      errors.push({ param: 'name', msg: 'Tenant already exists' });
  }
  if (errors.length) return res.status(400).json({ errors });
  next();
}

function validateUserCreate(req, res, next) {
  const errors = [];
  const { email, password, role } = req.body;
  if (!isEmail(email)) errors.push({ param: 'email', msg: 'Valid email required' });
  if (!isStrongPassword(password))
    errors.push({
      param: 'password',
      msg: 'Password must be at least 8 characters and include upper, lower, number and symbol'
    });
  if (role && !allowedRoles.includes(role))
    errors.push({ param: 'role', msg: `Role must be one of ${allowedRoles.join(', ')}` });
  if (errors.length) return res.status(400).json({ errors });
  next();
}

function validateUserUpdate(req, res, next) {
  const errors = [];
  const { email, password, role } = req.body;
  if (email !== undefined && !isEmail(email))
    errors.push({ param: 'email', msg: 'Valid email required' });
  if (password !== undefined && !isStrongPassword(password))
    errors.push({
      param: 'password',
      msg: 'Password must be at least 8 characters and include upper, lower, number and symbol'
    });
  if (role !== undefined && !allowedRoles.includes(role))
    errors.push({ param: 'role', msg: `Role must be one of ${allowedRoles.join(', ')}` });
  if (errors.length) return res.status(400).json({ errors });
  next();
}

const router = express.Router();
router.use(authorize('super_admin'));

router.get('/tenants', async (req, res) => {
  const { data, error } = await supabaseAdmin.from('tenants').select();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

router.post('/tenants', validateTenant, async (req, res) => {
  const payload = req.body || {};
  const { data, error } = await createTenant(payload);
  if (error) return res.status(400).json({ error: error.message });
  await auditLog({ actorId: req.user?.id, tenantId: data?.id, action: 'create', resource: 'tenant', resourceId: data?.id, meta: { ...payload, actor_email: req.user?.email } });
  res.json(data);
});

router.put('/tenants/:id', validateTenantUpdate, async (req, res) => {
  const { id } = req.params;
  const attrs = req.body || {};
  const { data, error } = await updateTenant(id, attrs);
  if (error) return res.status(400).json({ error: error.message });
  await auditLog({ actorId: req.user?.id, tenantId: data?.id, action: 'update', resource: 'tenant', resourceId: data?.id, meta: { ...attrs, actor_email: req.user?.email } });
  res.json(data);
});

// Delete tenant
router.delete('/tenants/:id', async (req, res) => {
  const { id } = req.params;
  const { error } = await deleteTenant(id);
  if (error) return res.status(400).json({ error: error.message });
  await auditLog({ actorId: req.user?.id, tenantId: id, action: 'delete', resource: 'tenant', resourceId: id, meta: { actor_email: req.user?.email } });
  res.json({ ok: true });
});

router.get('/tenants/:id/users', async (req, res) => {
  const tenantId = req.params.id;
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('id, username, role, tenant_id, status, last_login_at, deleted_at')
    .eq('tenant_id', tenantId);
  if (error) return res.status(400).json({ error: error.message });
  res.json(
    (data || []).map((u) => ({
      id: u.id,
      email: u.username,
      role: u.role || 'user',
      tenant_id: u.tenant_id,
      status: u.status || (u.deleted_at ? 'disabled' : 'active'),
      last_login_at: u.last_login_at,
    }))
  );
});

router.post('/users', validateUserCreate, async (req, res) => {
  const { email, password, tenantId, role } = req.body;
  const { data, error } = await createUser({ email, password, tenantId, role });
  if (error) return res.status(400).json({ error: error.message });
  const u = data?.user;
  await auditLog({ actorId: req.user?.id, tenantId, action: 'create', resource: 'user', resourceId: u?.id, meta: { email, role, actor_email: req.user?.email } });
  res.json({
    id: u?.id,
    email: u?.email,
    role: role || 'user',
    tenant_id: tenantId || null,
    status: 'active',
  });
});

router.put('/users/:id', validateUserUpdate, async (req, res) => {
  const { data, error } = await updateUser(req.params.id, req.body);
  if (error) return res.status(400).json({ error: error.message });
  const u = data?.user;
  const meta = (u?.user_metadata || u?.app_metadata || {});
  await auditLog({ actorId: req.user?.id, tenantId: meta?.tenant_id, action: 'update', resource: 'user', resourceId: u?.id, meta: { ...meta, email: u?.email, actor_email: req.user?.email } });
  res.json({
    id: u?.id,
    email: u?.email,
    role: meta.role || 'user',
    tenant_id: meta.tenant_id || null,
    status: meta.disabled ? 'disabled' : 'active',
  });
});

router.delete('/users/:id', async (req, res) => {
  const { data, error } = await deleteUser(req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  await auditLog({ actorId: req.user?.id, action: 'delete', resource: 'user', resourceId: req.params.id, meta: { actor_email: req.user?.email } });
  res.json({ ok: true });
});

// Role page policies
router.get('/roles/:role/pages', async (req, res) => {
  const role = req.params.role;
  const { data, error } = await supabaseAdmin
    .from('roles')
    .select('name, pages')
    .eq('name', role)
    .single();
  if (error && error.code !== 'PGRST116') return res.status(400).json({ error: error.message });
  res.json({ role, pages: data?.pages || [] });
});

router.put('/roles/:role/pages', async (req, res) => {
  const role = req.params.role;
  const { pages } = req.body || {};
  if (!Array.isArray(pages)) {
    return res.status(400).json({ error: 'pages must be an array' });
  }
  const { data, error } = await updateRolePages(role, pages);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ role, pages: data?.pages || pages });
});

// Access policies (Dashboard/Domain/Rules with CRUD)
router.get('/policies/:role', async (req, res) => {
  const role = req.params.role;
  const tenantId = req.query.tenantId || null;
  if (!tenantId) return res.status(400).json({ error: 'tenantId required' });
  const { data, error } = await getAccessPolicies(role, tenantId);
  if (error) return res.status(400).json({ error: error.message });
  res.json(data || []);
});

router.put('/policies/:role', async (req, res) => {
  const role = req.params.role;
  const tenantId = req.query.tenantId || null;
  const { items } = req.body || {};
  if (!Array.isArray(items)) return res.status(400).json({ error: 'items must be an array' });
  if (!tenantId) return res.status(400).json({ error: 'tenantId required' });
  const { data, error } = await upsertAccessPolicies(role, items, tenantId);
  if (error) return res.status(400).json({ error: error.message });
  await auditLog({ actorId: req.user?.id, tenantId, action: 'update', resource: 'policy', resourceId: role, meta: { items, actor_email: req.user?.email } });
  res.json(data || []);
});

// Audit logs query
router.get('/audit', async (req, res) => {
  const tenantId = req.query.tenantId || null;
  const limit = Math.min(parseInt(req.query.limit || '20', 10), 100);
  let q = supabaseAdmin.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(limit);
  if (tenantId) q = q.eq('tenant_id', tenantId);
  const { data, error } = await q;
  if (error) return res.status(400).json({ error: error.message });
  res.json(data || []);
});

export default router;
