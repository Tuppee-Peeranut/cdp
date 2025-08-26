import express from 'express';
import { authorize } from './supabaseAuth.js';
import {
  createTenant,
  updateTenant,
  deleteTenant,
  createUser,
  updateUser,
  deleteUser
} from './superAdmin.js';
import { supabaseAdmin } from '../supabaseClient.js';

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
  const { name } = req.body;
  const { data, error } = await createTenant(name);
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

router.get('/tenants/:id/users', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('id, username, role, tenant_id')
    .eq('tenant_id', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

router.post('/users', validateUserCreate, async (req, res) => {
  const { email, password, tenantId, role } = req.body;
  const { data, error } = await createUser({ email, password, tenantId, role });
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

router.put('/users/:id', validateUserUpdate, async (req, res) => {
  const { data, error } = await updateUser(req.params.id, req.body);
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

router.delete('/users/:id', async (req, res) => {
  const { data, error } = await deleteUser(req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

export default router;
