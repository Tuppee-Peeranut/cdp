import express from 'express';
import crypto from 'crypto';
import * as XLSX from 'xlsx';
import { supabaseAdmin } from './supabaseClient.js';
import { authorize } from './auth/supabaseAuth.js';
import { auditLog } from './auth/superAdmin.js';

const router = express.Router();
router.use(authorize(['admin','user','super_admin']));

// List domains for current tenant
router.get('/', async (req, res) => {
  const tenantId = await resolveTenantId(req);
  if (!tenantId) return res.json([]);
  const { data, error } = await supabaseAdmin
    .from('domains')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });
  if (error) return res.status(400).json({ error: error.message });
  res.json(data || []);
});

// Create domain
router.post('/', async (req, res) => {
  const tenantId = await resolveTenantId(req);
  const userId = req.user?.id;
  const { name, description, business_key } = req.body || {};
  if (!tenantId) return res.status(400).json({ error: 'tenantId missing' });
  if (!name) return res.status(400).json({ error: 'name required' });
  const payload = {
    tenant_id: tenantId,
    name,
    description: description || null,
    business_key: Array.isArray(business_key) ? business_key : [],
    created_by: userId || null,
  };
  const { data, error } = await supabaseAdmin
    .from('domains')
    .insert(payload)
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });
  await auditLog({ actorId: userId, tenantId, action: 'create', resource: 'domain', resourceId: data.id, meta: payload });
  res.json(data);
});

// Update domain (name, description, business_key)
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const tenantId = await resolveTenantId(req);
  const userId = req.user?.id;
  const { name, description, business_key } = req.body || {};
  const { data: dom } = await supabaseAdmin.from('domains').select('tenant_id').eq('id', id).single();
  if (!dom || dom.tenant_id !== tenantId) return res.status(403).json({ error: 'Forbidden' });
  const patch = {};
  if (name) patch.name = name;
  if (description !== undefined) patch.description = description;
  if (business_key !== undefined) patch.business_key = Array.isArray(business_key) ? business_key : [];
  const { data, error } = await supabaseAdmin
    .from('domains')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });
  await auditLog({ actorId: userId, tenantId, action: 'update', resource: 'domain', resourceId: id, meta: patch });
  res.json(data);
});

// Rules for a domain
router.get('/:id/rules', async (req, res) => {
  const { id } = req.params;
  const tenantId = await resolveTenantId(req);
  const { data: dom } = await supabaseAdmin.from('domains').select('tenant_id').eq('id', id).single();
  if (!dom || dom.tenant_id !== tenantId) return res.status(403).json({ error: 'Forbidden' });
  const { data, error } = await supabaseAdmin
    .from('rules')
    .select('*')
    .eq('domain_id', id)
    .order('created_at', { ascending: false });
  if (error) return res.status(400).json({ error: error.message });
  res.json(data || []);
});

router.post('/:id/rules', async (req, res) => {
  const { id } = req.params;
  const tenantId = await resolveTenantId(req);
  const userId = req.user?.id;
  const { name, definition } = req.body || {};
  if (!name || !definition) return res.status(400).json({ error: 'name and definition required' });
  const { data: dom } = await supabaseAdmin.from('domains').select('tenant_id').eq('id', id).single();
  if (!dom || dom.tenant_id !== tenantId) return res.status(403).json({ error: 'Forbidden' });
  const insert = { domain_id: id, name, definition, created_by: userId };
  const { data, error } = await supabaseAdmin.from('rules').insert(insert).select().single();
  if (error) return res.status(400).json({ error: error.message });
  await auditLog({ actorId: userId, tenantId, action: 'create', resource: 'rule', resourceId: data.id, meta: insert });
  res.json(data);
});

// Update rule
router.put('/:id/rules/:ruleId', async (req, res) => {
  const { id, ruleId } = req.params;
  const tenantId = await resolveTenantId(req);
  const { data: dom } = await supabaseAdmin.from('domains').select('tenant_id').eq('id', id).single();
  if (!dom || dom.tenant_id !== tenantId) return res.status(403).json({ error: 'Forbidden' });
  const patch = {};
  const { name, status, definition } = req.body || {};
  if (name !== undefined) patch.name = name;
  if (status !== undefined) patch.status = status;
  if (definition !== undefined) patch.definition = definition;
  const { data, error } = await supabaseAdmin.from('rules').update(patch).eq('id', ruleId).eq('domain_id', id).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// List versions
router.get('/:id/versions', async (req, res) => {
  const { id } = req.params;
  const tenantId = await resolveTenantId(req);
  const { data: dom } = await supabaseAdmin.from('domains').select('tenant_id').eq('id', id).single();
  if (!dom || dom.tenant_id !== tenantId) return res.status(403).json({ error: 'Forbidden' });
  const { data, error } = await supabaseAdmin
    .from('domain_versions')
    .select('*')
    .eq('domain_id', id)
    .order('created_at', { ascending: false });
  if (error) return res.status(400).json({ error: error.message });
  res.json(data || []);
});

// Version info
router.get('/:id/version/:versionId', async (req, res) => {
  const { id, versionId } = req.params;
  const tenantId = await resolveTenantId(req);
  const { data: dom } = await supabaseAdmin.from('domains').select('tenant_id').eq('id', id).single();
  if (!dom || dom.tenant_id !== tenantId) return res.status(403).json({ error: 'Forbidden' });
  const { data, error } = await supabaseAdmin
    .from('domain_versions')
    .select('*')
    .eq('id', versionId)
    .eq('domain_id', id)
    .single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// Diff between version's before and current after (changed rows only)
router.get('/:id/version/:versionId/diff', async (req, res) => {
  const { id, versionId } = req.params;
  const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
  const offset = Math.max(parseInt(req.query.offset || '0', 10), 0);
  const tenantId = await resolveTenantId(req);
  const { data: dom } = await supabaseAdmin.from('domains').select('tenant_id').eq('id', id).single();
  if (!dom || dom.tenant_id !== tenantId) return res.status(403).json({ error: 'Forbidden' });
  const { data: hist, error: hErr } = await supabaseAdmin
    .from('domain_history')
    .select('key_hash, key_values, record')
    .eq('domain_id', id)
    .eq('source_version_id', versionId)
    .range(offset, offset + limit - 1);
  if (hErr) return res.status(400).json({ error: hErr.message });
  const diffs = [];
  for (const h of hist || []) {
    const { data: cur } = await supabaseAdmin
      .from('domain_data')
      .select('record')
      .eq('domain_id', id)
      .eq('key_hash', h.key_hash)
      .single();
    const before = h.record;
    const after = cur?.record || null;
    const fields = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
    const changed = [];
    for (const f of fields) if (String((before||{})[f]) !== String((after||{})[f])) changed.push(f);
    diffs.push({ key_values: h.key_values, before, after, changed_fields: changed });
  }
  res.json(diffs);
});
// Preview current data
router.get('/:id/preview', async (req, res) => {
  try {
    const { id } = req.params;
    const limit = Math.max(5, Math.min(parseInt(req.query.limit || '50', 10), 200));
    const offset = Math.max(parseInt(req.query.offset || '0', 10), 0);
    const tenantId = await resolveTenantId(req);
    const { data: dom } = await supabaseAdmin.from('domains').select('tenant_id').eq('id', id).single();
    if (!dom || dom.tenant_id !== tenantId) return res.status(403).json({ error: 'Forbidden' });

    // Try to preview from latest domain_version (source snapshot)
    const { data: ver } = await supabaseAdmin
      .from('domain_versions')
      .select('id, file_path')
      .eq('domain_id', id)
      .not('file_path', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (ver?.file_path) {
      const dl = await supabaseAdmin.storage.from('domains').download(ver.file_path);
      if (dl?.error) return res.status(400).json({ error: dl.error.message });
      const buf = Buffer.from(await dl.data.arrayBuffer());
      const wb = XLSX.read(buf, { type: 'buffer' });
      const sheetName = wb.SheetNames[0];
      const ws = wb.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: null });
      const out = rows.slice(offset, offset + limit);
      return res.json(out);
    }

    // Fallback to current domain_data
    const { data, error } = await supabaseAdmin
      .from('domain_data')
      .select('record')
      .eq('domain_id', id)
      .range(offset, offset + limit - 1);
    if (error) return res.status(400).json({ error: error.message });
    return res.json((data || []).map((r) => r.record));
  } catch (e) {
    return res.status(400).json({ error: e.message || 'preview failed' });
  }
});

// Export current data as CSV after applying enabled rule transforms (does not mutate DB)
router.get('/:id/export.csv', async (req, res) => {
  try {
    const { id } = req.params;
    const tenantId = await resolveTenantId(req);
    const { data: dom } = await supabaseAdmin.from('domains').select('tenant_id').eq('id', id).single();
    if (!dom || dom.tenant_id !== tenantId) return res.status(403).json({ error: 'Forbidden' });

    const limit = Math.min(parseInt(req.query.limit || '10000', 10), 200000);
    const pageSize = 1000;

    // Fetch enabled rules
    const { data: rules } = await supabaseAdmin
      .from('rules')
      .select('*')
      .eq('domain_id', id)
      .neq('status', 'disabled');

    const applyTransforms = (record, defs) => {
      let out = { ...(record || {}) };
      for (const def of defs || []) {
        if (!def || !def.name) continue;
        if (def.name === 'trim') {
          const cols = def.columns || Object.keys(out);
          for (const c of cols) if (typeof out[c] === 'string') out[c] = out[c].trim();
        }
        if (def.name === 'uppercase') {
          const cols = def.columns || Object.keys(out);
          for (const c of cols) if (typeof out[c] === 'string') out[c] = out[c].toUpperCase();
        }
        if (def.name === 'lowercase') {
          const cols = def.columns || Object.keys(out);
          for (const c of cols) if (typeof out[c] === 'string') out[c] = out[c].toLowerCase();
        }
        if (def.name === 'normalize_whitespace') {
          const cols = def.columns || Object.keys(out);
          for (const c of cols) if (typeof out[c] === 'string') out[c] = out[c].replace(/\s+/g, ' ').trim();
        }
        if (def.name === 'replace') {
          const cols = def.columns || Object.keys(out);
          const from = def.from || '';
          const to = def.to || '';
          const re = new RegExp(from, 'g');
          for (const c of cols) if (typeof out[c] === 'string') out[c] = out[c].replace(re, to);
        }
        if (def.name === 'map') {
          const col = def.column;
          const mapping = def.mapping || {};
          if (col && out[col] != null && mapping[out[col]] !== undefined) out[col] = mapping[out[col]];
        }
        if (def.name === 'coalesce') {
          const col = def.column;
          const values = def.values || [];
          if (col && (out[col] == null || out[col] === '')) {
            const v = values.find((x) => x != null && x !== '');
            if (v !== undefined) out[col] = v;
          }
        }
      }
      return out;
    };

    const transforms = [];
    const dedupConfigs = [];
    // Decide dedup behavior: explicit query param wins; otherwise dedup if there are enabled dedup rules
    let doDedup;
    for (const r of rules || []) {
      if (r.definition?.transforms) transforms.push(...r.definition.transforms);
      const meta = r.definition?.meta || {};
      if ((meta.type === 'dedup' || meta.category === 'dedup') && Array.isArray(meta.keys) && meta.keys.length) {
        dedupConfigs.push({ keys: meta.keys, keep: (meta.keep === 'last' ? 'last' : 'first') });
      }
    }
    if (Object.prototype.hasOwnProperty.call(req.query, 'dedup')) {
      const q = String(req.query.dedup).toLowerCase();
      doDedup = q === '1' || q === 'true';
    } else {
      doDedup = dedupConfigs.length > 0;
    }

    // Collect rows up to limit from latest domain_version snapshot if available; else from current data
    let rows = [];
    const { data: verLatest } = await supabaseAdmin
      .from('domain_versions')
      .select('id, file_path, columns')
      .eq('domain_id', id)
      .not('file_path', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (verLatest?.file_path) {
      const dl = await supabaseAdmin.storage.from('domains').download(verLatest.file_path);
      if (dl?.error) return res.status(400).json({ error: dl.error.message });
      const buf = Buffer.from(await dl.data.arrayBuffer());
      const wb = XLSX.read(buf, { type: 'buffer' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rawRows = XLSX.utils.sheet_to_json(ws, { defval: null });
      // apply transforms
      rows = rawRows.slice(0, limit).map((rec) => applyTransforms(rec, transforms));
    } else {
      // Fallback: read from current domain_data
      let offset = 0;
      while (rows.length < limit) {
        const { data, error } = await supabaseAdmin
          .from('domain_data')
          .select('record')
          .eq('domain_id', id)
          .range(offset, offset + pageSize - 1);
        if (error) return res.status(400).json({ error: error.message });
        const batch = (data || []).map((r) => applyTransforms(r.record, transforms));
        rows.push(...batch);
        if (!data || data.length < pageSize) break;
        offset += pageSize;
        if (rows.length >= limit) break;
      }
    }

    // Apply dedup sequentially for any dedup configs
    const applyDedup = (arr, cfg) => {
      if (!cfg || !cfg.keys || !cfg.keys.length) return arr;
      if (cfg.keep === 'last') {
        const map = new Map();
        for (let i = arr.length - 1; i >= 0; i--) {
          const rec = arr[i];
          const key = cfg.keys.map((k) => String(rec?.[k] ?? '')).join('\u0001');
          if (!map.has(key)) map.set(key, rec);
        }
        return Array.from(map.values()).reverse();
      }
      // default keep first
      const seen = new Set();
      const out = [];
      for (const rec of arr) {
        const key = cfg.keys.map((k) => String(rec?.[k] ?? '')).join('\u0001');
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(rec);
      }
      return out;
    };
    let processedRows = rows;
    if (doDedup && dedupConfigs.length) {
      for (const cfg of dedupConfigs) processedRows = applyDedup(processedRows, cfg);
    }

    // Determine columns robustly: prefer stored columns if they look valid; otherwise infer from data
    let columns = [];
    const { data: lastVer } = await supabaseAdmin
      .from('domain_versions')
      .select('columns')
      .eq('domain_id', id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const inferColumns = () => {
      const set = new Set();
      for (let i = 0; i < Math.min(200, processedRows.length); i++) {
        for (const k of Object.keys(processedRows[i] || {})) set.add(k);
      }
      return Array.from(set);
    };
    if (Array.isArray(lastVer?.columns) && lastVer.columns.length) {
      const cols = lastVer.columns.map((c) => String(c));
      const allNumeric = cols.length > 0 && cols.every((c) => /^\d+$/.test(c));
      columns = allNumeric ? inferColumns() : cols;
      if (!columns.length) columns = inferColumns();
    } else {
      columns = inferColumns();
    }

    const esc = (v) => {
      if (v == null) return '';
      const s = String(v);
      if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
      return s;
    };
    const lines = [];
    // If still no columns, try a last-resort fallback from first row keys
    if (!columns.length && processedRows.length) columns = Object.keys(processedRows[0]);
    lines.push(columns.join(','));
    for (const r of processedRows) lines.push(columns.map((c) => esc(r[c])).join(','));
    const csv = lines.join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=domain_${id}_export.csv`);
    res.send(csv);
  } catch (e) {
    res.status(400).json({ error: e.message || 'export failed' });
  }
});

// Clean endpoint - apply transforms of enabled rules to current data
router.post('/:id/clean', async (req, res) => {
  try {
    const { id } = req.params;
    const tenantId = await resolveTenantId(req);
    const userId = req.user?.id;
    const { data: dom } = await supabaseAdmin.from('domains').select('tenant_id').eq('id', id).single();
    if (!dom || dom.tenant_id !== tenantId) return res.status(403).json({ error: 'Forbidden' });

    // Fetch enabled rules
    const { data: rules, error: rErr } = await supabaseAdmin
      .from('rules')
      .select('id, name, status, definition')
      .eq('domain_id', id)
      .neq('status', 'disabled');
    if (rErr) return res.status(400).json({ error: rErr.message });

    // Fetch current data
    const { data: rows } = await supabaseAdmin
      .from('domain_data')
      .select('key_hash, key_values, record')
      .eq('domain_id', id)
      .limit(20000);

    // Apply very simple transforms
    const applyTransforms = (rec, defs = []) => {
      let out = { ...rec };
      for (const def of defs) {
        if (def.name === 'trim') {
          const cols = def.columns || Object.keys(out);
          for (const c of cols) if (typeof out[c] === 'string') out[c] = out[c].trim();
        }
        if (def.name === 'lowercase') {
          const cols = def.columns || Object.keys(out);
          for (const c of cols) if (typeof out[c] === 'string') out[c] = out[c].toLowerCase();
        }
        if (def.name === 'uppercase') {
          const cols = def.columns || Object.keys(out);
          for (const c of cols) if (typeof out[c] === 'string') out[c] = out[c].toUpperCase();
        }
        if (def.name === 'normalize_whitespace') {
          const cols = def.columns || Object.keys(out);
          for (const c of cols) if (typeof out[c] === 'string') out[c] = out[c].replace(/\s+/g, ' ').trim();
        }
        if (def.name === 'replace') {
          const cols = def.columns || Object.keys(out);
          const from = def.from || '';
          const to = def.to || '';
          const re = new RegExp(from, 'g');
          for (const c of cols) if (typeof out[c] === 'string') out[c] = out[c].replace(re, to);
        }
        if (def.name === 'map') {
          const col = def.column;
          const mapping = def.mapping || {};
          if (col && out[col] != null && mapping[out[col]] !== undefined) out[col] = mapping[out[col]];
        }
        if (def.name === 'coalesce') {
          const col = def.column;
          const values = def.values || [];
          if (col && (out[col] == null || out[col] === '')) {
            const v = values.find((x) => x != null && x !== '');
            if (v !== undefined) out[col] = v;
          }
        }
      }
      return out;
    };

    let changed = 0;
    const transforms = [];
    const dedupConfigs = [];
    for (const r of rules || []) {
      if (r.definition?.transforms) transforms.push(...r.definition.transforms);
      const meta = r.definition?.meta || {};
      if ((meta.type === 'dedup' || meta.category === 'dedup') && Array.isArray(meta.keys) && meta.keys.length) {
        dedupConfigs.push({ keys: meta.keys, keep: (meta.keep === 'last' ? 'last' : 'first') });
      }
    }

    // Create output version record
    const { data: verOut, error: vErr } = await supabaseAdmin
      .from('domain_versions')
      .insert({ domain_id: id, file_path: null, rows_count: rows?.length || 0, columns: null, import_summary: { action: 'clean' } })
      .select()
      .single();
    if (vErr) return res.status(400).json({ error: vErr.message });

    // Compute dedup metrics without mutating DB yet
    const applyDedup = (arr, cfg) => {
      if (!cfg || !cfg.keys || !cfg.keys.length) return arr;
      if (cfg.keep === 'last') {
        const map = new Map();
        for (let i = arr.length - 1; i >= 0; i--) {
          const rec = arr[i];
          const key = cfg.keys.map((k) => String(rec?.[k] ?? '')).join('\u0001');
          if (!map.has(key)) map.set(key, rec);
        }
        return Array.from(map.values()).reverse();
      }
      const seen = new Set();
      const out = [];
      for (const rec of arr) {
        const key = cfg.keys.map((k) => String(rec?.[k] ?? '')).join('\u0001');
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(rec);
      }
      return out;
    };
    // Apply transforms to measure changed count, and prepare array of records for dedup metric
    const transformedRecords = [];
    for (const row of rows || []) {
      const newRec = applyTransforms(row.record, transforms);
      if (JSON.stringify(newRec) !== JSON.stringify(row.record)) {
        changed++;
        // write history
        await supabaseAdmin.from('domain_history').insert({
          domain_id: id,
          key_hash: row.key_hash,
          key_values: row.key_values,
          record: row.record,
          source_version_id: verOut.id,
        });
        // update current
        await supabaseAdmin
          .from('domain_data')
          .update({ record: newRec, updated_at: new Date().toISOString() })
          .eq('domain_id', id)
          .eq('key_hash', row.key_hash);
      }
      transformedRecords.push(newRec);
    }

    // Compute simple validation metrics if provided in rules
    const metrics = { changed_rows: changed, rule_count: rules?.length || 0 };
    // Dedup metric: estimate how many rows would be removed
    try {
      let dedupbed = transformedRecords;
      for (const cfg of dedupConfigs) dedupbed = applyDedup(dedupbed, cfg);
      const removed = Math.max(0, (transformedRecords?.length || 0) - (dedupbed?.length || 0));
      if (removed > 0) metrics.dedup_removed = removed;
    } catch {}
    let regexFails = 0;
    for (const r of rules || []) {
      const checks = r.definition?.checks || [];
      for (const chk of checks) {
        if (chk.name === 'regex' && chk.column && chk.pattern) {
          const re = new RegExp(chk.pattern);
          for (const row of rows || []) if (!re.test(String(row.record[chk.column] ?? ''))) regexFails++;
        }
      }
    }
    if (regexFails) metrics.regex_fails = regexFails;

    // Create rule_run summary
    await supabaseAdmin.from('rule_runs').insert({
      rule_id: null,
      domain_version_id: null,
      status: 'completed',
      metrics,
      output_version_id: verOut.id,
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
    });

    await auditLog({ actorId: userId, tenantId, action: 'update', resource: 'domain', resourceId: id, meta: { clean_changed: changed } });
    res.json({ ok: true, changed, version: verOut });
  } catch (e) {
    res.status(400).json({ error: e.message || 'clean failed' });
  }
});
export default router;

// ---------- Helpers ----------
function sha256(input) {
  return crypto.createHash('sha256').update(String(input)).digest('hex');
}

async function getDomain(client, id) {
  const { data, error } = await client.from('domains').select('*').eq('id', id).single();
  if (error) throw error;
  return data;
}

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

// Ingest a file from Storage into domain_versions + domain_data/history
router.post('/:id/ingest', async (req, res) => {
  try {
    const { id } = req.params;
    const tenantId = await resolveTenantId(req);
    const userId = req.user?.id;
    const { path } = req.body || {};
    if (!path) return res.status(400).json({ error: 'path required (e.g., key in storage bucket "domains")' });

    // Domain ownership check
    const domain = await getDomain(supabaseAdmin, id);
    if (!domain || domain.tenant_id !== tenantId) return res.status(403).json({ error: 'Forbidden' });

    // Download file from storage
    const { data: blob, error: dlErr } = await supabaseAdmin.storage.from('domains').download(path);
    if (dlErr) return res.status(400).json({ error: dlErr.message });
    const buf = Buffer.from(await blob.arrayBuffer());

    // Parse via xlsx; take first sheet
    const wb = XLSX.read(buf, { type: 'buffer' });
    const sheetName = wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: null });
    // Read header row (A1 style) correctly; do not use Object.keys on an array
    const a1 = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false });
    let columns = Array.isArray(a1?.[0]) ? a1[0] : [];
    columns = (columns || []).map((c) => String(c ?? '').trim()).filter(Boolean);
    const rows_count = rows.length;

    // Insert domain_version
    const versionPayload = {
      domain_id: id,
      file_path: path,
      rows_count,
      columns: columns.length ? columns : Object.keys(rows[0] || {}),
      import_summary: { sheet: sheetName },
    };
    const { data: ver, error: verErr } = await supabaseAdmin
      .from('domain_versions').insert(versionPayload).select().single();
    if (verErr) return res.status(400).json({ error: verErr.message });

    // Compute effective business key: use only keys present in the file; if none, stop and ask user to set it
    const headerCols = Object.keys(rows[0] || {});
    let bk = [];
    if (Array.isArray(domain.business_key) && domain.business_key.length) {
      bk = domain.business_key.filter((k) => headerCols.includes(k));
    }
    if (!bk.length) {
      return res.status(400).json({ error: 'Domain business_key does not match any file columns. Please update the domain business_key to one or more of: ' + headerCols.join(', ') });
    }

    // Optionally persist raw snapshot rows if table exists (best-effort)
    try {
      const payload = rows.map((rec, idx) => ({ domain_id: id, version_id: ver.id, row_index: idx, record: rec }));
      // chunk insert to avoid large payloads
      const chunkSize = 1000;
      for (let i = 0; i < payload.length; i += chunkSize) {
        const chunk = payload.slice(i, i + chunkSize);
        await supabaseAdmin.from('domain_rows').insert(chunk);
      }
    } catch {}

    // Upsert current data and write history on changes
    for (const r of rows) {
      const keyValues = Object.fromEntries(bk.map((k) => [k, r[k] ?? null]));
      const keyHash = sha256(bk.map((k) => r[k] ?? '').join('|'));
      const record = r;

      // Fetch existing
      const { data: existing, error: exErr } = await supabaseAdmin
        .from('domain_data')
        .select('record')
        .eq('domain_id', id)
        .eq('key_hash', keyHash)
        .maybeSingle();
      if (exErr) return res.status(400).json({ error: exErr.message });

      if (existing?.record) {
        // If changed, archive old and update current
        const changed = JSON.stringify(existing.record) !== JSON.stringify(record);
        if (changed) {
          const { error: histErr } = await supabaseAdmin.from('domain_history').insert({
            domain_id: id,
            key_hash: keyHash,
            key_values: keyValues,
            record: existing.record,
            source_version_id: ver.id,
          });
          if (histErr) return res.status(400).json({ error: histErr.message });
          const { error: updErr } = await supabaseAdmin
            .from('domain_data')
            .update({ record, key_values: keyValues, updated_at: new Date().toISOString() })
            .eq('domain_id', id)
            .eq('key_hash', keyHash);
          if (updErr) return res.status(400).json({ error: updErr.message });
        }
      } else {
        const { error: insErr } = await supabaseAdmin.from('domain_data').insert({
          domain_id: id,
          key_hash: keyHash,
          key_values: keyValues,
          record,
        });
        if (insErr) return res.status(400).json({ error: insErr.message });
      }
    }

    // Update current_version on domain
    await supabaseAdmin.from('domains').update({ current_version_id: ver.id, updated_at: new Date().toISOString() }).eq('id', id);

    await auditLog({ actorId: userId, tenantId, action: 'update', resource: 'domain', resourceId: id, meta: { ingested: rows_count, file: path } });
    res.json({ ok: true, version: ver, rows: rows_count });
  } catch (e) {
    res.status(400).json({ error: e.message || 'ingest failed' });
  }
});
