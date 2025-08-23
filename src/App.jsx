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
 * @param {File} file
 * @returns {Promise<BatchRow[]>}
 */
async function parseWorkbook(file) {
  const data = await file.arrayBuffer();
  const workbook = XLSX.read(data, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const json = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  /** @type {BatchRow[]} */
  return json.map((r) => {
    const norm = {};
    for (const k of Object.keys(r)) {
      const key = String(k).trim();
      norm[key] = typeof r[k] === "string" ? r[k].trim() : r[k];
    }
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

// ----------------------- UI Primitives ----------------------
function SidebarButton({ icon: Icon, label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-3 py-2 rounded-xl w-full text-left transition ${
        active ? "bg-emerald-200 text-emerald-800" : "text-neutral-700 hover:bg-emerald-50"
      }`}
    >
      <Icon size={18} />
      <span className="truncate">{label}</span>
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
  const [domains, setDomains] = useState([
    { id: "customers", label: "Customers", icon: Users },
    { id: "products", label: "Products", icon: Package },
  ]);
  const [active, setActive] = useState("customers"); // active view
  const [toasts, setToasts] = useState([]);
  const [accessToken, setAccessToken] = useState(null);
  const { user } = useAuth();
  const tenantId =
    user?.user_metadata?.tenant_id ?? user?.app_metadata?.tenant_id;
  const [tenantName, setTenantName] = useState(null);

  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showFeaturePreview, setShowFeaturePreview] = useState(false);
  const menuRef = useRef(null);

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
        <aside className="w-[260px] border-r border-neutral-200 min-h-[calc(100vh-3rem)] p-3 hidden md:block">
          <div className="flex items-center justify-between text-xs uppercase tracking-wide text-neutral-500 px-2 mb-2">
            <span>Domains</span>
            <button onClick={addDomain} className="text-emerald-700">
              <Plus size={12} />
            </button>
          </div>
          <div className="space-y-1">
            {domains.map((d) => (
              <SidebarButton key={d.id} icon={d.icon} label={d.label} active={active === d.id} onClick={() => setActive(d.id)} />
            ))}
          </div>
            <div className="flex items-center justify-between text-xs uppercase tracking-wide text-neutral-500 px-2 mt-4 mb-2">
              <span>Validation Rules</span>
              <button onClick={addRule} className="text-emerald-700">
                <Plus size={12} />
              </button>
            </div>
            <div className="space-y-1">
              {rulesets.map((r) => {
                const dom = domains.find((d) => d.id === r.appliesTo);
                const Icon = dom ? dom.icon : HelpCircle;
                return (
                  <SidebarButton
                    key={r.id}
                    icon={Icon}
                    label={r.name}
                    active={active === r.id}
                    onClick={() => setActive(r.id)}
                  />
                );
              })}
            </div>
          <div className="text-xs uppercase tracking-wide text-neutral-500 px-2 mt-4 mb-2">Recent Tasks</div>
          <TaskMini tasks={tasks} />
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
          ) : (
            <div className="p-6">Domain "{active}" not implemented yet.</div>
          )}
        </main>
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

function TransferChat({ domain, kind, rulesets, setRulesets, tasks, setTasks, apiKey, model, addToast }) {
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      type: "text",
      content:
        "Upload Excel/CSV for " +
        (kind === "credit" ? "customers" : "products") +
        '. I’ll auto-validate using all enabled "' + (kind === "credit" ? "Credit" : "Debit") + '" rules. Use Ask to query results.',
    },
  ]);
  const [currentPrompt, setCurrentPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [currentBatch, setCurrentBatch] = useState(null);
  const scrollRef = useRef(null);
  const [selectedTask, setSelectedTask] = useState(null);
  const [selectedEndpoint, setSelectedEndpoint] = useState("");
  const [showTasks, setShowTasks] = useState(true);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const tasksOfKind = useMemo(() => tasks.filter((t) => t.kind === kind), [tasks, kind]);

  const handleUpload = async (file) => {
    if (!file) return;
    const rows = await parseWorkbook(file);
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
    addToast("File uploaded");
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
            }
          : null,
      };
      let answer = "(No API key set. Go to Feature Preview to add an OpenAI key.)";
      answer = await askOpenAI(apiKey, model, question, ctx, accessToken);
      setMessages((m) => [...m, { role: "assistant", type: "text", content: answer }]);
    } catch (err) {
      setMessages((m) => [...m, { role: "assistant", type: "text", content: String(err?.message || err) }]);
    } finally {
      setBusy(false);
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) handleUpload(file);
  };

  const downloadTemplate = () => {
    const headers = ["RecipientName", "AccountNumber", "BankCode", "Amount", "Currency", "Note"];
    const csv = headers.join(",") + "\n" + ["Natee T.", "1234567890", "KBANK", "15000", "THB", "Payroll Aug"].join(",") + "\n";
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "bulk_template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

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
          {kind === "credit" ? <Users size={18} className="text-neutral-600" /> : <Package size={18} className="text-neutral-600" />}
            <div className="font-medium">{kind === "credit" ? "Customers" : "Products"}</div>
            <Badge tone="neutral">Chat Mode</Badge>
          </div>
          <div className="flex gap-2">
            <button className="px-3 py-1.5 rounded-lg bg-neutral-100 border border-neutral-300 text-sm flex items-center gap-2" onClick={downloadTemplate}>
              <Download size={16} /> Template
            </button>
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
              className="w-full bg-neutral-100 border border-neutral-300 rounded-xl text-sm resize-none h-20 px-3 pt-2 pb-10 pr-20 pl-10"
              placeholder="Ask about the data, rules, or validation results..."
              value={currentPrompt}
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
            <HistoryIcon size={18} className="text-neutral-600" />
            <div className="font-medium">Task Monitoring</div>
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
    </>
  );
}
