import express from 'express';
import crypto from 'crypto';
import * as XLSX from 'xlsx';
import nodePath from 'path';
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
  const insert = { domain_id: id, name, definition: normalizeRuleDefinition(definition), created_by: userId };
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
  if (definition !== undefined) patch.definition = normalizeRuleDefinition(definition);
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
  const { id } = req.params;
  const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
  const offset = Math.max(parseInt(req.query.offset || '0', 10), 0);
  const tenantId = await resolveTenantId(req);
  const { data: dom } = await supabaseAdmin.from('domains').select('tenant_id').eq('id', id).single();
  if (!dom || dom.tenant_id !== tenantId) return res.status(403).json({ error: 'Forbidden' });
  const { data, error } = await supabaseAdmin
    .from('domain_data')
    .select('record')
    .eq('domain_id', id)
    .range(offset, offset + limit - 1);
  if (error) return res.status(400).json({ error: error.message });
  const { data: latest } = await supabaseAdmin
    .from('domain_versions')
    .select('id')
    .eq('domain_id', id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const versionId = latest?.id || null;
  res.json((data || []).map((r) => ({ ...r.record, source_version_id: versionId })));
});

// Preview latest version's historical data (rows captured for the latest version)
router.get('/:id/version/latest/preview', async (req, res) => {
  const { id } = req.params;
  const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
  const offset = Math.max(parseInt(req.query.offset || '0', 10), 0);
  const tenantId = await resolveTenantId(req);
  const { data: dom } = await supabaseAdmin.from('domains').select('tenant_id, current_version_id').eq('id', id).single();
  if (!dom || dom.tenant_id !== tenantId) return res.status(403).json({ error: 'Forbidden' });

  // Find latest domain_version for this domain
  const { data: latest, error: vErr } = await supabaseAdmin
    .from('domain_versions')
    .select('id')
    .eq('domain_id', id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (vErr) return res.status(400).json({ error: vErr.message });
  if (!latest?.id) return res.json([]);

  // Fetch rows from domain_history for that version
  const { data, error } = await supabaseAdmin
    .from('domain_history')
    .select('record, source_version_id')
    .eq('domain_id', id)
    .eq('source_version_id', latest.id)
    .range(offset, offset + limit - 1);
  if (error) return res.status(400).json({ error: error.message });
  res.json((data || []).map((r) => ({ ...r.record, source_version_id: r.source_version_id })));
});

// Export latest version's historical data as CSV
router.get('/:id/version/latest/export.csv', async (req, res) => {
  try {
    const { id } = req.params;
    const tenantId = await resolveTenantId(req);
    const { data: dom, error: dErr } = await supabaseAdmin
      .from('domains')
      .select('tenant_id, name')
      .eq('id', id)
      .single();
    if (dErr) return res.status(400).json({ error: dErr.message });
    if (!dom || dom.tenant_id !== tenantId) return res.status(403).json({ error: 'Forbidden' });

    // Find latest domain_version for this domain
    const { data: latest, error: vErr } = await supabaseAdmin
      .from('domain_versions')
      .select('id')
      .eq('domain_id', id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (vErr) return res.status(400).json({ error: vErr.message });
    if (!latest?.id) return res.status(404).json({ error: 'No versions found' });

    // Page through history to gather all records for latest version
    const pageSize = 1000;
    let offset = 0;
    /** @type {Array<Record<string, any>>} */
    const rows = [];
    while (true) {
      const { data, error } = await supabaseAdmin
        .from('domain_history')
        .select('record')
        .eq('domain_id', id)
        .eq('source_version_id', latest.id)
        .range(offset, offset + pageSize - 1);
      if (error) return res.status(400).json({ error: error.message });
      const batch = (data || []).map((r) => r.record || {});
      rows.push(...batch);
      if (!data || data.length < pageSize) break;
      offset += pageSize;
    }

    // Compute ordered headers (union of keys, preserve first-seen order)
    const headerSet = new Set();
    for (const r of rows) for (const k of Object.keys(r || {})) headerSet.add(k);
    const headers = Array.from(headerSet);

    // Build CSV via XLSX
    const ws = XLSX.utils.json_to_sheet(rows, { header: headers });
    const csv = XLSX.utils.sheet_to_csv(ws);

    // Send as attachment
    const safeName = String(dom.name || `domain_${id}`).replace(/[^a-z0-9_\-]+/gi, '_').toLowerCase();
    const fileName = `${safeName}_latest.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(csv);
  } catch (e) {
    res.status(500).json({ error: e.message || 'Export failed' });
  }
});

// Stats for latest version (row count and total amount if present)
router.get('/:id/version/latest/stats', async (req, res) => {
  try {
    const { id } = req.params;
    const tenantId = await resolveTenantId(req);
    const { data: dom, error: dErr } = await supabaseAdmin
      .from('domains')
      .select('tenant_id')
      .eq('id', id)
      .single();
    if (dErr) return res.status(400).json({ error: dErr.message });
    if (!dom || dom.tenant_id !== tenantId) return res.status(403).json({ error: 'Forbidden' });

    const { data: latest, error: vErr } = await supabaseAdmin
      .from('domain_versions')
      .select('id')
      .eq('domain_id', id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (vErr) return res.status(400).json({ error: vErr.message });
    if (!latest?.id) return res.json({ rowCount: 0, totalAmount: 0 });

    // Count rows quickly
    const { count, error: cErr } = await supabaseAdmin
      .from('domain_history')
      .select('id', { count: 'exact', head: true })
      .eq('domain_id', id)
      .eq('source_version_id', latest.id);
    if (cErr) return res.status(400).json({ error: cErr.message });

    // Sum Amount if present by scanning in pages
    const pageSize = 1000;
    let offset = 0;
    let totalAmount = 0;
    while (true) {
      const { data, error } = await supabaseAdmin
        .from('domain_history')
        .select('record')
        .eq('domain_id', id)
        .eq('source_version_id', latest.id)
        .range(offset, offset + pageSize - 1);
      if (error) return res.status(400).json({ error: error.message });
      for (const row of data || []) {
        const rec = row.record || {};
        const val = rec.Amount ?? rec.amount ?? null;
        const num = typeof val === 'number' ? val : Number(val);
        if (!Number.isNaN(num) && Number.isFinite(num)) totalAmount += num;
      }
      if (!data || data.length < pageSize) break;
      offset += pageSize;
    }

    res.json({ rowCount: count || 0, totalAmount });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Stats failed' });
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
      .select('key_hash, key_values, record, updated_at')
      .eq('domain_id', id)
      .limit(20000);

    // Apply transforms (standardization, type conversion, structural per-row)
    const applyTransforms = (rec, defs = []) => {
      let out = { ...rec };
      const toTitleCase = (s) => String(s)
        .toLowerCase()
        .replace(/\b([a-z])(\w*)/g, (_, a, b) => a.toUpperCase() + b);
      const normalizeNullTokens = new Set(['', 'null', 'n/a', 'na', 'none', '-', 'n\u00a0/a']);
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
        if (def.name === 'titlecase') {
          const cols = def.columns || Object.keys(out);
          for (const c of cols) if (typeof out[c] === 'string') out[c] = toTitleCase(out[c]);
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
        if (def.name === 'categorical_map') {
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
        if (def.name === 'fill_missing') {
          // def.columns + def.value OR def.defaults { col: value }
          const defaults = def.defaults || {};
          if (Array.isArray(def.columns) && def.value !== undefined) {
            for (const c of def.columns) if (out[c] == null || out[c] === '') out[c] = def.value;
          }
          for (const [k, v] of Object.entries(defaults)) if (out[k] == null || out[k] === '') out[k] = v;
        }
        if (def.name === 'normalize_nulls') {
          const cols = def.columns || Object.keys(out);
          const tokens = Array.isArray(def.tokens) && def.tokens.length ? def.tokens : Array.from(normalizeNullTokens);
          const tokenSet = new Set(tokens.map((t) => String(t).toLowerCase()));
          const toValue = def.hasOwnProperty('toValue') ? def.toValue : null; // default is actual null
          for (const c of cols) {
            const v = out[c];
            if (v == null) { if (def.hasOwnProperty('toValue')) out[c] = toValue; continue; }
            if (typeof v === 'string') {
              const s = v.trim();
              if (tokenSet.has(s.toLowerCase())) out[c] = toValue;
            }
          }
        }
        // New transforms
        if (def.name === 'to_number') {
          const col = def.column;
          if (col && out[col] != null) {
            const raw = String(out[col]).replace(/[,\s]/g, '');
            const num = Number(raw);
            if (!Number.isNaN(num)) out[col] = num;
          }
        }
        if (def.name === 'to_boolean') {
          const col = def.column;
          const fmt = (def.format || 'boolean').toLowerCase(); // 'boolean' | 'yesno' | 'yn' | '10'
          if (col && out[col] != null) {
            const raw = String(out[col]).trim().toLowerCase();
            const truthy = new Set(['true','1','yes','y','on']);
            const falsy = new Set(['false','0','no','n','off']);
            let val;
            if (truthy.has(raw)) val = true;
            else if (falsy.has(raw)) val = false;
            else val = out[col];
            if (typeof val === 'boolean') {
              if (fmt === 'boolean') out[col] = val;
              else if (fmt === 'yesno') out[col] = val ? 'Yes' : 'No';
              else if (fmt === 'yn') out[col] = val ? 'Y' : 'N';
              else if (fmt === '10') out[col] = val ? 1 : 0;
              else out[col] = val;
            }
          }
        }
        if (def.name === 'strip_non_digits') {
          const col = def.column;
          if (col && typeof out[col] === 'string') out[col] = out[col].replace(/\D+/g, '');
        }
        if (def.name === 'standardize_phone') {
          const col = def.column;
          if (col && out[col] != null) {
            let digits = String(out[col]).replace(/\D+/g, '');
            if (def.countryCode && typeof def.countryCode === 'string') {
              const cc = def.countryCode.replace(/[^0-9+]/g, '');
              // naive: if starts with 0 and country provided, drop leading 0 and prepend cc without '+' for digits, with '+' if keeping string
              if (digits.startsWith('0')) digits = digits.slice(1);
              const ccDigits = cc.replace(/\D+/g, '');
              digits = ccDigits + digits;
            }
            const fmt = (def.format || 'digits').toLowerCase(); // 'digits' | 'e164'
            if (fmt === 'e164') out[col] = digits ? ('+' + digits) : '';
            else out[col] = digits;
          }
        }
        if (def.name === 'standardize_date') {
          const col = def.column;
          const fmt = (def.format || 'ISO').toUpperCase();
          if (col && out[col] != null) {
            const d = new Date(out[col]);
            if (!isNaN(d.getTime())) {
              if (fmt === 'ISO') out[col] = d.toISOString();
              else if (fmt === 'YYYY-MM-DD' || fmt === 'DATE_ONLY') out[col] = d.toISOString().slice(0,10);
              else out[col] = d.toISOString();
            }
          }
        }
        if (def.name === 'split') {
          const src = def.column;
          const targets = Array.isArray(def.targets) ? def.targets : [];
          if (src && targets.length && typeof out[src] === 'string') {
            let parts = [];
            if (def.delimiter) parts = String(out[src]).split(def.delimiter);
            else if (def.pattern) {
              try { const rx = new RegExp(def.pattern); const m = String(out[src]).match(rx); parts = m ? m.slice(1) : []; } catch {}
            }
            for (let i = 0; i < targets.length; i++) {
              out[targets[i]] = parts[i] ?? '';
            }
          }
        }
        if (def.name === 'merge') {
          const sources = Array.isArray(def.sources) ? def.sources : [];
          const target = def.target;
          const sep = def.separator ?? ' ';
          if (target && sources.length) {
            const vals = sources.map((s) => out[s]).filter((v) => v != null && v !== '');
            out[target] = vals.join(sep);
          }
        }
        if (def.name === 'extract_email_domain') {
          const src = def.column || 'email';
          const target = def.target || 'email_domain';
          const v = out[src];
          if (typeof v === 'string' && v.includes('@')) {
            out[target] = v.split('@').pop().trim().toLowerCase();
          }
        }
        if (def.name === 'extract_domain') {
          const src = def.column;
          const target = def.target || 'domain';
          const v = out[src];
          if (typeof v === 'string') {
            try {
              if (v.includes('@')) out[target] = v.split('@').pop().trim().toLowerCase();
              else { const u = new URL(v); out[target] = (u.hostname || '').toLowerCase(); }
            } catch {}
          }
        }
      }
      return out;
    };

    let changed = 0;
    const transforms = [];
    for (const r of rules || []) {
      if (r.definition?.transforms) transforms.push(...r.definition.transforms);
    }

    // Find latest version for linkage and metadata
    const { data: latestVer } = await supabaseAdmin
      .from('domain_versions')
      .select('id, file_path, columns, import_summary')
      .eq('domain_id', id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    // Fallback: latest ingest that has a file_path/columns
    let latestIngest = null;
    if (!latestVer?.file_path || !latestVer?.columns || latestVer.columns?.length === 0) {
      const { data: li } = await supabaseAdmin
        .from('domain_versions')
        .select('id, file_path, columns')
        .eq('domain_id', id)
        .not('file_path', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      latestIngest = li || null;
    }

    // Create output version record (inherit file_path/columns from latest where possible)
    const cleanSummary = { action: 'clean' };
    if (latestVer?.id) cleanSummary.source_version_id = latestVer.id;
    const derivedColumns = (() => {
      try { return Object.keys((rows?.[0]?.record) || {}); } catch { return []; }
    })();
    const finalFilePath = latestVer?.file_path || latestIngest?.file_path || null;
    const finalColumns = (latestVer?.columns && latestVer.columns.length ? latestVer.columns
                         : latestIngest?.columns && latestIngest.columns.length ? latestIngest.columns
                         : derivedColumns);
    const { data: verOut, error: vErr } = await supabaseAdmin
      .from('domain_versions')
      .insert({
        domain_id: id,
        file_path: finalFilePath,
        rows_count: rows?.length || 0,
        columns: finalColumns,
        import_summary: cleanSummary,
      })
      .select()
      .single();
    if (vErr) return res.status(400).json({ error: vErr.message });

    // Filter/Cleansing pass: drop/flag rows matching conditions
    const filterRules = (rules || []).filter((r) => Array.isArray(r.definition?.checks) && r.definition.checks.length);
    // Column resolver for conditions (case-insensitive)
    const sampleEvalCols = Object.keys((rows?.[0]?.record) || {});
    const lowerToActualEval = new Map(sampleEvalCols.map((c) => [String(c).toLowerCase(), c]));
    const evalCondition = (row, cond) => {
      // Very small parser: "Column OP Value" with OP in [==,!=,>,>=,<,<=]
      // Value may be number or quoted string
      try {
        const m = String(cond).match(/^\s*([^<>!=]+)\s*(==|!=|>=|<=|>|<)\s*(.+)\s*$/);
        if (!m) return false;
        const colInput = m[1].trim();
        const col = lowerToActualEval.get(colInput.toLowerCase()) || colInput;
        const op = m[2];
        let rhsRaw = m[3].trim();
        let rhs;
        if ((rhsRaw.startsWith("'") && rhsRaw.endsWith("'")) || (rhsRaw.startsWith('"') && rhsRaw.endsWith('"'))) rhs = rhsRaw.slice(1, -1);
        else if (!isNaN(Number(rhsRaw))) rhs = Number(rhsRaw);
        else rhs = rhsRaw;
        const lhs = row.record?.[col];
        const a = typeof lhs === 'number' ? lhs : Number(lhs);
        const b = typeof rhs === 'number' ? rhs : Number(rhs);
        const comparable = (x) => (typeof x === 'number' && !Number.isNaN(x)) ? x : String(x ?? '');
        const A = (typeof lhs === 'number' || typeof rhs === 'number') ? (isNaN(a) ? lhs : a) : comparable(lhs);
        const B = (typeof lhs === 'number' || typeof rhs === 'number') ? (isNaN(b) ? rhs : b) : comparable(rhs);
        switch (op) {
          case '==': return A == B;
          case '!=': return A != B;
          case '>': return A > B;
          case '>=': return A >= B;
          case '<': return A < B;
          case '<=': return A <= B;
          default: return false;
        }
      } catch { return false; }
    };
    const parseDate = (v) => {
      const d = new Date(v);
      return isNaN(d.getTime()) ? null : d;
    };
    // Outlier helper: z-score threshold
    const zscoreFilter = (col, threshold) => {
      const vals = (rows || []).map(r => Number(r.record?.[col])).filter(v => typeof v === 'number' && !Number.isNaN(v));
      if (!vals.length) return new Set();
      const mean = vals.reduce((a,b)=>a+b,0)/vals.length;
      const variance = vals.reduce((a,b)=>a+(b-mean)*(b-mean),0)/vals.length;
      const std = Math.sqrt(variance) || 1;
      const bad = new Set();
      for (const r of rows || []) {
        const v = Number(r.record?.[col]);
        if (typeof v === 'number' && !Number.isNaN(v)) {
          const z = Math.abs((v - mean) / std);
          if (z > threshold) bad.add(r.key_hash);
        }
      }
      return bad;
    };
    const filterDeletes = new Set();
    let flaggedCount = 0;
    // Cache for referential integrity checks
    const refCache = new Map(); // key: `${domainId}::${column}` => Set of values
    for (const r of filterRules) {
      const rTransforms = Array.isArray(r.definition?.transforms) ? r.definition.transforms : [];
      for (const chk of r.definition.checks || []) {
        if (chk.name === 'drop_if' && chk.condition) {
          for (const row of rows || []) {
            const vRec = rTransforms.length ? applyTransforms(row.record, rTransforms) : row.record;
            const vRow = { ...row, record: vRec };
            if (evalCondition(vRow, chk.condition)) filterDeletes.add(row.key_hash);
          }
        }
        if (chk.name === 'drop_if_null' && Array.isArray(chk.columns)) {
          for (const row of rows || []) {
            const vRec = rTransforms.length ? applyTransforms(row.record, rTransforms) : row.record;
            if (chk.columns.some((c) => vRec?.[c] == null || vRec[c] === '')) filterDeletes.add(row.key_hash);
          }
        }
        if (chk.name === 'require_columns' && Array.isArray(chk.columns)) {
          const action = (chk.action || 'drop').toLowerCase(); // 'drop' | 'flag'
          for (const row of rows || []) {
            const vRec = rTransforms.length ? applyTransforms(row.record, rTransforms) : row.record;
            const missing = chk.columns.some((c) => vRec?.[c] == null || vRec[c] === '');
            if (missing) {
              if (action === 'drop') filterDeletes.add(row.key_hash);
              else flaggedCount++;
            }
          }
        }
        if (chk.name === 'drop_if_missing_pct_gt') {
          const thr = Number(chk.threshold || 50);
          for (const row of rows || []) {
            const vRec = rTransforms.length ? applyTransforms(row.record, rTransforms) : row.record;
            const vals = Object.values(vRec || {});
            if (!vals.length) continue;
            const missing = vals.reduce((acc, v) => acc + ((v == null || v === '') ? 1 : 0), 0);
            const pct = (missing / vals.length) * 100;
            if (pct > thr) filterDeletes.add(row.key_hash);
          }
        }
        if (chk.name === 'validate_email' && chk.column) {
          const action = (chk.action || 'flag').toLowerCase();
          const re = /^(?=.{1,254}$)(?=.{1,64}@)[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;
          for (const row of rows || []) {
            const vRec = rTransforms.length ? applyTransforms(row.record, rTransforms) : row.record;
            const ok = re.test(String(vRec?.[chk.column] ?? ''));
            if (!ok) {
              if (action === 'drop') filterDeletes.add(row.key_hash);
              else flaggedCount++;
            }
          }
        }
        if (chk.name === 'drop_if_out_of_range' && chk.column) {
          const min = chk.min !== undefined ? Number(chk.min) : null;
          const max = chk.max !== undefined ? Number(chk.max) : null;
          for (const row of rows || []) {
            const vRec = rTransforms.length ? applyTransforms(row.record, rTransforms) : row.record;
            const v = Number(vRec?.[chk.column]);
            if (Number.isNaN(v)) continue;
            if ((min != null && v < min) || (max != null && v > max)) filterDeletes.add(row.key_hash);
          }
        }
        if (chk.name === 'drop_if_not_in' && chk.column && Array.isArray(chk.values)) {
          const allow = new Set(chk.values.map((x) => String(x)));
          for (const row of rows || []) {
            const vRec = rTransforms.length ? applyTransforms(row.record, rTransforms) : row.record;
            const v = vRec?.[chk.column];
            if (!allow.has(String(v))) filterDeletes.add(row.key_hash);
          }
        }
        if (chk.name === 'drop_if_pattern' && chk.column && chk.pattern) {
          let re = null; try { re = new RegExp(chk.pattern, chk.flags || ''); } catch {}
          if (re) {
            for (const row of rows || []) {
              const vRec = rTransforms.length ? applyTransforms(row.record, rTransforms) : row.record;
              const v = String(vRec?.[chk.column] ?? '');
              if (re.test(v)) filterDeletes.add(row.key_hash);
            }
          }
        }
        if (chk.name === 'drop_if_all' && Array.isArray(chk.conditions) && chk.conditions.length) {
          for (const row of rows || []) {
            const vRec = rTransforms.length ? applyTransforms(row.record, rTransforms) : row.record;
            const vRow = { ...row, record: vRec };
            const allTrue = chk.conditions.every((cond) => evalCondition(vRow, cond));
            if (allTrue) filterDeletes.add(row.key_hash);
          }
        }
        if (chk.name === 'drop_if_date_not_between' && chk.column) {
          const from = chk.from != null ? parseDate(chk.from) : null;
          const to = chk.to != null ? parseDate(chk.to) : null;
          for (const row of rows || []) {
            const vRec = rTransforms.length ? applyTransforms(row.record, rTransforms) : row.record;
            const d = parseDate(vRec?.[chk.column]);
            if (!d) continue;
            if ((from && d < from) || (to && d > to)) filterDeletes.add(row.key_hash);
          }
        }
        if (chk.name === 'drop_if_start_after_end' && chk.start && chk.end) {
          for (const row of rows || []) {
            const vRec = rTransforms.length ? applyTransforms(row.record, rTransforms) : row.record;
            const a = parseDate(vRec?.[chk.start]);
            const b = parseDate(vRec?.[chk.end]);
            if (a && b && a > b) filterDeletes.add(row.key_hash);
          }
        }
        if (chk.name === 'drop_if_relation' && chk.left && chk.op && chk.right != null) {
          const op = chk.op;
          for (const row of rows || []) {
            const vRec = rTransforms.length ? applyTransforms(row.record, rTransforms) : row.record;
            const leftKey = typeof chk.left === 'string' ? (lowerToActualEval.get(String(chk.left).toLowerCase()) || chk.left) : chk.left;
            const rightKey = typeof chk.right === 'string' ? (lowerToActualEval.get(String(chk.right).toLowerCase()) || chk.right) : chk.right;
            const lv = (typeof leftKey === 'string' && vRec?.[leftKey] !== undefined) ? vRec[leftKey] : leftKey;
            const rv = (typeof rightKey === 'string' && vRec?.[rightKey] !== undefined) ? vRec[rightKey] : rightKey;
            const A = typeof lv === 'number' ? lv : Number(lv);
            const B = typeof rv === 'number' ? rv : Number(rv);
            const L = (typeof lv === 'number' || typeof rv === 'number') ? (isNaN(A) ? lv : A) : String(lv ?? '');
            const R = (typeof lv === 'number' || typeof rv === 'number') ? (isNaN(B) ? rv : B) : String(rv ?? '');
            let truth = false;
            switch (op) {
              case '==': truth = (L == R); break;
              case '!=': truth = (L != R); break;
              case '>': truth = (L > R); break;
              case '>=': truth = (L >= R); break;
              case '<': truth = (L < R); break;
              case '<=': truth = (L <= R); break;
            }
            if (truth) filterDeletes.add(row.key_hash);
          }
        }
        if (chk.name === 'exists_in_domain' && chk.column && (chk.target_domain_id || chk.target_domain) && chk.target_column) {
          // Build allowed set from another domain's current data
          const targetId = String(chk.target_domain_id || chk.target_domain);
          const cacheKey = `${targetId}::${chk.target_column}`;
          let allowed = refCache.get(cacheKey);
          if (!allowed) {
            allowed = new Set();
            let off = 0; const page = 1000;
            // page through target domain_data to build set
            while (true) {
              const { data: refPage, error: refErr } = await supabaseAdmin
                .from('domain_data')
                .select('record')
                .eq('domain_id', targetId)
                .range(off, off + page - 1);
              if (refErr) break;
              if (!refPage || refPage.length === 0) break;
              for (const r2 of refPage) {
                const val = (r2?.record || {})[chk.target_column];
                if (val != null) allowed.add(String(val));
              }
              if (refPage.length < page) break;
              off += page;
              if (off > 100000) break; // safety cap
            }
            refCache.set(cacheKey, allowed);
          }
          const action = (chk.action || 'flag').toLowerCase();
          for (const row of rows || []) {
            const vRec = rTransforms.length ? applyTransforms(row.record, rTransforms) : row.record;
            const v = vRec?.[chk.column];
            if (!allowed.has(String(v))) {
              if (action === 'drop') filterDeletes.add(row.key_hash);
              else flaggedCount++;
            }
          }
        }
        if (chk.name === 'drop_if_zscore_gt' && chk.column) {
          const thr = Number(chk.threshold || 3);
          const bad = zscoreFilter(chk.column, thr > 0 ? thr : 3);
          for (const k of bad) filterDeletes.add(k);
        }
      }
    }

    // Dedup pass: remove duplicates based on rules with meta.type/category "dedup"
    const dedupRules = (rules || []).filter((r) => {
      const meta = r.definition?.meta || {};
      const t = (meta.type || meta.category || '').toString().toLowerCase();
      return t === 'dedup' && Array.isArray(meta.keys) && meta.keys.length > 0;
    });

    // Helper: resolve column name case-insensitively
    const sampleCols = Object.keys((rows?.[0]?.record) || {});
    const lowerToActual = new Map(sampleCols.map((c) => [String(c).toLowerCase(), c]));
    const resolveCol = (name) => lowerToActual.get(String(name || '').toLowerCase()) || name;

    // Build a set of key_hashes to delete and per-rule metrics
    const toDelete = new Set(filterDeletes);
    const dedupRemovedByRule = new Map();

    if (dedupRules.length && Array.isArray(rows) && rows.length) {
      for (const r of dedupRules) {
        const meta = r.definition?.meta || {};
        const keep = (meta.keep || 'last').toString().toLowerCase(); // 'first' | 'last'
        const keys = (meta.keys || []).map((k) => resolveCol(k));
        // group by computed key
        const groups = new Map(); // key -> { keepRow, others[] }
        for (const row of rows) {
          // skip if already marked for deletion by a previous dedup rule
          if (toDelete.has(row.key_hash)) continue;
          const parts = keys.map((k) => String(row.record?.[k] ?? '').trim().toLowerCase());
          const hasAny = parts.some((p) => p.length > 0);
          if (!hasAny) continue;
          const gk = parts.join('|');
          const cur = groups.get(gk);
          if (!cur) {
            groups.set(gk, { keepRow: row, others: [] });
          } else {
            // choose keeper by updated_at
            const a = new Date(cur.keepRow?.updated_at || 0).getTime();
            const b = new Date(row?.updated_at || 0).getTime();
            if (keep === 'first') {
              // older wins
              if (b < a) { cur.others.push(cur.keepRow); cur.keepRow = row; } else { cur.others.push(row); }
            } else {
              // last: newer wins
              if (b > a) { cur.others.push(cur.keepRow); cur.keepRow = row; } else { cur.others.push(row); }
            }
          }
        }
        let removed = 0;
        for (const { others } of groups.values()) {
          for (const dup of others) {
            // delete from current (do not write removed rows to history; latest version should contain only the kept rows)
            await supabaseAdmin
              .from('domain_data')
              .delete()
              .eq('domain_id', id)
              .eq('key_hash', dup.key_hash);
            toDelete.add(dup.key_hash);
            removed++;
          }
        }
        if (removed) {
          dedupRemovedByRule.set(r.id, removed);
          changed += removed;
        }
      }
    }

    // Delete rows marked by filter checks (batch by chunks)
    if (filterDeletes.size) {
      const keys = Array.from(filterDeletes);
      const chunkSize = 1000;
      for (let i = 0; i < keys.length; i += chunkSize) {
        const chunk = keys.slice(i, i + chunkSize);
        const { error: delErr } = await supabaseAdmin
          .from('domain_data')
          .delete()
          .eq('domain_id', id)
          .in('key_hash', chunk);
        if (delErr) return res.status(400).json({ error: `filter delete failed: ${delErr.message}` });
      }
    }

    // Apply transforms only to rows that remain after deletions/dedup
    for (const row of rows || []) {
      if (toDelete.has(row.key_hash)) continue;
      const newRec = applyTransforms(row.record, transforms);
      if (JSON.stringify(newRec) !== JSON.stringify(row.record)) {
        changed++;
        // update current in place
        await supabaseAdmin
          .from('domain_data')
          .update({ record: newRec, updated_at: new Date().toISOString() })
          .eq('domain_id', id)
          .eq('key_hash', row.key_hash);
      }
    }

    // Compute metrics overall and per rule
    const metrics = { changed_rows: changed, rule_count: rules?.length || 0 };
    if (flaggedCount) metrics.flagged = flaggedCount;
    const perRuleMetrics = new Map();
    // Precompute per-rule changed row estimates and regex fails
    for (const r of rules || []) {
      const base = { dedup_removed: dedupRemovedByRule.get(r.id) || 0 };
      let changedRowsEstimate = 0;
      const rTransforms = Array.isArray(r.definition?.transforms) ? r.definition.transforms : [];
      if (rTransforms.length) {
        for (const row of rows || []) {
          if (toDelete.has(row.key_hash)) continue;
          const newRec = applyTransforms(row.record, rTransforms);
          if (JSON.stringify(newRec) !== JSON.stringify(row.record)) changedRowsEstimate++;
        }
      }
      let regexFails = 0;
      const checks = Array.isArray(r.definition?.checks) ? r.definition.checks : [];
      for (const chk of checks) {
        if (chk?.name === 'regex' && chk.column && chk.pattern) {
          const re = new RegExp(chk.pattern);
          for (const row of rows || []) if (!toDelete.has(row.key_hash) && !re.test(String(row.record?.[chk.column] ?? ''))) regexFails++;
        }
      }
      perRuleMetrics.set(r.id, {
        ...base,
        changed_rows_estimate: changedRowsEstimate,
        regex_fails: regexFails || undefined,
        transform_count: rTransforms.length || 0,
        check_count: checks.length || 0,
      });
    }
    // Aggregate regex fails overall
    const totalRegexFails = Array.from(perRuleMetrics.values()).reduce((acc, m) => acc + (m.regex_fails || 0), 0);
    if (totalRegexFails) metrics.regex_fails = totalRegexFails;
    const totalDedupRemoved = Array.from(perRuleMetrics.values()).reduce((acc, m) => acc + (m.dedup_removed || 0), 0);
    if (totalDedupRemoved) metrics.dedup_removed = totalDedupRemoved;

    // Create a rule_run row per rule to link outputs properly
    const startedAt = new Date().toISOString();
    const finishedAt = new Date().toISOString();
    const inserts = (rules || []).map((r) => ({
      rule_id: r.id,
      domain_version_id: latestVer?.id || null,
      status: 'completed',
      metrics: perRuleMetrics.get(r.id) || {},
      output_version_id: verOut.id,
      started_at: startedAt,
      finished_at: finishedAt,
    }));
    if (inserts.length) await supabaseAdmin.from('rule_runs').insert(inserts);

    // Snapshot final current rows as the latest version in domain_history
    // Fetch remaining current rows and insert as the snapshot for verOut
    let offset = 0; const pageSize = 1000; let totalSnap = 0;
    while (true) {
      const { data: curPage, error: curErr } = await supabaseAdmin
        .from('domain_data')
        .select('key_hash, key_values, record')
        .eq('domain_id', id)
        .range(offset, offset + pageSize - 1);
      if (curErr) return res.status(400).json({ error: curErr.message });
      if (!curPage || curPage.length === 0) break;
      const batch = curPage.map((r) => ({ domain_id: id, key_hash: r.key_hash, key_values: r.key_values, record: r.record, source_version_id: verOut.id }));
      const { error: snapErr } = await supabaseAdmin.from('domain_history').insert(batch);
      if (snapErr) return res.status(400).json({ error: snapErr.message });
      totalSnap += batch.length;
      if (curPage.length < pageSize) break;
      offset += pageSize;
    }

    // Verify snapshot size equals current rows
    const { count: curCountAfter, error: curCntAfterErr } = await supabaseAdmin
      .from('domain_data')
      .select('key_hash', { count: 'exact', head: true })
      .eq('domain_id', id);
    if (curCntAfterErr) return res.status(400).json({ error: `final current count failed: ${curCntAfterErr.message}` });
    if ((curCountAfter || 0) !== totalSnap) {
      return res.status(400).json({ error: `snapshot mismatch: current=${curCountAfter || 0} history=${totalSnap}` });
    }

    // Update output version's rows_count to reflect post-dedup row count (from snapshot)
    await supabaseAdmin
      .from('domain_versions')
      .update({ rows_count: totalSnap })
      .eq('id', verOut.id);

    // Mark this cleaned version as current for the domain
    await supabaseAdmin
      .from('domains')
      .update({ current_version_id: verOut.id, updated_at: new Date().toISOString() })
      .eq('id', id);

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

// Ensure rule.definition has actionable arrays and preserves meta
function normalizeRuleDefinition(def = {}) {
  const out = { transforms: [], checks: [], meta: {} };
  if (Array.isArray(def.transforms)) out.transforms = def.transforms;
  if (Array.isArray(def.checks)) out.checks = def.checks;
  // Carry-over meta and also fold any stray fields into meta for clarity
  const meta = { ...(def.meta || {}) };
  for (const k of Object.keys(def || {})) {
    if (!['transforms', 'checks', 'meta'].includes(k)) meta[k] = meta[k] ?? def[k];
  }
  out.meta = meta;
  return out;
}

// Ingest a file from Storage into domain_versions + domain_data/history
router.post('/:id/ingest', async (req, res) => {
  try {
    const { id } = req.params;
    const tenantId = await resolveTenantId(req);
    const userId = req.user?.id;
    const { path } = req.body || {};
    if (!path) return res.status(400).json({ error: 'path required (e.g., key in storage bucket "domains")' });
    const storageKey = path;
    const fileExt = nodePath.extname(storageKey || '').toLowerCase();
    const fileName = nodePath.basename(storageKey || '');

    // Domain ownership check
    const domain = await getDomain(supabaseAdmin, id);
    if (!domain || domain.tenant_id !== tenantId) return res.status(403).json({ error: 'Forbidden' });

    // Download file from storage
    const { data: blob, error: dlErr } = await supabaseAdmin.storage.from('domains').download(storageKey);
    if (dlErr) return res.status(400).json({ error: dlErr.message });
    const buf = Buffer.from(await blob.arrayBuffer());

    // Parse via xlsx; take first sheet
    const wb = XLSX.read(buf, { type: 'buffer' });
    const sheetName = wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: null });
    // Derive columns from the actual header row (A1), not array indexes
    const a1 = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
    const headerRow = Array.isArray(a1?.[0]) ? a1[0] : [];
    const columns = (headerRow || [])
      .map((c) => String(c ?? '').trim())
      .filter((c) => c.length > 0);
    const rows_count = rows.length;

    // Insert domain_version
    const isDelimitedText = ['.csv', '.tsv', '.txt'].includes(fileExt);
    const baseName = fileName ? fileName.replace(new RegExp((fileExt || '').replace('.', '\\.') + '$', 'i'), '') : null;
    const versionPayload = {
      domain_id: id,
      file_path: storageKey,
      rows_count,
      columns: columns.length ? columns : Object.keys(rows[0] || {}),
      import_summary: {
        sheet: isDelimitedText ? baseName : sheetName,
        file_name: fileName || null,
        ext: fileExt || null,
      },
    };
    const { data: ver, error: verErr } = await supabaseAdmin
      .from('domain_versions').insert(versionPayload).select().single();
    if (verErr) return res.status(400).json({ error: verErr.message });

    // Reset current snapshot: new ingest becomes the sole current data for this domain
    {
      const { error: delErr } = await supabaseAdmin.from('domain_data').delete().eq('domain_id', id);
      if (delErr) return res.status(400).json({ error: `clear current failed: ${delErr.message}` });
      // Verify cleared
      const { count: remain, error: cntErr } = await supabaseAdmin
        .from('domain_data')
        .select('key_hash', { count: 'exact', head: true })
        .eq('domain_id', id);
      if (cntErr) return res.status(400).json({ error: `post-clear count failed: ${cntErr.message}` });
      if ((remain || 0) > 0) return res.status(400).json({ error: `clear current failed: ${remain} rows remain` });
    }

    // Compute business key safely based on available columns
    const rowKeys = Object.keys(rows[0] || {});
    let bk = Array.isArray(domain.business_key) && domain.business_key.length ? domain.business_key : [];
    // Keep only keys that actually exist in the parsed rows
    bk = bk.filter((k) => k && rowKeys.includes(k));
    // Fallback to all available columns if no valid domain business key
    if (!bk.length) bk = rowKeys.filter((k) => String(k || '').trim().length > 0);
    // Final fallback: per-row index ensures unique keys for this ingest if sheet has no headers
    if (!bk.length) bk = ['__row_index'];

    // Prepare bulk inserts for current data and snapshots
    const snapshotWritten = new Set();
    const seenIngest = new Set();
    const currentRows = [];
    const historyRows = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const record = r;
      const baseBk = bk;
      let effBk = [...baseBk];
      let keyValues = Object.fromEntries(effBk.map((k) => [k, k === '__row_index' ? i : (r[k] ?? null)]));
      let keyHash = sha256(effBk.map((k) => String(k === '__row_index' ? i : (r[k] ?? ''))).join('|'));
      if (seenIngest.has(keyHash)) {
        effBk = baseBk.includes('__row_index') ? baseBk : [...baseBk, '__row_index'];
        keyValues = Object.fromEntries(effBk.map((k) => [k, k === '__row_index' ? i : (r[k] ?? null)]));
        keyHash = sha256(effBk.map((k) => String(k === '__row_index' ? i : (r[k] ?? ''))).join('|'));
      }
      currentRows.push({ domain_id: id, key_hash: keyHash, key_values: keyValues, record });
      if (!snapshotWritten.has(keyHash)) {
        historyRows.push({ domain_id: id, key_hash: keyHash, key_values: keyValues, record, source_version_id: ver.id });
        snapshotWritten.add(keyHash);
      }
      seenIngest.add(keyHash);
    }
    if (currentRows.length) {
      const { error: insErr } = await supabaseAdmin.from('domain_data').insert(currentRows);
      if (insErr) return res.status(400).json({ error: `insert current failed: ${insErr.message}` });
      // Optional sanity: count rows match expectation
      const { count: curCount, error: curCntErr } = await supabaseAdmin
        .from('domain_data')
        .select('key_hash', { count: 'exact', head: true })
        .eq('domain_id', id);
      if (curCntErr) return res.status(400).json({ error: `post-insert count failed: ${curCntErr.message}` });
      if ((curCount || 0) !== currentRows.length) {
        return res.status(400).json({ error: `post-insert mismatch: expected ${currentRows.length} got ${curCount || 0}` });
      }
    }
    if (historyRows.length) {
      const { error: snapErr } = await supabaseAdmin.from('domain_history').insert(historyRows);
      if (snapErr) return res.status(400).json({ error: snapErr.message });
    }

    // Update current_version on domain
    await supabaseAdmin.from('domains').update({ current_version_id: ver.id, updated_at: new Date().toISOString() }).eq('id', id);

    await auditLog({ actorId: userId, tenantId, action: 'update', resource: 'domain', resourceId: id, meta: { ingested: rows_count, file: path } });
    res.json({ ok: true, version: ver, rows: rows_count });
  } catch (e) {
    res.status(400).json({ error: e.message || 'ingest failed' });
  }
});
