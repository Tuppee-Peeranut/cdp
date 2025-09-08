import express from 'express';
import { supabaseAdmin } from './supabaseClient.js';
import { authorize } from './auth/supabaseAuth.js';

const router = express.Router();
router.use(authorize(['admin', 'user', 'super_admin']));

// Helpers
async function resolveTenantId(req) {
  if (req.user?.tenantId) return req.user.tenantId;
  try {
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('tenant_id')
      .eq('id', req.user?.id)
      .single();
    if (error) return null;
    return data?.tenant_id || null;
  } catch {
    return null;
  }
}

// List tasks for current tenant, optional filters: domain_id, kind, status
router.get('/', async (req, res) => {
  const tenantId = await resolveTenantId(req);
  if (!tenantId) return res.json([]);
  let q = supabaseAdmin
    .from('tasks')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });
  const { domain_id, kind, status } = req.query || {};
  if (domain_id) q = q.eq('domain_id', domain_id);
  if (kind) q = q.eq('kind', kind);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return res.status(400).json({ error: error.message });
  res.json(data || []);
});

// Create a task
router.post('/', async (req, res) => {
  const tenantId = await resolveTenantId(req);
  const userId = req.user?.id || null;
  const { domain_id = null, kind, status = 'initiated', params = {} } = req.body || {};
  if (!tenantId) return res.status(400).json({ error: 'tenantId missing' });
  if (!kind) return res.status(400).json({ error: 'kind required' });
  const payload = {
    tenant_id: tenantId,
    domain_id: domain_id || null,
    kind,
    status,
    params,
    created_by: userId,
  };
  const { data, error } = await supabaseAdmin.from('tasks').insert(payload).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// Update a task (status/params/result)
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const tenantId = await resolveTenantId(req);
  // Ensure task belongs to tenant
  const { data: task } = await supabaseAdmin.from('tasks').select('tenant_id').eq('id', id).single();
  if (!task || task.tenant_id !== tenantId) return res.status(403).json({ error: 'Forbidden' });
  const patch = {};
  const { status, params, result } = req.body || {};
  if (status !== undefined) patch.status = status;
  if (params !== undefined) patch.params = params;
  if (result !== undefined) patch.result = result;
  patch.updated_at = new Date().toISOString();
  const { data, error } = await supabaseAdmin.from('tasks').update(patch).eq('id', id).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

export default router;

