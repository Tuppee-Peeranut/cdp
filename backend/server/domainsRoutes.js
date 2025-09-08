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
    for (const r of rules || []) {
      if (r.definition?.transforms) transforms.push(...r.definition.transforms);
    }

    // Create output version record
    const { data: verOut, error: vErr } = await supabaseAdmin
      .from('domain_versions')
      .insert({ domain_id: id, file_path: null, rows_count: rows?.length || 0, columns: null, import_summary: { action: 'clean' } })
      .select()
      .single();
    if (vErr) return res.status(400).json({ error: vErr.message });

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
    }

    // Compute simple validation metrics if provided in rules
    const metrics = { changed_rows: changed, rule_count: rules?.length || 0 };
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

    // Compute business key safely based on available columns
    const rowKeys = Object.keys(rows[0] || {});
    let bk = Array.isArray(domain.business_key) && domain.business_key.length ? domain.business_key : [];
    // Keep only keys that actually exist in the parsed rows
    bk = bk.filter((k) => k && rowKeys.includes(k));
    // Fallback to all available columns if no valid domain business key
    if (!bk.length) bk = rowKeys.filter((k) => String(k || '').trim().length > 0);
    // Final fallback: per-row index ensures unique keys for this ingest if sheet has no headers
    if (!bk.length) bk = ['__row_index'];

    // Upsert current data and write history on changes
    // Also write a snapshot of the newly ingested record for this version (once per key)
    // Additionally, ensure we never "lose" rows due to duplicate business keys:
    // if a computed key collides within the same ingest or with existing current data,
    // we disambiguate by appending a per-row index to the business key for this ingest.
    const snapshotWritten = new Set();
    const seenIngest = new Set();
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const record = r;

      // Start with configured business key; may extend with __row_index to prevent collisions
      const baseBk = bk;
      let effBk = [...baseBk];
      let keyValues = Object.fromEntries(effBk.map((k) => [k, k === '__row_index' ? i : (r[k] ?? null)]));
      let keyHash = sha256(effBk.map((k) => String(k === '__row_index' ? i : (r[k] ?? ''))).join('|'));

      // If a previous row in this ingest used the same key, disambiguate immediately
      if (seenIngest.has(keyHash)) {
        effBk = baseBk.includes('__row_index') ? baseBk : [...baseBk, '__row_index'];
        keyValues = Object.fromEntries(effBk.map((k) => [k, k === '__row_index' ? i : (r[k] ?? null)]));
        keyHash = sha256(effBk.map((k) => String(k === '__row_index' ? i : (r[k] ?? ''))).join('|'));
      }

      // Fetch existing
      const { data: existing, error: exErr } = await supabaseAdmin
        .from('domain_data')
        .select('record')
        .eq('domain_id', id)
        .eq('key_hash', keyHash)
        .maybeSingle();
      if (exErr) return res.status(400).json({ error: exErr.message });

      if (existing?.record) {
        // Collision with existing current data: never overwrite — keep every row
        // Disambiguate key by including per-row index for this ingest
        effBk = effBk.includes('__row_index') ? effBk : [...baseBk, '__row_index'];
        keyValues = Object.fromEntries(effBk.map((k) => [k, k === '__row_index' ? i : (r[k] ?? null)]));
        keyHash = sha256(effBk.map((k) => String(k === '__row_index' ? i : (r[k] ?? ''))).join('|'));
        // Insert as a new current record
        const { error: insErr } = await supabaseAdmin.from('domain_data').insert({
          domain_id: id,
          key_hash: keyHash,
          key_values: keyValues,
          record,
        });
        if (insErr) return res.status(400).json({ error: insErr.message });
      } else {
        const { error: insErr } = await supabaseAdmin.from('domain_data').insert({
          domain_id: id,
          key_hash: keyHash,
          key_values: keyValues,
          record,
        });
        if (insErr) return res.status(400).json({ error: insErr.message });
      }

      // Snapshot the newly received/current record for this version (once per key)
      if (!snapshotWritten.has(keyHash)) {
        const { error: snapErr } = await supabaseAdmin.from('domain_history').insert({
          domain_id: id,
          key_hash: keyHash,
          key_values: keyValues,
          record,
          source_version_id: ver.id,
        });
        if (snapErr) return res.status(400).json({ error: snapErr.message });
        snapshotWritten.add(keyHash);
      }

      // Track keys used in this ingest to detect intra-file duplicates
      seenIngest.add(keyHash);
    }

    // Update current_version on domain
    await supabaseAdmin.from('domains').update({ current_version_id: ver.id, updated_at: new Date().toISOString() }).eq('id', id);

    await auditLog({ actorId: userId, tenantId, action: 'update', resource: 'domain', resourceId: id, meta: { ingested: rows_count, file: path } });
    res.json({ ok: true, version: ver, rows: rows_count });
  } catch (e) {
    res.status(400).json({ error: e.message || 'ingest failed' });
  }
});
