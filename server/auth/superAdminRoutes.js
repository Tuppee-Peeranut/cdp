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

const router = express.Router();
router.use(authorize('super_admin'));

router.get('/tenants', async (req, res) => {
  const { data, error } = await supabaseAdmin.from('tenants').select();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

router.post('/tenants', async (req, res) => {
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

router.post('/users', async (req, res) => {
  const { email, password, tenantId, role } = req.body;
  const { data, error } = await createUser({ email, password, tenantId, role });
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

router.put('/users/:id', async (req, res) => {
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
