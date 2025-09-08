import React, { useEffect, useMemo, useState, useRef } from "react";
import { logout } from './auth.js';
import { supabase } from './supabaseClient.js';
import { useAuth } from './AuthContext.jsx';
import {
  Upload,
  Zap,
  Play,
  Settings as SettingsIcon,
  History as HistoryIcon,
  Users,
  Package,
  FileUp,
  CheckCircle,
  XCircle,
  HelpCircle,
  Download,
  Key,
  Trash2,
  Plus,
  ToggleLeft,
  ToggleRight,
  Send,
  Loader2,
} from "lucide-react";
import * as XLSX from "xlsx";

/**
 * dP Platform — v2 (multi-rule engine)
 * - Multiple validation rule sets
 * - Each rule has on/off status and applies to Credit or Debit
 * - On upload, auto-validates against all enabled rules for the active transfer kind
 * - Users can Ask about validation results
 *
 * NOTE: For production, proxy OpenAI calls via your backend (no API key in browser).
 */

// -------------------------- Types ---------------------------
/** @typedef {"credit"|"debit"} TransferKind */

/**
 * @typedef RuleSet
 * @property {string} id
 * @property {string} name
 * @property {string} appliesTo // domain id
 * @property {boolean} enabled
 * @property {string[]} requiredColumns
 * @property {string} accountPattern
 * @property {string[]} allowedCurrencies
 * @property {number} maxAmountPerTxn
 * @property {number} maxTotalAmount
 * @property {boolean} allowDuplicateAccountPerBatch
 * @property {boolean} businessHoursOnly
 */

/**
 * @typedef BatchRow
 * @property {string} RecipientName
 * @property {string} AccountNumber
 * @property {string} BankCode
 * @property {number} Amount
 * @property {string} Currency
 * @property {string=} Note
 */

/** @typedef {"error"|"warning"} IssueLevel */

/**
 * @typedef ValidationIssue
 * @property {number} rowIndex
 * @property {string} message
 * @property {IssueLevel} level
 * @property {string=} ruleName // filled when aggregated
 */

/**
 * @typedef RuleResult
 * @property {string} ruleId
 * @property {string} ruleName
 * @property {ValidationIssue[]} issues
 * @property {number} totalAmount
 * @property {number} rowCount
 */

/**
 * @typedef Batch
 * @property {string} id
 * @property {TransferKind} kind
 * @property {string} fileName
 * @property {string} createdAt
 * @property {number} rowCount
 * @property {number} totalAmount
 * @property {"validated"|"submitted"|"failed"|"draft"} status
 * @property {ValidationIssue[]} issues // combined
 * @property {BatchRow[]} rows
 * @property {RuleResult[]} ruleResults // per-rule
 * @property {any[]=} rawRows // original parsed rows for profiling/QA
 * @property {string[]=} rawColumns // original column headers
 */

/**
 * Task status lifecycle:
 * - initiated: user clicked task
 * - connecting: user assigned endpoint
 * - transferring: connection established (simulated 3s after connecting)
 * - completed: process finished (simulated 3s after transferring)
 * - failed: error during process
 */
/**
 * @typedef Task
 * @property {string} id
 * @property {TransferKind} kind
 * @property {string} fileName
 * @property {string} createdAt
 * @property {"initiated"|"connecting"|"transferring"|"completed"|"failed"} status
 * @property {string|null} endpoint
 * @property {number=} rowCount
 * @property {number=} totalAmount
 */

/**
 * @typedef ChatMessage
 * @property {"user"|"assistant"|"system"} role
 * @property {"text"|"file"|"validation"|"summary"} type
 * @property {string} content
 * @property {any=} payload
 */

// ----------------------- Utilities --------------------------
const STORAGE_KEYS = {
  rulesets: "dbulk.rulesets.v2",
  tasks: "dbulk.tasks.v1",
  apiKey: "dbulk.openai_api_key",
  model: "dbulk.openai_model",
  accessToken: "dbulk.access_token",
};

function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Default rule sets */
/** @type {RuleSet[]} */
const DEFAULT_RULESETS = [
  {
    id: uid("rule"),
    name: "Credit: Standard THB",
    appliesTo: "customers",
    enabled: true,
    requiredColumns: ["RecipientName", "AccountNumber", "BankCode", "Amount", "Currency", "Note"],
    accountPattern: "^\\d{10,12}$",
    allowedCurrencies: ["THB"],
    maxAmountPerTxn: 2000000,
    maxTotalAmount: 10000000,
    allowDuplicateAccountPerBatch: false,
    businessHoursOnly: false,
  },
  {
    id: uid("rule"),
    name: "Debit: Standard THB",
    appliesTo: "products",
    enabled: true,
    requiredColumns: ["RecipientName", "AccountNumber", "BankCode", "Amount", "Currency", "Note"],
    accountPattern: "^\\d{10,12}$",
    allowedCurrencies: ["THB"],
    maxAmountPerTxn: 2000000,
    maxTotalAmount: 10000000,
    allowDuplicateAccountPerBatch: false,
    businessHoursOnly: false,
  },
];

const MODELS = ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1"];

/**
 * Parse first worksheet into rows
 * - Returns normalized rows (for validation) and raw rows/columns (for profiling)
 * @param {File} file
 * @returns {Promise<{ rows: BatchRow[], rawRows: any[], rawColumns: string[] }>}
 */
async function parseWorkbook(file) {
  const data = await file.arrayBuffer();
  const workbook = XLSX.read(data, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const json = XLSX.utils.sheet_to_json(sheet, { defval: "" });

  // Clean raw rows (trim headers and string values), keep original shape
  const rawRows = json.map((r) => {
    const cleaned = {};
    for (const k of Object.keys(r)) {
      const key = String(k).trim();
      const v = r[k];
      cleaned[key] = typeof v === "string" ? v.trim() : v;
    }
    return cleaned;
  });
  const rawColumns = Object.keys(rawRows[0] || {});

  /** @type {BatchRow[]} */
  const rows = rawRows.map((norm) => {
    const Amount = Number(norm["Amount"]) || 0;
    return {
      RecipientName: String(norm["RecipientName"] || ""),
      AccountNumber: String(norm["AccountNumber"] || ""),
      BankCode: String(norm["BankCode"] || ""),
      Amount,
      Currency: String(norm["Currency"] || ""),
      Note: String(norm["Note"] || ""),
    };
  });

  return { rows, rawRows, rawColumns };
}

/**
 * Validate a set of rows against a single rule set
 * @param {BatchRow[]} rows
 * @param {RuleSet} rule
 * @returns {ValidationIssue[]}
 */
function validateAgainstRule(rows, rule) {
  /** @type {ValidationIssue[]} */
  const issues = [];
  const acctRegex = new RegExp(rule.accountPattern);

  if (!rows || rows.length === 0) {
    issues.push({ rowIndex: 0, level: "error", message: "No rows found" });
    return issues;
  }

  const haveCols = Object.keys(rows[0] || {});
  const missing = rule.requiredColumns.filter((c) => !haveCols.includes(c));
  if (missing.length) {
    issues.push({ rowIndex: 0, level: "error", message: `Missing required columns: ${missing.join(", ")}` });
  }

  const seen = new Map();
  let total = 0;

  rows.forEach((row, i) => {
    if (!row.RecipientName) issues.push({ rowIndex: i + 1, level: "error", message: "RecipientName is required" });
    if (!acctRegex.test(row.AccountNumber)) issues.push({ rowIndex: i + 1, level: "error", message: "AccountNumber invalid format" });
    if (!row.BankCode) issues.push({ rowIndex: i + 1, level: "error", message: "BankCode is required" });

    if (!(typeof row.Amount === "number") || isNaN(row.Amount)) {
      issues.push({ rowIndex: i + 1, level: "error", message: "Amount must be a number" });
    } else {
      if (row.Amount <= 0) issues.push({ rowIndex: i + 1, level: "error", message: "Amount must be > 0" });
      if (row.Amount > rule.maxAmountPerTxn) issues.push({ rowIndex: i + 1, level: "error", message: `Amount exceeds per-transaction max (${rule.maxAmountPerTxn.toLocaleString()})` });
      total += row.Amount;
    }

    if (!rule.allowedCurrencies.includes(row.Currency)) {
      issues.push({ rowIndex: i + 1, level: "error", message: `Currency not allowed (${row.Currency})` });
    }

    const dupKey = `${row.AccountNumber}|${row.Amount}`;
    if (!rule.allowDuplicateAccountPerBatch) {
      if (seen.has(dupKey)) issues.push({ rowIndex: i + 1, level: "warning", message: "Possible duplicate (AccountNumber + Amount)" });
      else seen.set(dupKey, true);
    }
  });

  if (total > rule.maxTotalAmount) {
    issues.push({ rowIndex: 0, level: "error", message: `Batch total exceeds limit (${rule.maxTotalAmount.toLocaleString()})` });
  }

  if (rule.businessHoursOnly) {
    const now = new Date();
    const day = now.getDay();
    const hr = now.getHours();
    const within = day >= 1 && day <= 5 && hr >= 9 && hr < 17;
    if (!within) issues.push({ rowIndex: 0, level: "warning", message: "Business hours rule active (Mon–Fri 09:00–17:00)" });
  }

  return issues;
}

/**
 * Validate against all enabled rules for the given kind
 * @param {BatchRow[]} rows
 * @param {RuleSet[]} rulesets
 * @param {string} domain
 * @returns {{combined: ValidationIssue[], perRule: RuleResult[], totalAmount:number, rowCount:number}}
 */
function validateWithRules(rows, rulesets, domain) {
  const activeRules = rulesets.filter((r) => r.enabled && r.appliesTo === domain);
  const totalAmount = rows.reduce((s, r) => s + (Number(r.Amount) || 0), 0);
  const rowCount = rows.length;

  /** @type {RuleResult[]} */
  const perRule = activeRules.map((r) => {
    const issues = validateAgainstRule(rows, r).map((i) => ({ ...i, ruleName: r.name }));
    return { ruleId: r.id, ruleName: r.name, issues, totalAmount, rowCount };
  });

  const combined = perRule.flatMap((rr) => rr.issues);
  return { combined, perRule, totalAmount, rowCount };
}

/** Ask OpenAI (BYOK client-side; proxy in prod) */
async function askOpenAI(apiKey, model, userPrompt, context, accessToken) {
  const sys = `You are dP Copilot, a careful data platform assistant.
- Explain validations and suggest fixes succinctly.
- Never fabricate banking details.
- If asked to "submit", remind that this MVP only simulates submission.`;
  const ctx = JSON.stringify(context).slice(0, 12000);
  const body = {
    model: model || "gpt-4o-mini",
    messages: [
      { role: "system", content: sys },
      { role: "user", content: `Context (truncated JSON):\n${ctx}\n\nQuestion: ${userPrompt}` },
    ],
    temperature: 0.2,
  };
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`OpenAI error: ${res.status} ${t}`);
  }
  const json = await res.json();
  return json.choices?.[0]?.message?.content || "(no response)";
}

// ----------------------- Local QA ---------------------------
/**
 * Answer simple data profiling questions locally without LLM.
 * Supports prompts like: "null count in Province column"
 * @param {string} prompt
 * @param {Batch|null} batch
 * @returns {string|null}
 */
function answerLocalQuestion(prompt, batch) {
  if (!prompt || !batch) return null;
  const text = String(prompt).trim();
  // Normalize spacing and quotes for parsing
  const t = text.replace(/[“”]/g, '"').replace(/[’']/g, "'");

  const rows = (batch.rawRows && batch.rawRows.length ? batch.rawRows : batch.rows) || [];
  const allColumns = (batch.rawColumns && batch.rawColumns.length ? batch.rawColumns : Object.keys(rows[0] || {})) || [];
  const rowCount = rows.length;

  if (!rowCount || !allColumns.length) return null;

  // Try to extract column name from patterns like:
  // - null count in Province column
  // - null count for "Province"
  // - how many null in 'Province'
  // - missing count in Province
  const patterns = [
    /\b(?:null|missing)\s+count\s+(?:in|for)\s+\"([^\"]+)\"/i,
    /\b(?:null|missing)\s+count\s+(?:in|for)\s+'([^']+)'/i,
    /\b(?:null|missing)\s+count\s+(?:in|for)\s+([A-Za-z0-9_.\- ]+)\s+column\b/i,
    /\bhow\s+many\s+(?:null|missing)\s+(?:in|for)\s+\"([^\"]+)\"/i,
    /\bhow\s+many\s+(?:null|missing)\s+(?:in|for)\s+'([^']+)'/i,
    /\bhow\s+many\s+(?:null|missing)\s+(?:in|for)\s+([A-Za-z0-9_.\- ]+)/i,
  ];

  let col = null;
  for (const rx of patterns) {
    const m = t.match(rx);
    if (m && m[1]) { col = m[1].trim(); break; }
  }

  if (!col) {
    // Fallback: look for pattern "in X column" if prompt contains 'null'
    if (/\bnull\b|\bmissing\b/i.test(t)) {
      const m = t.match(/\bin\s+([A-Za-z0-9_.\- ]+)\s+column\b/i);
      if (m && m[1]) col = m[1].trim();
    }
  }

  if (!col) return null;

  // Attempt to resolve to an existing column (case-insensitive)
  const byLower = new Map(allColumns.map((c) => [String(c).toLowerCase(), c]));
  const resolved = byLower.get(col.toLowerCase());
  if (!resolved) {
    return `Column "${col}" not found. Available: ${allColumns.slice(0, 10).join(', ')}${allColumns.length > 10 ? ', ...' : ''}`;
  }

  // Compute null/missing count: treat null, undefined, empty string as missing
  let missing = 0;
  for (const r of rows) {
    const v = r?.[resolved];
    if (v === null || v === undefined || v === '') missing++;
  }
  const pct = rowCount ? Math.round((missing / rowCount) * 100) : 0;
  return `Null count in ${resolved}: ${missing} of ${rowCount} rows (${pct}%)`;
}

// ----------------------- UI Primitives ----------------------
function SidebarButton({ icon: Icon, label, active, onClick, right }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-3 py-2 rounded-xl w-full text-left transition ${
        active ? "bg-emerald-200 text-emerald-800" : "text-neutral-700 hover:bg-emerald-50"
      }`}
    >
      <Icon size={18} />
      <span className="truncate flex-1 text-left">{label}</span>
      {right}
    </button>
  );
}

function Badge({ children, tone = "neutral" }) {
  const toneCls =
    tone === "success"
      ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
      : tone === "danger"
      ? "bg-rose-500/15 text-rose-400 border-rose-500/30"
      : tone === "warn"
      ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
      : "bg-neutral-200 text-neutral-700 border-neutral-400";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs border ${toneCls}`}>
      {children}
    </span>
  );
}

function Toggle({ checked, onChange }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border ${
        checked ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-neutral-400 bg-neutral-200 text-neutral-700"
      }`}
    >
      {checked ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
      <span className="text-xs">{checked ? "On" : "Off"}</span>
    </button>
  );
}

function DomainEditor({ domain, onClose, onSaved, accessToken }) {
  const [name, setName] = useState(domain.name || '');
  const [description, setDescription] = useState(domain.description || '');
  const [businessKey, setBusinessKey] = useState((domain.business_key || []).join(', '));
  const [saving, setSaving] = useState(false);
  const save = async () => {
    try {
      setSaving(true);
      const headers = { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) };
      const body = { name: name.trim(), description: description || null, business_key: businessKey.split(',').map((s) => s.trim()).filter(Boolean) };
      const res = await fetch(`/api/domains/${domain.id}`, { method: 'PUT', headers, body: JSON.stringify(body) });
      if (!res.ok) throw new Error((await res.json()).error || 'Save failed');
      const updated = await res.json();
      onSaved?.(updated);
    } catch (e) {
      alert(e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="fixed inset-0 bg-black/30 z-50 grid place-items-center" onClick={onClose}>
      <div className="bg-white rounded-lg border w-[520px] p-4" onClick={(e) => e.stopPropagation()}>
        <div className="text-lg font-medium mb-3">Edit Domain</div>
        <div className="space-y-3">
          <label className="block text-sm">
            <div className="text-neutral-600 mb-1">Name</div>
            <input value={name} onChange={(e) => setName(e.target.value)} className="w-full border rounded px-2 py-1" />
          </label>
          <label className="block text-sm">
            <div className="text-neutral-600 mb-1">Description</div>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} className="w-full border rounded px-2 py-1" rows={3} />
          </label>
          <label className="block text-sm">
            <div className="text-neutral-600 mb-1">Business Key (comma-separated)</div>
            <input value={businessKey} onChange={(e) => setBusinessKey(e.target.value)} className="w-full border rounded px-2 py-1" placeholder="email, id" />
          </label>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-3 py-1 rounded border">Cancel</button>
          <button onClick={save} disabled={saving} className="px-3 py-1 rounded bg-neutral-900 text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ msg, rulesets, setRulesets, kind, domain }) {
  const isUser = msg.role === "user";
  const bubbleCls = isUser
    ? "bg-neutral-200 text-neutral-900"
    : msg.type === "validation"
    ? "bg-neutral-100 text-neutral-800 border border-neutral-300"
    : "bg-neutral-100 text-neutral-800";

  return (
    <div className={`w-full flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[86%] rounded-2xl px-4 py-3 ${bubbleCls}`}>
        {msg.type === "file" && (
          <div className="flex items-center gap-2 mb-2 text-neutral-700">
            <FileUp size={16} /> <span className="text-sm">{msg.content}</span>
          </div>
        )}
        {msg.type === "thinking" && (
          <div className="flex items-center gap-2 text-neutral-600">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Thinking…</span>
          </div>
        )}
        {msg.type === "validation" && msg.payload && (
          <ValidationPanel
            payload={msg.payload}
            rulesets={rulesets}
            setRulesets={setRulesets}
            domain={domain}
          />
        )}
        {(msg.type === "text" || msg.type === "summary") && (
          <div className="whitespace-pre-wrap leading-relaxed text-sm">{msg.content}</div>
        )}
      </div>
    </div>
  );
}

function ValidationPanel({ payload, rulesets = [], setRulesets, domain }) {
  const { combined = [], perRule = [], totalAmount = 0, rowCount = 0 } = payload || {};
  const errors = combined.filter((i) => i.level === "error");
  const warns = combined.filter((i) => i.level === "warning");
  const applicable = rulesets.filter((r) => r.appliesTo === domain);
  const toggleRule = (id, enabled) =>
    setRulesets((rs) => rs.map((r) => (r.id === id ? { ...r, enabled } : r)));
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-1">
        {errors.length === 0 ? (
          <CheckCircle className="text-emerald-400" size={18} />
        ) : (
          <XCircle className="text-rose-400" size={18} />
        )}
        <div className="text-sm">
          {errors.length === 0 ? "Ready to submit" : `${errors.length} error(s) found`} · {warns.length} warning(s) · {rowCount} rows · Total {totalAmount.toLocaleString()}
        </div>
      </div>

      {applicable.map((r) => {
        const rr = perRule.find((p) => p.ruleId === r.id);
        const errCount = rr ? rr.issues.filter((i) => i.level === "error").length : 0;
        const warnCount = rr ? rr.issues.filter((i) => i.level === "warning").length : 0;
        return (
          <div key={r.id} className="rounded-lg border border-neutral-300 p-3 bg-neutral-50">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-medium">{r.name}</div>
              <Toggle checked={r.enabled} onChange={(v) => toggleRule(r.id, v)} />
            </div>
            {r.enabled ? (
              rr && rr.issues.length > 0 ? (
                <ul className="space-y-1 max-h-36 overflow-auto pr-1">
                  {rr.issues.slice(0, 20).map((it, idx) => (
                    <li key={idx} className="text-xs text-neutral-700">
                      <span className="text-neutral-500 mr-1">Row {it.rowIndex}:</span>
                      <span className={it.level === "error" ? "text-rose-300" : "text-amber-300"}>{it.message}</span>
                    </li>
                  ))}
                  {rr.issues.length > 20 && (
                    <li className="text-xs text-neutral-600">…and {rr.issues.length - 20} more</li>
                  )}
                </ul>
              ) : (
                <div className="text-xs text-neutral-500">No issues for this rule.</div>
              )
            ) : (
              <div className="text-xs text-neutral-500">Rule disabled</div>
            )}
            <div className="text-xs text-neutral-500 mt-2">
              {errCount} error(s), {warnCount} warning(s)
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ----------------------- Main App ---------------------------
export default function App() {
  // Load rulesets (migrate v1 single-rule if present)
  const [rulesets, setRulesets] = useState(() => {
    const rawV2 = localStorage.getItem(STORAGE_KEYS.rulesets);
    if (rawV2) return JSON.parse(rawV2);
    // Migration: if older single rules exist, wrap it
    try {
      const rawV1 = localStorage.getItem("dbulk.rules.v1");
      if (rawV1) {
        const r = JSON.parse(rawV1);
        return [
          { id: uid("rule"), name: "Migrated Credit", appliesTo: "customers", enabled: true, ...r },
          { id: uid("rule"), name: "Migrated Debit", appliesTo: "products", enabled: true, ...r },
        ];
      }
    } catch {}
    return DEFAULT_RULESETS;
  });

  const [tasks, setTasks] = useState(() => {
    const raw = localStorage.getItem(STORAGE_KEYS.tasks);
    return raw ? JSON.parse(raw) : [];
  });
  const [showTasks, setShowTasks] = useState(true);
  const [apiKey, setApiKey] = useState(() => localStorage.getItem(STORAGE_KEYS.apiKey) || "");
  const [model, setModel] = useState(() => localStorage.getItem(STORAGE_KEYS.model) || MODELS[0]);
  const [domains, setDomains] = useState([]); // legacy removed
  const [serverDomains, setServerDomains] = useState([]);
  const [ruleCounts, setRuleCounts] = useState({}); // domainId -> count
  const [editingDomain, setEditingDomain] = useState(null);
  const [active, setActive] = useState("Dashboard:Domain"); // default to Domain View
  const [toasts, setToasts] = useState([]);
  const [accessToken, setAccessToken] = useState(null);
  const { user } = useAuth();
  const tenantId =
    user?.user_metadata?.tenant_id ?? user?.app_metadata?.tenant_id;
  const [tenantName, setTenantName] = useState(null);

  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showFeaturePreview, setShowFeaturePreview] = useState(false);
  const menuRef = useRef(null);
  const avatarInputRef = useRef(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  useEffect(() => {
    const handleClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setShowUserMenu(false);
        setShowFeaturePreview(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  async function handleAvatarUpload(file) {
    if (!file || !user?.id) return;
    try {
      setUploadingAvatar(true);
      const bucket = 'avatars';
      // Ensure bucket exists via backend (service key)
      try {
        const token = accessToken || (await supabase.auth.getSession()).data?.session?.access_token;
        await fetch('/api/storage/ensure-bucket', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ name: bucket, public: true }),
        });
      } catch (_) {}
      const path = `${user.id}/${Date.now()}_${file.name}`;
      const { error: upErr } = await supabase.storage.from(bucket).upload(path, file, { upsert: true, cacheControl: '3600' });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from(bucket).getPublicUrl(path);
      const publicUrl = pub?.publicUrl;
      if (!publicUrl) throw new Error('Failed to get public URL');
      await supabase.auth.updateUser({ data: { avatar_url: publicUrl } });
      await supabase.from('users').update({ profile_url: publicUrl }).eq('id', user.id);
      addToast('Profile photo updated');
    } catch (e) {
      console.error('avatar upload error', e);
      addToast(e.message || 'Upload failed');
    } finally {
      setUploadingAvatar(false);
    }
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setAccessToken(session?.access_token ?? null);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setAccessToken(session?.access_token ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Fetch server domains when authenticated
  useEffect(() => {
    async function fetchDomains() {
      try {
        if (!accessToken) return;
        const res = await fetch('/api/domains', { headers: { Authorization: `Bearer ${accessToken}` } });
        if (!res.ok) return;
        const list = await res.json();
        setServerDomains(list || []);
        if ((!active || active === 'Dashboard') && list && list.length) {
          setActive(list[0].name);
        }
        // Fetch rule counts for sidebar badges
        const token = accessToken;
        const counts = {};
        await Promise.all((list || []).map(async (d) => {
          try {
            const r = await fetch(`/api/domains/${d.id}/rules`, { headers: { Authorization: `Bearer ${token}` } });
            if (r.ok) counts[d.id] = (await r.json())?.length || 0;
          } catch {}
        }));
        setRuleCounts(counts);
      } catch {}
    }
    fetchDomains();
  }, [accessToken]);

  const refreshServerDomains = async () => {
    if (!accessToken) return;
    const res = await fetch('/api/domains', { headers: { Authorization: `Bearer ${accessToken}` } });
    if (res.ok) setServerDomains(await res.json());
  };

  useEffect(() => {
    if (!tenantId) {
      setTenantName(null);
      return;
    }
    supabase
      .from('tenants')
      .select('name')
      .eq('id', tenantId)
      .single()
      .then(({ data, error }) => {
        if (!error) setTenantName(data?.name || null);
      });
  }, [tenantId]);

  const addToast = (msg) => {
    const id = uid("toast");
    setToasts((ts) => [...ts, { id, msg }]);
    setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), 3000);
  };

  const handleLogout = async () => {
    await logout();
    setAccessToken(null);
  };

  const addDomain = () => {
    const id = uid("domain");
    setDomains((d) => [...d, { id, label: `Domain ${d.length + 1}`, icon: Package }]);
    addToast("Domain added");
  };

  // Create a server-backed domain
  const createServerDomain = async () => {
    const name = prompt('New domain name');
    if (!name) return;
    const token = accessToken || (await supabase.auth.getSession()).data?.session?.access_token;
    const headers = { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
    const business_key = name.toLowerCase().includes('customer') ? ['email'] : ['id'];
    const res = await fetch('/api/domains', { method: 'POST', headers, body: JSON.stringify({ name, business_key }) });
    if (!res.ok) {
      addToast('Create domain failed');
      return;
    }
    await refreshServerDomains();
    setActive(name);
    addToast('Domain created');
  };

  const updateRule = (id, patch) =>
    setRulesets((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const deleteRule = (id) => {
    setRulesets((rs) => rs.filter((r) => r.id !== id));
    if (active === id) setActive("customers");
  };

  const addRule = () => {
    const domain = domains.some((d) => d.id === active) ? active : domains[0].id;
    const id = uid("rule");
    const newRule = {
      id,
      name: "New Rule",
      appliesTo: domain,
      enabled: true,
      requiredColumns: ["RecipientName", "AccountNumber", "BankCode", "Amount", "Currency"],
      accountPattern: "^\\d{10,12}$",
      allowedCurrencies: ["THB"],
      maxAmountPerTxn: 2000000,
      maxTotalAmount: 10000000,
      allowDuplicateAccountPerBatch: false,
      businessHoursOnly: false,
    };
    setRulesets((rs) => [newRule, ...rs]);
    setActive(id);
    addToast("Rule added");
  };

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.rulesets, JSON.stringify(rulesets));
  }, [rulesets]);
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.tasks, JSON.stringify(tasks));
  }, [tasks]);
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.apiKey, apiKey || "");
  }, [apiKey]);
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.model, model || "");
  }, [model]);

  return (
    <div className="h-full w-full min-h-screen bg-white text-neutral-900">
      {/* Top Bar */}
      <div className="h-12 border-b border-neutral-200 flex items-center justify-between px-4 sticky top-0 bg-white/80 backdrop-blur z-40">
        <div className="flex items-center gap-3">
          <div className="size-6 rounded-lg bg-emerald-200 grid place-items-center">
            <Zap size={14} className="text-emerald-700" />
          </div>
          <div className="font-semibold">dP</div>
          {tenantId && (
            <button className="px-3 py-0.5 rounded-full border border-neutral-300 text-xs text-neutral-700">
              {tenantName || tenantId}
            </button>
          )}
        </div>
        <div className="flex items-center gap-4 text-xs text-neutral-500">
          {accessToken ? (
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => {
                  setShowUserMenu((s) => !s);
                  setShowFeaturePreview(false);
                }}
                className="w-8 h-8 rounded-full bg-neutral-300 overflow-hidden flex items-center justify-center"
              >
                {user?.user_metadata?.avatar_url ? (
                  <img
                    src={user.user_metadata.avatar_url}
                    alt="profile"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-sm font-medium text-neutral-600">
                    {user?.email?.[0]?.toUpperCase()}
                  </span>
                )}
              </button>
              {showUserMenu && (
                <div className="absolute right-0 mt-2 w-56 bg-white rounded-md shadow-lg border border-neutral-200 text-neutral-700 z-50">
                  <div className="p-4 border-b border-neutral-200 flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-neutral-300 overflow-hidden flex items-center justify-center">
                      {user?.user_metadata?.avatar_url ? (
                        <img
                          src={user.user_metadata.avatar_url}
                          alt="profile"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span className="text-sm font-medium text-neutral-600">
                          {user?.email?.[0]?.toUpperCase()}
                        </span>
                      )}
                    </div>
                    <div>
                      <div className="text-sm font-medium">
                        {user?.user_metadata?.full_name ?? user?.email}
                      </div>
                      <div className="text-xs text-neutral-500">{user?.email}</div>
                    </div>
                  </div>
                  <div className="py-1 border-b border-neutral-200">
                    <input
                      ref={avatarInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleAvatarUpload(f);
                        e.target.value = '';
                      }}
                    />
                    <button
                      onClick={() => avatarInputRef.current?.click()}
                      disabled={uploadingAvatar}
                      className="w-full text-left px-4 py-2 text-sm hover:bg-neutral-100 flex items-center gap-2 disabled:opacity-50"
                    >
                      <Upload size={14} />
                      {uploadingAvatar ? 'Uploading...' : 'Upload Photo'}
                    </button>
                    <button className="w-full text-left px-4 py-2 text-sm hover:bg-neutral-100">
                      Account Preference
                    </button>
                    <button
                      onClick={() => setShowFeaturePreview((s) => !s)}
                      className="w-full text-left px-4 py-2 text-sm hover:bg-neutral-100"
                    >
                      Feature Preview
                    </button>
                    {showFeaturePreview && (
                      <div className="border-t border-neutral-200">
                        <SettingsPanel
                          apiKey={apiKey}
                          setApiKey={setApiKey}
                          model={model}
                          setModel={setModel}
                        />
                      </div>
                    )}
                  </div>
                  <div className="py-1">
                    <button
                      onClick={handleLogout}
                      className="w-full text-left px-4 py-2 text-sm hover:bg-neutral-100 text-red-600"
                    >
                      Logout
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <a href="/login" className="underline">Login</a>
              <a href="/signup" className="underline">Sign up</a>
            </div>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex">
        {/* Sidebar */}
        <aside className="w-[280px] border-r border-neutral-200 min-h-[calc(100vh-3rem)] p-3 hidden md:block">
          {/* Removed legacy static Domains section */}
          {/* Server-backed data domains */}
          <div className="flex items-center justify-between text-xs uppercase tracking-wide text-neutral-500 px-2 mt-4 mb-2">
            <span>Data Domains</span>
            <button onClick={createServerDomain} className="text-emerald-700" title="Create">
              <Plus size={12} />
            </button>
          </div>
          <div className="space-y-1">
            {serverDomains.map((d) => (
              <SidebarButton
                key={d.id}
                icon={Package}
                label={d.name}
                active={active === d.name}
                onClick={() => setActive(d.name)}
                right={
                  <div className="flex items-center gap-2">
                    {ruleCounts[d.id] != null && (
                      <span className="px-2 py-0.5 rounded-full border text-[11px] text-neutral-600 bg-neutral-50">
                        {ruleCounts[d.id]}
                      </span>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingDomain({ ...d });
                      }}
                      title="Edit domain"
                      className="p-1 rounded hover:bg-neutral-100"
                    >
                      ⋮
                    </button>
                  </div>
                }
              />
            ))}
            {serverDomains.length === 0 && (
              <div className="px-2 text-xs text-neutral-400">No data domains</div>
            )}
            {/* Inline domain rules removed */}
          </div>

          {/* Validate Rules (local) */}
          <div className="flex items-center justify-between text-xs uppercase tracking-wide text-neutral-500 px-2 mt-4 mb-2">
            <span>Validate Rules</span>
          </div>
          <div className="space-y-1">
            {rulesets.map((r) => (
              <SidebarButton key={r.id} icon={Users} label={r.name} active={active === r.id} onClick={() => setActive(r.id)} />
            ))}
            {rulesets.length === 0 && (<div className="px-2 text-xs text-neutral-400">No rules</div>)}
          </div>

          {/* Dashboard main menu */}
          <div className="flex items-center justify-between text-xs uppercase tracking-wide text-neutral-500 px-2 mt-4 mb-2"><span>Dashboard</span></div>
          <div className="space-y-1">
            <SidebarButton icon={HelpCircle} label="Domain View" active={active === 'Dashboard:Domain'} onClick={() => setActive('Dashboard:Domain')} />
            <SidebarButton icon={HelpCircle} label="Overall Data" active={active === 'Dashboard:Overall'} onClick={() => setActive('Dashboard:Overall')} />
          </div>
          
          
        </aside>

        {/* Main */}
        <main className="flex-1 min-h-[calc(100vh-3rem)]">
          {rulesets.find((r) => r.id === active) ? (
            <RuleEditor
              rule={rulesets.find((r) => r.id === active)}
              updateRule={updateRule}
              deleteRule={deleteRule}
              domains={domains}
            />
          ) : domains.find((d) => d.id === active) ? (
            <TransferChat
              domain={active}
              kind={active === "customers" ? "credit" : "debit"}
              rulesets={rulesets}
              setRulesets={setRulesets}
              tasks={tasks}
              setTasks={setTasks}
              apiKey={apiKey}
              model={model}
              addToast={addToast}
            />
          ) : active === 'Dashboard:Domain' ? (
            <DashboardPanel domains={serverDomains} accessToken={accessToken} />
          ) : active === 'Dashboard:Overall' ? (
            <OverallDataPanel accessToken={accessToken} />
          ) : serverDomains.find((d) => d.name === active) ? (
            <TransferChat
              domain={active}
              domainId={serverDomains.find((d) => d.name === active)?.id}
              kind={"credit"}
              rulesets={rulesets}
              setRulesets={setRulesets}
              tasks={tasks}
              setTasks={setTasks}
              apiKey={apiKey}
              model={model}
              addToast={(m) => { addToast(m); refreshServerDomains(); }}
              onRuleCreated={(domainId) => setRuleCounts((rc) => ({ ...rc, [domainId]: (rc[domainId] || 0) + 1 }))}
            />
          ) : (
            <div className="p-6">Domain "{active}" not implemented yet.</div>
          )}
        </main>
        {editingDomain && (
          <DomainEditor
            domain={editingDomain}
            onClose={() => setEditingDomain(null)}
            onSaved={async (updated) => {
              setEditingDomain(null);
              await refreshServerDomains();
              if (active === editingDomain.name && updated?.name && updated.name !== active) setActive(updated.name);
            }}
            accessToken={accessToken}
          />
        )}
      </div>
      <div className="fixed bottom-4 right-4 space-y-2 z-50">
        {toasts.map((t) => (
          <div key={t.id} className="bg-emerald-100 text-emerald-800 px-4 py-2 rounded shadow">{t.msg}</div>
        ))}
      </div>
    </div>
  );
}

// ----------------------- Panels -----------------------------
function TaskMini({ tasks }) {
  return (
    <div className="space-y-1 max-h-[42vh] overflow-auto pr-1">
      {tasks.slice(0, 12).map((t) => (
        <div key={t.id} className="w-full text-left px-2 py-2 rounded-lg hover:bg-neutral-100">
          <div className="flex items-center gap-2 text-sm">
            {t.kind === "credit" ? <Users size={14} className="text-neutral-600" /> : <Package size={14} className="text-neutral-600" />}
            <span className="truncate flex-1">{t.fileName}</span>
            <span
              className={`w-2 h-2 rounded-full ${
                t.status === "completed"
                  ? "bg-emerald-500"
                  : t.status === "failed"
                  ? "bg-rose-500"
                  : t.status === "initiated"
                  ? "bg-neutral-400"
                  : "bg-amber-400"
              }`}
            ></span>
          </div>
          <div className="text-[11px] text-neutral-500 flex items-center gap-2">
            <span>{new Date(t.createdAt).toLocaleString()}</span>
          </div>
        </div>
      ))}
      {tasks.length === 0 && <div className="text-xs text-neutral-500 px-2 py-4">No tasks yet</div>}
    </div>
  );
}

function DashboardPanel({ domains, accessToken }) {
  const [domainId, setDomainId] = useState(domains?.[0]?.id || null);
  const [preview, setPreview] = useState([]);
  useEffect(() => { setDomainId(domains?.[0]?.id || null); }, [domains]);
  useEffect(() => {
    (async () => {
      try {
        if (!domainId || !accessToken) return setPreview([]);
        const res = await fetch(`/api/domains/${domainId}/preview?limit=200`, { headers: { Authorization: `Bearer ${accessToken}` } });
        setPreview(res.ok ? await res.json() : []);
      } catch { setPreview([]); }
    })();
  }, [domainId, accessToken]);
  const cols = preview.length ? Object.keys(preview[0]) : [];
  const rowCount = preview.length;
  const colCount = cols.length;
  const missByCol = cols.map((c) => preview.filter((r) => r[c] == null || r[c] === '').length);
  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-2">
        <select className="border rounded px-2 py-1" value={domainId || ''} onChange={(e) => setDomainId(e.target.value)}>
          {domains.map((d) => (<option key={d.id} value={d.id}>{d.name}</option>))}
        </select>
        <div className="text-sm text-neutral-600">Quick glance at current data</div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="border rounded p-3">
          <div className="text-xs text-neutral-500">Rows (sample)</div>
          <div className="text-2xl font-semibold">{rowCount}</div>
        </div>
        <div className="border rounded p-3">
          <div className="text-xs text-neutral-500">Columns</div>
          <div className="text-2xl font-semibold">{colCount}</div>
        </div>
        <div className="border rounded p-3">
          <div className="text-xs text-neutral-500">Missing cells (sample)</div>
          <div className="text-2xl font-semibold">{missByCol.reduce((a,b)=>a+b,0)}</div>
        </div>
      </div>
      {cols.length > 0 && (
        <div className="border rounded p-3">
          <div className="text-sm font-medium mb-2">Missing by column</div>
          <div className="space-y-1">
            {cols.map((c, i) => {
              const miss = missByCol[i];
              const pct = rowCount ? Math.round((miss / rowCount) * 100) : 0;
              return (
                <div key={c} className="flex items-center gap-2">
                  <div className="w-32 text-xs text-neutral-600 truncate">{c}</div>
                  <div className="flex-1 h-2 bg-neutral-200 rounded">
                    <div className="h-2 bg-amber-500 rounded" style={{ width: `${pct}%` }}></div>
                  </div>
                  <div className="w-10 text-xs text-neutral-600 text-right">{pct}%</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// Overall data dashboard (simple top-values bar)
function OverallDataPanel({ accessToken }) {
  const [domains, setDomains] = useState([]);
  const [preview, setPreview] = useState([]);
  const [domainId, setDomainId] = useState(null);
  useEffect(() => { (async () => {
    if (!accessToken) return;
    const res = await fetch('/api/domains', { headers: { Authorization: `Bearer ${accessToken}` } });
    const list = res.ok ? await res.json() : [];
    setDomains(list || []);
    setDomainId(list?.[0]?.id || null);
  })(); }, [accessToken]);
  useEffect(() => { (async () => {
    if (!domainId || !accessToken) { setPreview([]); return; }
    const res = await fetch(`/api/domains/${domainId}/preview?limit=200`, { headers: { Authorization: `Bearer ${accessToken}` } });
    setPreview(res.ok ? await res.json() : []);
  })(); }, [domainId, accessToken]);
  const cols = preview.length ? Object.keys(preview[0]) : [];
  const firstCol = cols[0];
  const counts = {}; preview.forEach(r => { const k = String(r[firstCol] ?? ''); counts[k] = (counts[k]||0)+1; });
  const entries = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,10);
  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-2">
        <select className="border rounded px-2 py-1" value={domainId || ''} onChange={(e)=>setDomainId(e.target.value)}>
          {domains.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <div className="text-sm text-neutral-600">Overall Data — simple visuals</div>
      </div>
      <div className="border rounded p-3">
        <div className="text-sm font-medium mb-2">Top values in {firstCol || '—'}</div>
        <div className="space-y-1">
          {entries.map(([k,v]) => (
            <div key={k} className="flex items-center gap-2">
              <div className="w-48 text-xs text-neutral-600 truncate" title={k}>{k}</div>
              <div className="flex-1 h-2 bg-neutral-200 rounded"><div className="h-2 bg-emerald-500 rounded" style={{ width: `${Math.min(100, (v/Math.max(1, entries[0][1]))*100)}%` }}></div></div>
              <div className="w-10 text-xs text-neutral-600 text-right">{v}</div>
            </div>
          ))}
          {entries.length === 0 && <div className="text-xs text-neutral-500">No data</div>}
        </div>
      </div>
    </div>
  );
}

// Inline domain rules list under active domain
function DomainRulesInline({ domainId }) {
  const [rules, setRules] = useState([]);
  const [open, setOpen] = useState(false);
  useEffect(() => { (async () => {
    const token = (await supabase.auth.getSession()).data?.session?.access_token;
    const res = await fetch(`/api/domains/${domainId}/rules`, { headers: { Authorization: `Bearer ${token}` } });
    setRules(res.ok ? await res.json() : []);
  })(); }, [domainId]);
  const toggle = async (rid, enabled) => {
    const token = (await supabase.auth.getSession()).data?.session?.access_token;
    await fetch(`/api/domains/${domainId}/rules/${rid}`, { method:'PUT', headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${token}`}, body: JSON.stringify({ status: enabled ? 'enabled' : 'disabled' }) });
    setRules(rs => rs.map(r => r.id===rid ? { ...r, status: enabled ? 'enabled' : 'disabled' } : r));
  };
  return (
    <div className="ml-6">
      <button className="text-xs underline" onClick={() => setOpen(o=>!o)}>{open ? 'Hide' : 'Show'} domain rules</button>
      {open && (
        <div className="mt-1 space-y-1">
          {rules.map(r => (
            <div key={r.id} className="flex items-center justify-between text-xs px-2 py-1 rounded hover:bg-neutral-100">
              <span className="truncate">{r.name}</span>
              <Toggle checked={r.status !== 'disabled'} onChange={(v)=>toggle(r.id, v)} />
            </div>
          ))}
          {rules.length===0 && <div className="text-xs text-neutral-400">No rules</div>}
        </div>
      )}
    </div>
  );
}

function RulesPanel({ domainId, onClose }) {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      try {
        const token = (await supabase.auth.getSession()).data?.session?.access_token;
        const res = await fetch(`/api/domains/${domainId}/rules`, { headers: { Authorization: `Bearer ${token}` } });
        const list = res.ok ? await res.json() : [];
        setRules(list || []);
      } finally { setLoading(false); }
    })();
  }, [domainId]);
  const update = async (rid, patch) => {
    const token = (await supabase.auth.getSession()).data?.session?.access_token;
    const res = await fetch(`/api/domains/${domainId}/rules/${rid}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(patch) });
    if (res.ok) setRules((rs) => rs.map((r) => (r.id === rid ? { ...r, ...patch } : r)));
  };
  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-end" onClick={onClose}>
      <div className="bg-white h-full w-[420px] border-l" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 border-b flex items-center justify-between"><div className="font-medium">Rules</div><button onClick={onClose}>✕</button></div>
        {loading ? (
          <div className="p-4 text-neutral-500">Loading…</div>
        ) : (
          <div className="p-3 space-y-2">
            {rules.map((r) => (
              <div key={r.id} className="rounded-lg border border-neutral-300 p-3 bg-neutral-50">
                <div className="flex items-center justify-between mb-2">
                  <input className="text-sm font-medium bg-transparent border-b border-transparent focus:border-neutral-300 outline-none" defaultValue={r.name} onBlur={(e) => { if (e.target.value !== r.name) update(r.id, { name: e.target.value }); }} />
                  <Toggle checked={r.status !== 'disabled'} onChange={(v) => update(r.id, { status: v ? 'enabled' : 'disabled' })} />
                </div>
                <div className="text-xs text-neutral-600">{r.definition ? JSON.stringify(r.definition) : 'No definition'}</div>
              </div>
            ))}
            {rules.length === 0 && <div className="text-sm text-neutral-500">No rules</div>}
          </div>
        )}
      </div>
    </div>
  );
}

function VersionsPanel({ domainId, onClose }) {
  const [versions, setVersions] = useState([]);
  const [preview, setPreview] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      try {
        const token = (await supabase.auth.getSession()).data?.session?.access_token;
        const res = await fetch(`/api/domains/${domainId}/versions`, { headers: { Authorization: `Bearer ${token}` } });
        const list = res.ok ? await res.json() : [];
        setVersions(list || []);
      } finally { setLoading(false); }
    })();
  }, [domainId]);
  const doClean = async () => {
    const token = (await supabase.auth.getSession()).data?.session?.access_token;
    const res = await fetch(`/api/domains/${domainId}/clean`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) {
      const j = await res.json();
      alert(`Clean completed. Changed ${j.changed} rows.`);
      // refresh versions
      const r2 = await fetch(`/api/domains/${domainId}/versions`, { headers: { Authorization: `Bearer ${token}` } });
      if (r2.ok) setVersions(await r2.json());
    }
  };
  const loadPreview = async () => {
    const token = (await supabase.auth.getSession()).data?.session?.access_token;
    const res = await fetch(`/api/domains/${domainId}/preview?limit=50`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) setPreview(await res.json());
  };
  const columns = preview && preview.length ? Object.keys(preview[0]) : [];
  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-end" onClick={onClose}>
      <div className="bg-white h-full w-[900px] border-l" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 border-b flex items-center justify-between"><div className="font-medium">Versions</div><div className="flex gap-2"><button className="px-3 py-1 rounded border" onClick={loadPreview}>Preview</button><button className="px-3 py-1 rounded bg-neutral-900 text-white" onClick={doClean}>Clean</button><button onClick={onClose} className="ml-2">✕</button></div></div>
        {loading ? (
          <div className="p-4 text-neutral-500">Loading…</div>
        ) : (
          <div className="p-3 space-y-2">
            {versions.map((v) => (
              <div key={v.id} className="rounded-lg border border-neutral-300 p-3 bg-neutral-50">
                <div className="flex items-center justify-between">
                  <div className="text-sm">{new Date(v.created_at).toLocaleString()}</div>
                  <div className="text-xs text-neutral-600">{v.rows_count ?? 0} rows</div>
                </div>
                {v.import_summary && <div className="text-xs text-neutral-500 mt-1">{JSON.stringify(v.import_summary)}</div>}
              </div>
            ))}
            {versions.length === 0 && <div className="text-sm text-neutral-500">No versions</div>}
            {preview.length > 0 && (
              <div className="mt-2">
                <div className="text-sm font-medium mb-1">Preview (first {preview.length} rows)</div>
                <div className="border rounded overflow-auto max-h-[50vh]">
                  <table className="min-w-full text-xs">
                    <thead className="bg-neutral-100 sticky top-0">
                      <tr>
                        {columns.map((c) => (
                          <th key={c} className="text-left px-2 py-1 border-b border-neutral-200">{c}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.map((row, idx) => (
                        <tr key={idx} className="border-b border-neutral-100">
                          {columns.map((c) => (
                            <td key={c} className="px-2 py-1 whitespace-nowrap">{String(row[c] ?? '')}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Rule editor for a single rule
function RuleEditor({ rule, updateRule, deleteRule, domains }) {
  if (!rule) return null;
  return (
    <div className="max-w-5xl mx-auto p-6">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <HelpCircle size={18} className="text-neutral-600" />
          <h2 className="text-lg font-semibold">Validation Rule</h2>
        </div>
        <button
          onClick={() => deleteRule(rule.id)}
          className="px-2 py-1 rounded-md bg-neutral-100 border border-neutral-300 hover:bg-neutral-200 text-sm"
        >
          <Trash2 size={14} />
        </button>
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white">
        <div className="p-3 border-b border-neutral-200 flex items-center gap-2">
          <input
            className="bg-white border border-neutral-300 rounded-md px-2 py-1 text-sm"
            value={rule.name}
            onChange={(e) => updateRule(rule.id, { name: e.target.value })}
          />
          <select
            className="bg-white border border-neutral-300 rounded-md px-2 py-1 text-sm"
            value={rule.appliesTo}
            onChange={(e) => updateRule(rule.id, { appliesTo: e.target.value })}
          >
            {domains.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
          <Toggle checked={rule.enabled} onChange={(v) => updateRule(rule.id, { enabled: v })} />
        </div>

        <div className="p-3 grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Required Columns (comma-separated)">
            <input
              className="w-full bg-white border border-neutral-300 rounded-lg px-3 py-2 text-sm"
              value={rule.requiredColumns.join(", ")}
              onChange={(e) =>
                updateRule(rule.id, {
                  requiredColumns: e.target.value
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
            />
          </Field>
          <Field label="Account Number Pattern (RegExp)">
            <input
              className="w-full bg-white border border-neutral-300 rounded-lg px-3 py-2 text-sm"
              value={rule.accountPattern}
              onChange={(e) => updateRule(rule.id, { accountPattern: e.target.value })}
            />
          </Field>
          <Field label="Allowed Currencies (comma-separated)">
            <input
              className="w-full bg-white border border-neutral-300 rounded-lg px-3 py-2 text-sm"
              value={rule.allowedCurrencies.join(", ")}
              onChange={(e) =>
                updateRule(rule.id, {
                  allowedCurrencies: e.target.value
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
            />
          </Field>
          <Field label="Max Amount per Transaction">
            <input
              type="number"
              className="w-full bg-white border border-neutral-300 rounded-lg px-3 py-2 text-sm"
              value={rule.maxAmountPerTxn}
              onChange={(e) => updateRule(rule.id, { maxAmountPerTxn: Number(e.target.value) || 0 })}
            />
          </Field>
          <Field label="Max Batch Total Amount">
            <input
              type="number"
              className="w-full bg-white border border-neutral-300 rounded-lg px-3 py-2 text-sm"
              value={rule.maxTotalAmount}
              onChange={(e) => updateRule(rule.id, { maxTotalAmount: Number(e.target.value) || 0 })}
            />
          </Field>
          <Field label="Allow Duplicates (Account+Amount)">
            <select
              className="w-full bg-white border border-neutral-300 rounded-lg px-3 py-2 text-sm"
              value={rule.allowDuplicateAccountPerBatch ? "yes" : "no"}
              onChange={(e) =>
                updateRule(rule.id, {
                  allowDuplicateAccountPerBatch: e.target.value === "yes",
                })
              }
            >
              <option value="no">No</option>
              <option value="yes">Yes</option>
            </select>
          </Field>
          <Field label="Business Hours Only (Mon–Fri 09:00–17:00)">
            <select
              className="w-full bg-white border border-neutral-300 rounded-lg px-3 py-2 text-sm"
              value={rule.businessHoursOnly ? "yes" : "no"}
              onChange={(e) =>
                updateRule(rule.id, { businessHoursOnly: e.target.value === "yes" })
              }
            >
              <option value="no">No</option>
              <option value="yes">Yes</option>
            </select>
          </Field>
        </div>
      </div>

      <div className="mt-8 text-sm text-neutral-600">
        Rules are stored locally (browser). On upload, all <em>enabled</em> rules for the active domain will run automatically.
      </div>
    </div>
  );
}

function SettingsPanel({ apiKey, setApiKey, model, setModel }) {
  return (
    <div className="p-4">
      <div className="mb-4 flex items-center gap-2">
        <SettingsIcon size={18} className="text-neutral-600" />
        <h2 className="text-lg font-semibold">AI Model</h2>
      </div>

      <Field label="OpenAI API Key (temporary BYOK)">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Key size={16} className="absolute left-2 top-2.5 text-neutral-500" />
            <input
              className="w-full bg-white border border-neutral-300 rounded-lg pl-8 pr-3 py-2 text-sm"
              placeholder="sk-..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </div>
          <button
            className="px-3 py-2 rounded-lg bg-neutral-100 border border-neutral-300 hover:bg-neutral-200"
            onClick={() => setApiKey("")}
          >
            <Trash2 size={16} />
          </button>
        </div>
        <p className="text-xs text-neutral-500 mt-1">
          For production, proxy OpenAI calls via your backend. Never ship keys in the browser.
        </p>
      </Field>

      <Field label="Model">
        <select
          className="w-full bg-white border border-neutral-300 rounded-lg px-3 py-2 text-sm"
          value={model}
          onChange={(e) => setModel(e.target.value)}
        >
          {MODELS.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </Field>

      <div className="mt-8 text-sm text-neutral-600">This MVP runs entirely client-side.</div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <div className="text-sm text-neutral-700 mb-1">{label}</div>
      {children}
    </label>
  );
}

function TransferChat({ domain, domainId = null, kind, rulesets, setRulesets, tasks, setTasks, apiKey, model, addToast }) {
  const { user } = useAuth();
  const storageKey = domainId ? `dp.chat.${domainId}` : `dp.chat.local.${domain}`;
  const [messages, setMessages] = useState(() => {
    try { const raw = localStorage.getItem(storageKey); if (raw) return JSON.parse(raw); } catch {}
    return [
      { role: "assistant", type: "text", content: `Upload Excel/CSV for ${kind === 'credit' ? 'customers' : 'products'}. I’ll auto-validate using all enabled ${kind === 'credit' ? 'Credit' : 'Debit'} rules. Use Ask to query results.` },
    ];
  });
  const [currentPrompt, setCurrentPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingId, setPendingId] = useState(null);
  const [currentBatch, setCurrentBatch] = useState(null);
  const scrollRef = useRef(null);
  const [selectedTask, setSelectedTask] = useState(null);
  const [selectedEndpoint, setSelectedEndpoint] = useState("");
  const [showTasks, setShowTasks] = useState(true);
  const [serverRuleCount, setServerRuleCount] = useState(null);
  const [showRules, setShowRules] = useState(false);
  const [showVersions, setShowVersions] = useState(false);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  // Persist chat history
  useEffect(() => {
    try { const toSave = messages.filter((m) => m.type !== 'thinking'); localStorage.setItem(storageKey, JSON.stringify(toSave)); } catch {}
  }, [messages, storageKey]);

  const tasksOfKind = useMemo(() => tasks.filter((t) => t.kind === kind), [tasks, kind]);

  const headerName = domainId ? domain : (kind === "credit" ? "Customers" : "Products");
  const HeaderIcon = domainId ? Package : (kind === "credit" ? Users : Package);

  // Fetch count of server rules for this domain if domainId provided
  useEffect(() => {
    (async () => {
      try {
        if (!domainId) { setServerRuleCount(null); return; }
        const token = (await supabase.auth.getSession()).data?.session?.access_token;
        if (!token) return;
        const res = await fetch(`/api/domains/${domainId}/rules`, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) return;
        const list = await res.json();
        setServerRuleCount(Array.isArray(list) ? list.length : 0);
      } catch {}
    })();
  }, [domainId]);

  const handleUpload = async (file) => {
    if (!file) return;
    const { rows, rawRows, rawColumns } = await parseWorkbook(file);
    const { combined, perRule, totalAmount, rowCount } = validateWithRules(rows, rulesets, domain);

    const batch = {
      id: uid("batch"),
      kind,
      fileName: file.name,
      createdAt: new Date().toISOString(),
      rowCount,
      totalAmount,
      status: combined.some((i) => i.level === "error") ? "draft" : "validated",
      issues: combined,
      rows,
      ruleResults: perRule,
      rawRows,
      rawColumns,
    };
    setCurrentBatch(batch);

    setMessages((m) => [
      ...m,
      { role: "user", type: "file", content: file.name },
      {
        role: "assistant",
        type: "validation",
        content: "Validation results",
        payload: { combined, perRule, totalAmount, rowCount },
      },
    ]);
    // Add quick profile summary
    try {
      const cols = (rawColumns && rawColumns.length) ? rawColumns : Object.keys(rows[0] || {});
      const colCount = cols.length;
      let missing = 0;
      const missingByCol = cols.map((c) => 0);
      const uniqMap = new Map();
      for (const r of (rawRows && rawRows.length ? rawRows : rows).slice(0, 10000)) { // cap to prevent heavy calc
        const key = cols.map((c) => {
          const v = r[c];
          return v === null || v === undefined ? '' : String(v);
        }).join('\u0001');
        uniqMap.set(key, (uniqMap.get(key) || 0) + 1);
        for (let i = 0; i < cols.length; i++) {
          const v = r[cols[i]];
          if (v === null || v === undefined || v === '') { missing++; missingByCol[i]++; }
        }
      }
      const dups = Array.from(uniqMap.values()).filter((n) => n > 1).reduce((a, n) => a + (n - 1), 0);
      const totalCells = Math.min(rowCount, 10000) * Math.max(1, colCount);
      const missPct = totalCells ? Math.round((missing / totalCells) * 100) : 0;
      const topMissing = cols
        .map((c, i) => ({ c, p: Math.min(rowCount, 10000) ? Math.round((missingByCol[i] / Math.min(rowCount, 10000)) * 100) : 0 }))
        .sort((a, b) => b.p - a.p)
        .slice(0, 3)
        .filter((x) => x.p > 0)
        .map((x) => `${x.c} ${x.p}%`)
        .join(' · ');
      const summary = `Profile: ${rowCount} rows · ${colCount} columns · missing ${missing} cells (${missPct}%)` +
        (dups ? ` · ~${dups} duplicate rows` : '') + (topMissing ? ` · top missing: ${topMissing}` : '');
      setMessages((m) => [...m, { role: 'assistant', type: 'summary', content: (summary.split(' A� ').join(' · ') + (rowCount > Math.min(rowCount, 10000) ? ` (first ${Math.min(rowCount, 10000)} rows)` : '')) }]);
    } catch {}
    addToast("File uploaded");

    // Persist to domain backend (SCD Type 4): upload to storage and trigger ingest
    try {
      const tenantId = user?.user_metadata?.tenant_id || user?.app_metadata?.tenant_id || '00000000-0000-0000-0000-000000000001';
      const bucket = 'domains';
      const key = `${tenantId}/${domain}/${Date.now()}_${file.name}`;
      // Prepare auth headers (must come before ensure-bucket)
      const token = (await supabase.auth.getSession()).data?.session?.access_token;
      const authHeaders = token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
      // Ensure bucket exists via backend (uses service key on server)
      try {
        await fetch('/api/storage/ensure-bucket', {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ name: bucket, public: false }),
        });
      } catch {}
      const { error: upErr } = await supabase.storage.from(bucket).upload(key, file, { upsert: true, cacheControl: '3600' });
      if (upErr) throw upErr;

      // Find or create the domain in API
      let domId = null;
      const listRes = await fetch('/api/domains', { headers: authHeaders });
      if (listRes.ok) {
        const list = await listRes.json();
        domId = list.find((d) => d.name?.toLowerCase() === String(domain).toLowerCase())?.id || null;
      }
      if (!domId) {
        const businessKey = domain === 'customers' ? ['email'] : domain === 'products' ? ['sku'] : ['id'];
        const createRes = await fetch('/api/domains', { method: 'POST', headers: authHeaders, body: JSON.stringify({ name: domain, business_key: businessKey }) });
        if (!createRes.ok) throw new Error((await createRes.json()).error || 'Failed creating domain');
        domId = (await createRes.json()).id;
      }
      // Ingest
      const ingestRes = await fetch(`/api/domains/${domId}/ingest`, { method: 'POST', headers: authHeaders, body: JSON.stringify({ path: key }) });
      if (!ingestRes.ok) throw new Error((await ingestRes.json()).error || 'Ingest failed');
      const ingest = await ingestRes.json();
      setMessages((m) => [...m, { role: 'assistant', type: 'text', content: `Ingested ${ingest.rows} rows to domain "${domain}".` }]);
    } catch (e) {
      console.error('domain ingest error', e);
      setMessages((m) => [...m, { role: 'assistant', type: 'text', content: `Domain ingest error: ${e.message || e}` }]);
    }
  };

  const submitBatch = async () => {
    if (!currentBatch) return;
    const hasErrors = currentBatch.issues.some((i) => i.level === "error");
    if (hasErrors) {
      setMessages((m) => [
        ...m,
        { role: "assistant", type: "text", content: "Cannot submit while errors remain. Fix the data or adjust rules." },
      ]);
      return;
    }
    const task = {
      id: uid("task"),
      kind,
      fileName: currentBatch.fileName,
      createdAt: new Date().toISOString(),
      rowCount: currentBatch.rowCount,
      totalAmount: currentBatch.totalAmount,
      status: "initiated",
      endpoint: null,
    };
    setTasks((t) => [task, ...t]);
    setMessages((m) => [
      ...m,
      { role: "assistant", type: "text", content: `Task "${currentBatch.fileName}" initiated for ${currentBatch.rowCount} records.` },
    ]);
    setCurrentBatch(null);
    addToast("Task initiated");
  };

  const ask = async () => {
    if (!currentPrompt.trim()) return;
    const question = currentPrompt.trim();
    setCurrentPrompt("");
    setMessages((m) => [...m, { role: "user", type: "text", content: question }]);

    try {
      setBusy(true);
      const thinkId = uid("thinking");
      setPendingId(thinkId);
      setMessages((m) => [...m, { role: 'assistant', type: 'thinking', id: thinkId }]);
      // Try local QA first for quick, offline answers
      const local = answerLocalQuestion(question, currentBatch);
      if (local) {
        setMessages((m) => m.filter((mm) => mm.id !== thinkId));
        setMessages((m) => [...m, { role: "assistant", type: "text", content: local }]);
        return;
      }
      const ctx = {
        rulesets,
        lastBatch: currentBatch
          ? {
              fileName: currentBatch.fileName,
              rowCount: currentBatch.rowCount,
              totalAmount: currentBatch.totalAmount,
              issues: currentBatch.issues,
              ruleResults: currentBatch.ruleResults,
              sampleRows: currentBatch.rows.slice(0, 20),
              columns: currentBatch.rawColumns || Object.keys((currentBatch.rows || [])[0] || {}),
            }
          : null,
      };
      const token = (await supabase.auth.getSession()).data?.session?.access_token;
      let answer = "(No API key set. Go to Feature Preview to add an OpenAI key.)";
      answer = await askOpenAI(apiKey, model, question, ctx, token);
      // remove thinking bubble
      setMessages((m) => m.filter((mm) => mm.id !== thinkId));
      setMessages((m) => [...m, { role: "assistant", type: "text", content: answer }]);
    } catch (err) {
      if (pendingId) setMessages((m) => m.filter((mm) => mm.id !== pendingId));
      setMessages((m) => [...m, { role: "assistant", type: "text", content: String(err?.message || err) }]);
    } finally {
      setBusy(false);
      setPendingId(null);
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) handleUpload(file);
  };

  // (removed Template download to simplify header)

  const assignEndpoint = () => {
    if (!selectedTask || !selectedEndpoint) return;
    const id = selectedTask.id;
    setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, endpoint: selectedEndpoint, status: "connecting" } : t)));
    setSelectedTask(null);
    setSelectedEndpoint("");
    setTimeout(() => {
      setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, status: "transferring" } : t)));
    }, 3000);
    setTimeout(() => {
      setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, status: "completed" } : t)));
    }, 6000);
  };

  return (
    <>
    <div className={`grid grid-cols-1 ${showTasks ? "lg:grid-cols-3" : "lg:grid-cols-1"} gap-0`}>
      {/* Chat column */}
      <div className={`${showTasks ? "lg:col-span-2" : "lg:col-span-1"} h-[calc(100vh-3rem)] flex flex-col`}>
        {/* Header */}
        <div className="border-b border-neutral-200 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <HeaderIcon size={18} className="text-neutral-600" />
            <div className="font-medium">{headerName}</div>
            <Badge tone="neutral">Chat Mode</Badge>
          </div>
          <div className="flex gap-2">
            {domainId && (
              <button
                className="px-3 py-1.5 rounded-lg bg-neutral-100 border border-neutral-300 text-sm flex items-center gap-2"
                title="Add rule"
                onClick={async () => {
                  try {
                    const name = prompt('Rule name');
                    if (!name) return;
                    const definition = { type: 'transform', transforms: [{ name: 'trim', columns: ['*'] }] };
                    const token = (await supabase.auth.getSession()).data?.session?.access_token;
                    const res = await fetch(`/api/domains/${domainId}/rules`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                      body: JSON.stringify({ name, definition }),
                    });
                    if (!res.ok) throw new Error((await res.json()).error || 'Create rule failed');
                    setServerRuleCount((c) => (c == null ? 1 : c + 1));
                    setMessages((m) => [...m, { role: 'assistant', type: 'text', content: `Rule "${name}" created.` }]);
                  } catch (e) {
                    setMessages((m) => [...m, { role: 'assistant', type: 'text', content: `Create rule error: ${e.message}` }]);
                  }
                }}
              >
                <Plus size={16} /> Rule{serverRuleCount != null ? ` (${serverRuleCount})` : ''}
              </button>
            )}
            {domainId && (
              <button className="px-3 py-1.5 rounded-lg bg-neutral-100 border border-neutral-300 text-sm" onClick={() => setShowRules(true)}>
                Rules
              </button>
            )}
            {domainId && (
              <button className="px-3 py-1.5 rounded-lg bg-neutral-100 border border-neutral-300 text-sm" onClick={() => setShowVersions(true)}>
                Versions
              </button>
            )}
            <button
              onClick={() => setShowTasks((s) => !s)}
              className="p-2 rounded-lg hover:bg-neutral-200"
              aria-label={showTasks ? "Hide Tasks" : "Show Tasks"}
              title={showTasks ? "Hide Tasks" : "Show Tasks"}
            >
              <HistoryIcon size={16} />
            </button>
          </div>
        </div>

        {/* Messages */}
        <div ref={scrollRef} onDragOver={(e) => e.preventDefault()} onDrop={onDrop} className="flex-1 overflow-auto space-y-3 p-4">
          {messages.map((msg, i) => (
            <MessageBubble
              key={i}
              msg={msg}
              rulesets={rulesets}
              setRulesets={setRulesets}
              kind={kind}
              domain={domain}
            />
          ))}
          <div className="text-center text-xs text-neutral-600 pt-6">Drop an Excel/CSV anywhere above to import</div>
        </div>

        {/* Composer */}
        <div className="border-t border-neutral-200 p-3">
          <div className="relative">
            <textarea
              className="w-full bg-neutral-100 border border-neutral-300 rounded-xl text-lg resize-none h-28 px-3 pt-2 pb-14 pr-20 pl-10"
              placeholder="Ask about the data, rules, or validation results..."
              value={currentPrompt}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); } }}
              onChange={(e) => setCurrentPrompt(e.target.value)}
            />
            <div className="absolute left-2 bottom-2">
              <label>
                <input
                  type="file"
                  className="hidden"
                  accept=".xlsx,.xls,.csv"
                  onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])}
                />
                <div
                  className="p-2 rounded-lg hover:bg-neutral-200 cursor-pointer"
                  title="Import"
                >
                  <Upload size={16} />
                </div>
              </label>
            </div>
            <div className="absolute right-2 bottom-2 flex gap-2">
              <button
                disabled={busy}
                onClick={ask}
                className="p-2 rounded-lg hover:bg-neutral-200 disabled:opacity-50"
                aria-label="Ask"
                title="Ask"
              >
                <Send size={16} />
              </button>
              <button
                disabled={busy}
                onClick={submitBatch}
                className="p-2 rounded-lg text-emerald-600 hover:bg-neutral-200 hover:text-emerald-500 disabled:opacity-50"
                aria-label="Task"
                title="Task"
              >
                <Play size={16} />
              </button>
            </div>
          </div>
          <div className="text-[11px] text-neutral-500 mt-2">
            Use <strong>Ask</strong> for questions · Use <strong>Task</strong> to validate/submit
          </div>
          <div className="text-[11px] text-neutral-500 mt-2">Hint: Import first — validation runs automatically using enabled rules for this transfer type.</div>
        </div>
      </div>

      {/* Side panel: Task Monitoring */}
      {showTasks && (
        <div className="border-l border-neutral-200 h-[calc(100vh-3rem)] overflow-auto">
          <div className="px-4 py-3 border-b border-neutral-200 flex items-center gap-2">
            <Package size={18} className="text-neutral-600" />
            <div className="font-medium">Data Provider Monitoring</div>
          </div>
          {tasksOfKind.length === 0 ? (
            <div className="p-4 text-sm text-neutral-500">No tasks yet. Upload a file to start.</div>
          ) : (
            <ul className="p-2 space-y-2">
              {tasksOfKind.map((t) => (
                <li key={t.id} className="p-3 bg-neutral-100 rounded-xl border border-neutral-200">
                  <div className="flex items-center justify-between gap-2">
                    <div
                      className={`text-sm truncate ${
                        t.status === "connecting" || t.status === "transferring" ? "ai-highlight" : ""
                      }`}
                    >
                      {t.fileName}
                    </div>
                    <Badge tone={t.status === "completed" ? "success" : t.status === "failed" ? "danger" : t.status === "initiated" ? "neutral" : "warn"}>
                      {t.status}
                    </Badge>
                  </div>
                  <div className="text-xs text-neutral-500 mt-1">
                    {new Date(t.createdAt).toLocaleString()} · {t.rowCount} rows · Total {t.totalAmount.toLocaleString()}
                  </div>
                  {t.endpoint && (
                    <div className="text-xs text-neutral-500 mt-1 truncate">API: {t.endpoint}</div>
                  )}
                  {t.status !== "completed" && (
                    <div className="mt-2 flex justify-end">
                      <button
                        className="px-2 py-1 rounded-md bg-neutral-200 border border-neutral-300 text-xs"
                        onClick={() => {
                          setSelectedTask(t);
                          setSelectedEndpoint(t.endpoint || "");
                        }}
                      >
                        Select API
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
    {selectedTask && (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center">
        <div className="bg-neutral-100 p-4 rounded-lg border border-neutral-300 w-80">
          <div className="mb-2 font-medium">Select API endpoint</div>
          <select
            className="w-full bg-neutral-200 border border-neutral-300 rounded px-2 py-1 text-sm"
            value={selectedEndpoint}
            onChange={(e) => setSelectedEndpoint(e.target.value)}
          >
            <option value="">Choose endpoint</option>
            <option value="https://api.bank1.example/transfer">https://api.bank1.example/transfer</option>
            <option value="https://api.bank2.example/payment">https://api.bank2.example/payment</option>
            <option value="https://api.demo.example/send">https://api.demo.example/send</option>
          </select>
          <div className="flex justify-end gap-2 mt-4">
            <button
              onClick={() => setSelectedTask(null)}
              className="px-3 py-1.5 rounded-md bg-neutral-200 border border-neutral-300 text-sm"
            >
              Cancel
            </button>
            <button
              onClick={assignEndpoint}
              className="px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-sm"
            >
              Assign
            </button>
          </div>
        </div>
      </div>
    )}
    {domainId && showRules && (
      <RulesPanel domainId={domainId} onClose={() => setShowRules(false)} />
    )}
    {domainId && showVersions && (
      <VersionsPanel domainId={domainId} onClose={() => setShowVersions(false)} />
    )}
    </>
  );
}
