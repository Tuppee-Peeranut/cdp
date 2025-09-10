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
 * @property {"text"|"file"|"validation"|"summary"|"preview"} type
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
Answer concisely with quantitative results using the provided Columns, Profile, and sampleRows.
Rules:
- Prefer exact counts/percentages from Profile when available.
- Use one-line factual answers unless asked for details.
- When asked to SHOW or list distinct values for a column, output a concise inline list of the values (use Profile.distinctValues[col] if available, otherwise Profile.topValues[col] limited to top 10 with counts). Example: Distinct values in Type: "A", "B", "C", "D".
- Format examples: "5.3% of rows have NULL in CustomerName"; "124 duplicates found in NationalID"; "12 rows have Birthdate in the future"; "Min Age = 1, Max Age = 97"; "Distinct values in Type: X, Y, Z".
- If Profile is based on a sample, append: "(based on sample of N rows)".
- Do not invent columns not present. Use the column names exactly as given in Columns.
- If a requested column is missing, say so briefly and suggest 3-5 closest column names.`;
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

/**
 * Detect simple rule commands like "dedup by <column>".
 * Returns a normalized descriptor or null.
 */
function detectRuleCommand(text) {
  if (!text) return null;
  const t = String(text).replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim();
  let m = null;
  // Split <col> into <a> and <b> using underscore/space/dash
  m = t.match(/^\s*split\s+([A-Za-z0-9_ .-]+)\s+into\s+([A-Za-z0-9_ .-]+)\s*(?:[,/&+]\s*|\s+and\s+)\s*([A-Za-z0-9_ .-]+)\s+using\s+(underscore|space|dash|hyphen|slash)\s*$/i);
  if (m) {
    const col = m[1].trim(); const a = m[2].trim(); const b = m[3].trim(); const how = m[4].toLowerCase();
    const sep = how === 'underscore' ? '_' : how === 'space' ? '\\s+' : how === 'slash' ? '/' : '[-_]';
    return { kind: 'split', column: col, targets: [a, b], separators: [sep] };
  }
  // Normalize casing to lower/upper in <Column>
  m = t.match(/^\s*(normalize|standardize)\s+(?:case|casing)\s+(?:to\s+)?lower(?:\s*case)?\s+in\s+(.+)$/i);
  if (m) return { kind: 'normalize_case_in', mode: 'lower', columns: m[2].split(/\s*,\s*/).map(s=>s.trim()).filter(Boolean) };
  m = t.match(/^\s*(normalize|standardize)\s+(?:case|casing)\s+(?:to\s+)?upper(?:\s*case)?\s+in\s+(.+)$/i);
  if (m) return { kind: 'normalize_case_in', mode: 'upper', columns: m[2].split(/\s*,\s*/).map(s=>s.trim()).filter(Boolean) };
  // Simple forms: lowercase/uppercase in <Column>
  m = t.match(/^\s*(?:lower\s*-?\s*case|lowercase)\s+in\s+(.+)$/i);
  if (m) return { kind: 'normalize_case_in', mode: 'lower', columns: (m[1]||'').split(/\s*,\s*/).map(s=>s.trim()).filter(Boolean) };
  m = t.match(/^\s*(?:upper\s*-?\s*case|uppercase)\s+in\s+(.+)$/i);
  if (m) return { kind: 'normalize_case_in', mode: 'upper', columns: (m[1]||'').split(/\s*,\s*/).map(s=>s.trim()).filter(Boolean) };
  // Replace "x" with "y" in <Column>
  m = t.match(/^\s*replace\s+"(.+?)"\s+with\s+"(.+?)"\s+in\s+(.+)\s*$/i);
  if (m) return { kind: 'replace_in', from: m[1], to: m[2], columns: m[3].split(/\s*,\s*/).map(s=>s.trim()).filter(Boolean) };
  // Map Gender values so A -> B and C -> D
  m = t.match(/^\s*map\s+([A-Za-z0-9_ .-]+)\s+values\s+so\s+(.+)$/i);
  if (m) {
    const col = m[1].trim();
    const pairs = {};
    (m[2] || '').split(/\s*(?:,|;|\s+and\s+)\s*/i).forEach(part => {
      const pm = part.match(/^(.+?)\s*(?:→|->)\s*(.+)$/);
      if (pm) pairs[pm[1].trim()] = pm[2].trim();
    });
    if (Object.keys(pairs).length) return { kind: 'map_values', column: col, mapping: pairs };
  }
  // Relation filter: Filter out rows where A OP B
  m = t.match(/^\s*filter\s+out\s+rows\s+where\s+([A-Za-z0-9_ .-]+)\s*(==|!=|>=|<=|>|<)\s*([A-Za-z0-9_ .-]+)\s*$/i);
  if (m) return { kind: 'filter_relation', left: m[1].trim(), op: m[2], right: m[3].trim() };
  // Title-case X and Y; trim whitespace
  m = t.match(/^\s*title-?case\s+(.+?)\s*(?:;|\s+and\s+)\s*trim\s+whitespace\.?\s*$/i);
  if (m) {
    // columns separated by 'and' or ','
    const raw = m[1].trim();
    const cols = raw.split(/\s*(?:,|\band\b)\s*/i).map((s) => s.trim()).filter(Boolean);
    return { kind: 'title_trim', columns: cols };
  }
  // Title-case columns (no trim)
  m = t.match(/^\s*title-?case\s+(.+?)\s*$/i);
  if (m) {
    const raw = m[1].trim();
    const cols = raw.split(/\s*(?:,|\band\b)\s*/i).map((s) => s.trim()).filter(Boolean);
    return { kind: 'titlecase_in', columns: cols };
  }
  // Split Age into AgeFrom/AgeTo (support 60+)
  if (/^\s*split\s+age\s+into\s+agefrom\s*\/\s*ageto/i.test(t)) {
    return { kind: 'split_age' };
  }
  // Split FY Year into FYStart/FYEnd
  if (/^\s*split\s+fy\s+.*fystart.*fyend/i.test(t) || /split\s+.*year.*fystart.*fyend/i.test(t)) {
    return { kind: 'split_fy', column: 'Year' };
  }
  // Normalize empty/NULL/N/A cells to <value>
  m = t.match(/normalize\s+.*(empty|null|n\/a).*to\s+([A-Za-z0-9_\-+\/ ]+)/i);
  if (m) {
    return { kind: 'normalize_nulls', value: m[2].trim() };
  }
  if (/normalize\s+.*(empty|null|n\/a)/i.test(t)) {
    return { kind: 'normalize_nulls' };
  }
  // Drop/Remove/Delete rows missing A, B, or C
  m = t.match(/^\s*(?:drop|remove|delete)\s+rows\s+missing\s+(.+?)\.?\s*$/i);
  if (!m) m = t.match(/^\s*(?:drop|remove|delete)\s+rows\s+with\s+missing\s+(.+?)\.?\s*$/i);
  if (m) {
    const cols = m[1].split(/\s*(?:,|\bor\b|\band\b)\s*/i).map((s) => s.trim()).filter(Boolean);
    return { kind: 'filter_required', columns: cols };
  }
  // Drop rows with >X% empty fields
  m = t.match(/^\s*drop\s+rows\s+with\s*>\s*(\d+)\s*%\s+empty/i);
  if (m) {
    return { kind: 'filter_missing_pct', threshold: Number(m[1]) };
  }
  // Drop rows with Unit <= 0 or Amount < 1000
  m = t.match(/^\s*drop\s+rows\s+with\s+(.+?)\s*$/i);
  if (m) {
    const part = m[1];
    const conds = [];
    const rx = /(\b[\w .-]+)\s*(<=|<|>=|>)\s*([0-9]+(?:\.[0-9]+)?)/gi;
    let mm;
    while ((mm = rx.exec(part)) !== null) {
      conds.push({ column: mm[1].trim(), op: mm[2], value: Number(mm[3]) });
    }
    if (conds.length) return { kind: 'filter_ranges', ranges: conds };
  }
  // Drop rows where Remark contains 'X'
  m = t.match(/^\s*drop\s+rows\s+where\s+([A-Za-z0-9_. \-]+)\s+contains\s+['\"](.+?)['\"]/i);
  if (m) {
    return { kind: 'filter_contains', column: m[1].trim(), text: m[2].trim(), ci: true };
  }
  // Drop rows where A == X and B == Y
  m = t.match(/^\s*drop\s+rows\s+where\s+(.+?)\s+and\s+(.+?)\s*$/i);
  if (m) {
    return { kind: 'filter_and', conditions: [m[1].trim(), m[2].trim()] };
  }
  // Dedup by <column>
  const dedupRxes = [
    /^\s*(?:dedup|dedupe|deduplicate)\s+(?:by\s+)?\"([^\"]+)\"\s*$/i,
    /^\s*(?:dedup|dedupe|deduplicate)\s+(?:by\s+)?'([^']+)'\s*$/i,
    /^\s*(?:dedup|dedupe|deduplicate)\s+(?:by\s+)?([A-Za-z0-9_.\- ]+)\s*$/i,
  ];
  for (const rx of dedupRxes) {
    const m = t.match(rx);
    if (m && m[1]) return { kind: 'dedup', column: m[1].trim() };
  }
  // Normalize casing
  if (/^\s*(normalize|standardize)\s+(?:case|casing)\s+(?:to\s+)?lower(?:\s*case)?\s*$/i.test(t)) {
    return { kind: 'normalize_case', mode: 'lower' };
  }
  if (/^\s*(normalize|standardize)\s+(?:case|casing)\s+(?:to\s+)?upper(?:\s*case)?\s*$/i.test(t)) {
    return { kind: 'normalize_case', mode: 'upper' };
  }
  // Standardize phone numbers (column optional)
  const phoneM = t.match(/^\s*(?:standardize|normalize)\s+phone\s+numbers?(?:\s+in\s+([A-Za-z0-9_ .-]+))?\s*$/i);
  if (phoneM) return { kind: 'standardize_phone', column: phoneM[1]?.trim() || null };
  // Split Full Name into First/Last
  const splitM = t.match(/^\s*split\s+([A-Za-z0-9_ .-]+)\s+into\s+([A-Za-z0-9_ .-]+)\s*(?:[,/&+]\s*|\s+and\s+)\s*([A-Za-z0-9_ .-]+)\s*$/i);
  if (splitM) return { kind: 'split', column: splitM[1].trim(), targets: [splitM[2].trim(), splitM[3].trim()] };
  // Merge A + B into C
  const mergeM = t.match(/^\s*merge\s+([A-Za-z0-9_ .-]+)\s*\+\s*([A-Za-z0-9_ .-]+)\s+into\s+([A-Za-z0-9_ .-]+)\s*$/i);
  if (mergeM) return { kind: 'merge', sources: [mergeM[1].trim(), mergeM[2].trim()], target: mergeM[3].trim() };
  // Filter out rows where Condition
  const filterM = t.match(/^\s*filter\s+out\s+rows\s+where\s+(.+)$/i);
  if (filterM) return { kind: 'filter', condition: filterM[1].trim() };
  return null;
}

/**
 * Build a small preview of the effect of a rule command on rows.
 * Currently supports dedup by column (keeps first occurrence).
 */
function previewForRuleCommand(descriptor, rows) {
  if (!descriptor || !Array.isArray(rows)) return { columns: [], rows: [] };
  const sampleRows = rows.slice(0, 1000); // cap for speed
  const baseCols = Object.keys(sampleRows[0] || {});
  const byLower = new Map(baseCols.map((c) => [String(c).toLowerCase(), c]));

  // Helpers
  const clone = (r) => JSON.parse(JSON.stringify(r));
  const ensureCols = (cols, added) => Array.from(new Set([...(cols || []), ...(added || [])]));
  const applyNormalize = (r, mode) => {
    const out = clone(r);
    for (const k of Object.keys(out)) {
      if (typeof out[k] === 'string') out[k] = mode === 'upper' ? out[k].toUpperCase() : out[k].toLowerCase();
    }
    return out;
  };
  const standardizePhone = (val) => String(val ?? '').replace(/\D+/g, '');
  const titleCase = (s) => String(s).toLowerCase().replace(/\b([a-z])(\w*)/g, (_, a, b) => a.toUpperCase() + b);
  const evalCondition = (row, cond) => {
    try {
      const m = String(cond).match(/^\s*([^<>!=]+)\s*(==|!=|>=|<=|>|<)\s*(.+)\s*$/);
      if (!m) return false;
      const col = (byLower.get(m[1].trim().toLowerCase()) || m[1]).trim();
      const op = m[2];
      let rhsRaw = m[3].trim();
      let rhs;
      if ((rhsRaw.startsWith('\"') && rhsRaw.endsWith('\"')) || (rhsRaw.startsWith("'") && rhsRaw.endsWith("'"))) rhs = rhsRaw.slice(1, -1);
      else if (!isNaN(Number(rhsRaw))) rhs = Number(rhsRaw);
      else rhs = rhsRaw;
      const lhs = row[col];
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

  // Title + trim preview
  if (descriptor.kind === 'title_trim' && Array.isArray(descriptor.columns)) {
    const cols = descriptor.columns.map((c) => byLower.get(c.toLowerCase()) || c);
    const out = sampleRows.slice(0, 20).map((r) => {
      const x = clone(r);
      for (const c of cols) {
        if (typeof x[c] === 'string') x[c] = titleCase(x[c].trim());
      }
      return x;
    });
    return { columns: baseCols, rows: out };
  }
  // Title-case in columns (no trim)
  if (descriptor.kind === 'titlecase_in' && Array.isArray(descriptor.columns)) {
    const cols = descriptor.columns.map((c) => byLower.get(c.toLowerCase()) || c);
    const out = sampleRows.slice(0, 20).map((r) => {
      const x = clone(r);
      for (const c of cols) if (typeof x[c] === 'string') x[c] = titleCase(x[c]);
      return x;
    });
    return { columns: baseCols, rows: out };
  }

  // Normalize nulls preview
  if (descriptor.kind === 'normalize_nulls') {
    const tokens = new Set(['', 'null', 'n/a', 'na', 'none', '-']);
    const out = sampleRows.slice(0, 20).map((r) => {
      const x = clone(r);
      for (const k of Object.keys(x)) {
        const v = x[k];
        if (v == null) { if (descriptor.value !== undefined) x[k] = descriptor.value; continue; }
        if (typeof v === 'string') {
          const s = v.trim().toLowerCase();
          if (tokens.has(s)) x[k] = (descriptor.value !== undefined ? descriptor.value : null);
        }
      }
      return x;
    });
    return { columns: baseCols, rows: out };
  }

  // Split Age preview
  if (descriptor.kind === 'split_age') {
    const cols = ensureCols(baseCols, ['AgeFrom', 'AgeTo']);
    const out = sampleRows.slice(0, 20).map((r) => {
      const x = clone(r);
      const v = String(x['Age'] ?? '');
      let m1 = v.match(/^(\d+)-(\d+)$/);
      let m2 = v.match(/^(\d+)\+$/);
      if (m1) { x['AgeFrom'] = m1[1]; x['AgeTo'] = m1[2]; }
      else if (m2) { x['AgeFrom'] = m2[1]; x['AgeTo'] = null; }
      return x;
    });
    return { columns: cols, rows: out };
  }

  // Split FY preview
  if (descriptor.kind === 'split_fy') {
    const src = byLower.get('year') || 'Year';
    const cols = ensureCols(baseCols, ['FYStart','FYEnd']);
    const out = sampleRows.slice(0, 20).map((r) => {
      const x = clone(r);
      const v = String(x[src] ?? '');
      const m = v.match(/^\s*FY(\d{2})\/(\d{2})\s*$/i);
      if (m) { x['FYStart'] = m[1]; x['FYEnd'] = m[2]; }
      return x;
    });
    return { columns: cols, rows: out };
  }

  // Dedup preview
  if (descriptor.kind === 'dedup' && descriptor.column) {
    const resolved = byLower.get(descriptor.column.toLowerCase()) || descriptor.column;
    const seen = new Set();
    const out = [];
    for (const r of sampleRows) {
      const key = String(r?.[resolved] ?? '').toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(r);
      if (out.length >= 20) break;
    }
    return { columns: baseCols, rows: out };
  }

  // Normalize casing preview
  if (descriptor.kind === 'normalize_case') {
    const mode = descriptor.mode === 'upper' ? 'upper' : 'lower';
    const out = sampleRows.slice(0, 20).map((r) => applyNormalize(r, mode));
    return { columns: baseCols, rows: out };
  }

  // Standardize phone numbers preview
  if (descriptor.kind === 'standardize_phone') {
    const phoneColGuess = descriptor.column ? (byLower.get(descriptor.column.toLowerCase()) || descriptor.column) : (byLower.get('phone') || byLower.get('mobile') || byLower.get('tel'));
    const col = phoneColGuess || baseCols.find((c) => /phone|mobile|tel/i.test(c)) || baseCols[0];
    const out = sampleRows.slice(0, 20).map((r) => { const x = clone(r); x[col] = standardizePhone(x[col]); return x; });
    return { columns: baseCols, rows: out };
  }

  // Split column into targets preview (supports delimiter, pattern, separators, auto-detect)
  if (descriptor.kind === 'split' && descriptor.column && Array.isArray(descriptor.targets)) {
    const src = byLower.get(descriptor.column.toLowerCase()) || descriptor.column;
    const targets = descriptor.targets;
    const cols = ensureCols(baseCols, targets);
    const out = sampleRows.slice(0, 20).map((r) => {
      const x = clone(r);
      const text = String(x[src] ?? '');
      let parts = [];
      if (descriptor.delimiter) {
        parts = text.split(descriptor.delimiter);
      } else if (descriptor.pattern) {
        try { const rx = new RegExp(descriptor.pattern, descriptor.flags || ''); const m = text.match(rx); parts = m ? m.slice(1) : []; } catch {}
      } else if (Array.isArray(descriptor.separators) && descriptor.separators.length) {
        for (const sep of descriptor.separators) {
          try { const rx = new RegExp(sep); const p = text.split(rx); if (p.length >= targets.length) { parts = p; break; } }
          catch { const p = text.split(String(sep)); if (p.length >= targets.length) { parts = p; break; } }
        }
      }
      if (!parts || parts.length === 0) {
        const auto = text.trim().split(/[\/_\-\|,\s]+/).filter(Boolean);
        if (auto.length) parts = auto;
      }
      if ((!parts || parts.length === 0 || parts.length < targets.length) && (/^\s*fy/i.test(text) || String(src).toLowerCase().includes('year'))) {
        const nums = (text.match(/\d+/g) || []).map((n) => n.length === 2 ? n : n.slice(-2));
        if (nums.length >= 2) parts = nums;
      }
      for (let i = 0; i < targets.length; i++) x[targets[i]] = parts[i] ?? '';
      return x;
    });
    return { columns: cols, rows: out };
  }

  // Merge sources into target preview
  if (descriptor.kind === 'merge' && Array.isArray(descriptor.sources) && descriptor.target) {
    const sources = descriptor.sources.map((s) => byLower.get(String(s).toLowerCase()) || s);
    const target = descriptor.target;
    const cols = ensureCols(baseCols, [target]);
    const out = sampleRows.slice(0, 20).map((r) => {
      const x = clone(r);
      const vals = sources.map((s) => x[s]).filter((v) => v != null && v !== '');
      x[target] = vals.join(' ');
      return x;
    });
    return { columns: cols, rows: out };
  }

  // Filter rows preview
  if (descriptor.kind === 'filter' && descriptor.condition) {
    const out = [];
    for (const r of sampleRows) {
      if (!evalCondition(r, descriptor.condition)) out.push(r);
      if (out.length >= 20) break;
    }
    return { columns: baseCols, rows: out };
  }
  // Normalize casing in columns preview
  if (descriptor.kind === 'normalize_case_in' && Array.isArray(descriptor.columns)) {
    const mode = descriptor.mode === 'upper' ? 'upper' : 'lower';
    const cols = descriptor.columns.map((c)=> byLower.get(c.toLowerCase()) || c);
    const out = sampleRows.slice(0, 20).map((r)=>{
      const x = clone(r);
      for (const c of cols) if (typeof x[c] === 'string') x[c] = mode==='upper' ? x[c].toUpperCase() : x[c].toLowerCase();
      return x;
    });
    return { columns: baseCols, rows: out };
  }
  // Replace in columns preview
  if (descriptor.kind === 'replace_in' && Array.isArray(descriptor.columns)) {
    const cols = descriptor.columns.map((c)=> byLower.get(c.toLowerCase()) || c);
    const re = new RegExp(descriptor.from, 'g');
    const out = sampleRows.slice(0, 20).map((r)=>{
      const x = clone(r);
      for (const c of cols) if (typeof x[c] === 'string') x[c] = x[c].replace(re, descriptor.to);
      return x;
    });
    return { columns: baseCols, rows: out };
  }
  // Map values preview
  if (descriptor.kind === 'map_values' && descriptor.column && descriptor.mapping) {
    const col = byLower.get(descriptor.column.toLowerCase()) || descriptor.column;
    const mp = descriptor.mapping;
    const out = sampleRows.slice(0, 20).map((r)=>{ const x=clone(r); const v=x[col]; if (v!=null && mp[v]!==undefined) x[col]=mp[v]; return x; });
    return { columns: baseCols, rows: out };
  }
  // Filter relation preview (drop rows matching A OP B)
  if (descriptor.kind === 'filter_relation' && descriptor.left && descriptor.op && descriptor.right) {
    const Lc = byLower.get(descriptor.left.toLowerCase()) || descriptor.left;
    const Rc = byLower.get(descriptor.right.toLowerCase()) || descriptor.right;
    const out = [];
    for (const r of sampleRows) {
      const lv = r[Lc], rv = r[Rc];
      const A = typeof lv==='number' ? lv : Number(lv);
      const B = typeof rv==='number' ? rv : Number(rv);
      const L = (!Number.isNaN(A) ? A : String(lv ?? ''));
      const R = (!Number.isNaN(B) ? B : String(rv ?? ''));
      let cond=false; switch (descriptor.op) {
        case '==': cond = (L==R); break; case '!=': cond = (L!=R); break;
        case '>': cond = (L>R); break; case '>=': cond = (L>=R); break;
        case '<': cond = (L<R); break; case '<=': cond = (L<=R); break;
      }
      if (!cond) out.push(r); if (out.length>=20) break;
    }
    return { columns: baseCols, rows: out };
  }

  // Filter: required columns
  if (descriptor.kind === 'filter_required' && Array.isArray(descriptor.columns)) {
    const cols = descriptor.columns.map((c) => byLower.get(c.toLowerCase()) || c);
    const out = [];
    for (const r of sampleRows) {
      const missing = cols.some((c) => r[c] == null || r[c] === '');
      if (!missing) out.push(r);
      if (out.length >= 20) break;
    }
    return { columns: baseCols, rows: out };
  }

  // Filter: missing percentage
  if (descriptor.kind === 'filter_missing_pct') {
    const thr = Number(descriptor.threshold || 50);
    const out = [];
    for (const r of sampleRows) {
      const vals = Object.values(r || {});
      const missing = vals.reduce((acc, v) => acc + ((v == null || v === '') ? 1 : 0), 0);
      const pct = vals.length ? (missing / vals.length) * 100 : 0;
      if (pct <= thr) out.push(r);
      if (out.length >= 20) break;
    }
    return { columns: baseCols, rows: out };
  }

  // Filter: numeric ranges (any violation drops)
  if (descriptor.kind === 'filter_ranges' && Array.isArray(descriptor.ranges)) {
    const out = [];
    for (const r of sampleRows) {
      let bad = false;
      for (const rg of descriptor.ranges) {
        const col = byLower.get(rg.column.toLowerCase()) || rg.column;
        const vRaw = r[col];
        if (vRaw == null || vRaw === '') { bad = true; break; }
        const v = Number(vRaw);
        if (Number.isNaN(v)) { bad = true; break; }
        switch (rg.op) {
          case '<': if (v < rg.value) bad = true; break;
          case '<=': if (v <= rg.value) bad = true; break;
          case '>': if (v > rg.value) bad = true; break;
          case '>=': if (v >= rg.value) bad = true; break;
        }
        if (bad) break;
      }
      if (!bad) out.push(r);
      if (out.length >= 20) break;
    }
    return { columns: baseCols, rows: out };
  }

  // Filter: contains
  if (descriptor.kind === 'filter_contains' && descriptor.column && descriptor.text) {
    const col = byLower.get(descriptor.column.toLowerCase()) || descriptor.column;
    const needle = descriptor.ci ? String(descriptor.text).toLowerCase() : String(descriptor.text);
    const out = [];
    for (const r of sampleRows) {
      const hay = String(r[col] ?? '');
      const hit = descriptor.ci ? hay.toLowerCase().includes(needle) : hay.includes(needle);
      if (!hit) out.push(r);
      if (out.length >= 20) break;
    }
    return { columns: baseCols, rows: out };
  }

  // Filter: AND of two conditions
  if (descriptor.kind === 'filter_and' && Array.isArray(descriptor.conditions)) {
    const out = [];
    for (const r of sampleRows) {
      const both = descriptor.conditions.every((c) => evalCondition(r, c));
      if (!both) out.push(r);
      if (out.length >= 20) break;
    }
    return { columns: baseCols, rows: out };
  }

  return { columns: baseCols, rows: sampleRows.slice(0, 20) };
}

// ---------------- Data Profiling Helpers -------------------
function buildBatchProfile(rows, columns, opts = {}) {
  const limit = Math.min(opts.limit || 10000, 10000);
  const sample = (rows || []).slice(0, limit);
  const cols = Array.isArray(columns) && columns.length ? columns : Object.keys(sample[0] || {});
  const rowCount = sample.length;
  const profile = {
    basis: rowCount,
    columns: cols,
    nullCounts: {},
    distinctCounts: {},
    duplicateCounts: {},
    numericStats: {}, // col -> {count,min,max}
    dateStats: {}, // col -> {min,max,futureCount}
    regexInvalid: {}, // col -> {pattern, invalid}
    topValues: {}, // col -> [{value,count}]
    distinctValues: {}, // col -> [values] when small
  };
  const valueSets = new Map();
  for (const c of cols) valueSets.set(c, new Map());
  for (const r of sample) {
    for (const c of cols) {
      const v = r?.[c];
      const isMissing = v === null || v === undefined || v === '';
      if (isMissing) profile.nullCounts[c] = (profile.nullCounts[c] || 0) + 1;
      // distinct/duplicate counts
      const key = String(v);
      const m = valueSets.get(c);
      m.set(key, (m.get(key) || 0) + 1);
      // numeric stats
      if (typeof v === 'number') {
        const st = profile.numericStats[c] || { count: 0, min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY };
        st.count += 1; st.min = Math.min(st.min, v); st.max = Math.max(st.max, v);
        profile.numericStats[c] = st;
      }
      // date stats (basic)
      if (v && (/(date|time|at)$/i.test(c) || /T\d\d:\d\d/.test(String(v)))) {
        const d = new Date(v);
        if (!isNaN(d.getTime())) {
          const st = profile.dateStats[c] || { min: null, max: null, futureCount: 0 };
          if (!st.min || d < new Date(st.min)) st.min = d.toISOString();
          if (!st.max || d > new Date(st.max)) st.max = d.toISOString();
          if (d.getTime() > Date.now()) st.futureCount += 1;
          profile.dateStats[c] = st;
        }
      }
      // email invalid
      if (/email/i.test(c)) {
        const ok = typeof v === 'string' && /.+@.+\..+/.test(v);
        if (!isMissing && !ok) {
          const cur = profile.regexInvalid[c] || { pattern: 'email', invalid: 0 };
          cur.invalid += 1; profile.regexInvalid[c] = cur;
        }
      }
    }
  }
  for (const c of cols) {
    const m = valueSets.get(c);
    let dups = 0; m.forEach((cnt) => { if (cnt > 1) dups += (cnt - 1); });
    profile.distinctCounts[c] = m.size;
    profile.duplicateCounts[c] = dups;
    // compute top values and optionally full distinct list when small
    const arr = Array.from(m.entries()).map(([value, count]) => ({ value, count }));
    arr.sort((a, b) => b.count - a.count || String(a.value).localeCompare(String(b.value)));
    profile.topValues[c] = arr.slice(0, 50);
    if (m.size <= 50) profile.distinctValues[c] = arr.map((x) => x.value);
  }
  return profile;
}

// ---------------- AI Rule Generator ------------------------
/**
 * Generate a rule JSON from a natural-language command.
 * Returns { name: string, definition: object }
 */
async function generateRuleFromText(command, columns, accessToken) {
  // Fast paths for common commands without model
  const cols = Array.isArray(columns) ? columns : [];
  const lowerCols = cols.map((c) => String(c).toLowerCase());
  const resolveCol = (nameGuess, fallbackPattern) => {
    if (nameGuess) {
      const i = lowerCols.indexOf(String(nameGuess).toLowerCase());
      if (i >= 0) return cols[i];
    }
    if (fallbackPattern) {
      const idx = lowerCols.findIndex((c) => fallbackPattern.test(c));
      if (idx >= 0) return cols[idx];
    }
    return null;
  };
  const t = String(command || '').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim();
  // Title-case X and Y; trim whitespace
  let m = null;
  // Split <col> into <a> and <b> using underscore/space/dash/hyphen/slash
  m = t.match(/^\s*split\s+(.+?)\s+into\s+(.+?)\s*(?:[,/&+]\s*|\s+and\s+)\s*(.+?)\s+using\s+(underscore|space|dash|hyphen|slash)\s*$/i);
  if (m) {
    const src = resolveCol(m[1], null) || m[1].trim();
    const a = m[2].trim(); const b = m[3].trim(); const how = m[4].toLowerCase();
    const sep = how === 'underscore' ? '[_]+' : how === 'space' ? '\\s+' : how === 'slash' ? '/' : '[-_]+';
    return { name: `Split ${src} into ${a}/${b}`, definition: { transforms: [ { name: 'split', column: src, separators: [sep], targets: [a,b] } ], checks: [], meta: { category: 'parsing' } } };
  }
  m = t.match(/^\s*title-?case\s+(.+?)\s*(?:;|\s+and\s+)\s*trim\s+whitespace\.?\s*$/i);
  if (m) {
    const cols = m[1].split(/\s*(?:,|\band\b)\s*/i).map((s) => s.trim()).filter(Boolean);
    return {
      name: `Titlecase + trim ${cols.join(', ')}`,
      definition: { transforms: [{ name: 'trim', columns: cols }, { name: 'titlecase', columns: cols }], checks: [], meta: { category: 'standardization' } }
    };
  }
  // Title-case columns (no trim)
  m = t.match(/^\s*title-?case\s+(.+?)\s*$/i);
  if (m) {
    const colsList = m[1].split(/\s*(?:,|\band\b)\s*/i).map((s) => s.trim()).filter(Boolean);
    return {
      name: `Titlecase ${colsList.join(', ')}`,
      definition: { transforms: [{ name: 'titlecase', columns: colsList }], checks: [], meta: { category: 'standardization' } }
    };
  }
  // Split Age into AgeFrom/AgeTo
  if (/^\s*split\s+age\s+into\s+agefrom\s*\/\s*ageto/i.test(t)) {
    return {
      name: 'Split Age into AgeFrom/AgeTo',
      definition: { transforms: [
        { name: 'split', column: 'Age', pattern: '^(\\\\d+)-(\\\\d+)$', targets: ['AgeFrom','AgeTo'] },
        { name: 'split', column: 'Age', pattern: '^(\\\\d+)\\\\+$', targets: ['AgeFrom'] }
      ], checks: [], meta: { category: 'parsing' } }
    };
  }
  // Split FY Year
  if (/^\s*split\s+fy\s+.*fystart.*fyend/i.test(t) || /split\s+.*year.*fystart.*fyend/i.test(t)) {
    return {
      name: 'Split FY into FYStart/FYEnd',
      definition: { transforms: [
        { name: 'split', column: 'Year', pattern: '^FY(\\\\d{2})\\\\/(\\\\d{2})$', targets: ['FYStart','FYEnd'] }
      ], checks: [], meta: { category: 'parsing' } }
    };
  }
  // Normalize empty/NULL/N/A cells to <value>
  m = t.match(/normalize\s+.*(empty|null|n\/a).*to\s+([A-Za-z0-9_\-+\/ ]+)/i);
  if (m) {
    const val = m[2].trim();
    return { name: `Normalize empties to ${val}`, definition: { transforms: [{ name: 'normalize_nulls', tokens: ["", "NULL", "N/A", "-"], toValue: val }], checks: [], meta: { category: 'normalization' } } };
  }
  if (/normalize\s+.*(empty|null|n\/a)/i.test(t)) {
    return { name: 'Normalize common empties to null', definition: { transforms: [{ name: 'normalize_nulls' }], checks: [], meta: { category: 'normalization' } } };
  }
  // Normalize casing to lower/upper in columns
  m = t.match(/^\s*(?:normalize|standardize)\s+(?:case|casing)\s+(?:to\s+)?lower(?:\s*case)?\s+in\s+(.+)$/i);
  if (m) {
    const colsList = m[1].split(/\s*,\s*/).map((s)=>s.trim()).filter(Boolean);
    return { name: `Lowercase ${colsList.join(', ')}`, definition: { transforms: [{ name: 'lowercase', columns: colsList }], checks: [], meta: { category: 'standardization' } } };
  }
  m = t.match(/^\s*(?:normalize|standardize)\s+(?:case|casing)\s+(?:to\s+)?upper(?:\s*case)?\s+in\s+(.+)$/i);
  if (m) {
    const colsList = m[1].split(/\s*,\s*/).map((s)=>s.trim()).filter(Boolean);
    return { name: `Uppercase ${colsList.join(', ')}`, definition: { transforms: [{ name: 'uppercase', columns: colsList }], checks: [], meta: { category: 'standardization' } } };
  }
  // Drop/Remove/Delete rows missing A, B, or C
  m = t.match(/^\s*(?:drop|remove|delete)\s+rows\s+missing\s+(.+?)\.?\s*$/i);
  if (!m) m = t.match(/^\s*(?:drop|remove|delete)\s+rows\s+with\s+missing\s+(.+?)\.?\s*$/i);
  if (m) {
    const colsList = m[1].split(/\s*(?:,|\bor\b|\band\b)\s*/i).map((s) => s.trim()).filter(Boolean);
    return { name: `Drop rows missing ${colsList.join(', ')}`, definition: { transforms: [], checks: [{ name: 'require_columns', columns: colsList, action: 'drop' }], meta: { category: 'completeness' } } };
  }
  // Drop rows with >X% empty fields
  m = t.match(/^\s*drop\s+rows\s+with\s*>\s*(\d+)\s*%\s+empty/i);
  if (m) {
    return { name: `Drop rows with >${m[1]}% empty`, definition: { transforms: [], checks: [{ name: 'drop_if_missing_pct_gt', threshold: Number(m[1]) }], meta: { category: 'completeness' } } };
  }
  // Drop rows with Unit <= 0 or Amount < 1000
  if (/^\s*drop\s+rows\s+with\s+unit\s*<=\s*0\s+or\s+amount\s*<\s*1000/i.test(t)) {
    return { name: 'Drop invalid Unit/Amount', definition: { transforms: [], checks: [
      { name: 'drop_if_null', columns: ['Unit','Amount'] },
      { name: 'drop_if_out_of_range', column: 'Unit', min: 0.000001 },
      { name: 'drop_if_out_of_range', column: 'Amount', min: 1000 }
    ], meta: { category: 'accuracy' } } };
  }
  // Drop rows where Remark contains '...'
  m = t.match(/^\s*drop\s+rows\s+where\s+remark\s+contains\s+['\"](.+?)['\"]/i);
  if (m) {
    return { name: `Drop rows where Remark contains ${m[1]}`, definition: { transforms: [], checks: [{ name: 'drop_if_pattern', column: 'Remark', pattern: m[1], flags: 'i' }], meta: { category: 'filter' } } };
  }
  // Drop rows where Business == Dealer and Remark == Discounted
  if (/^\s*drop\s+rows\s+where\s+business\s*==\s*dealer\s+and\s+remark\s*==\s*discounted/i.test(t)) {
    return { name: 'Drop Dealer & Discounted', definition: { transforms: [], checks: [
      { name: 'drop_if_all', conditions: ["Business == 'Dealer'", "Remark == 'Discounted'"] }
    ], meta: { category: 'filter' } } };
  }
  // Normalize casing in specific columns (lower/upper) e.g. "Normalize casing to lowercase in Business, Finished"
  m = t.match(/^(?:normalize|standardize)\s+(?:case|casing)\s+(?:to\s+)?lower(?:\s*case)?\s+in\s+(.+)$/i);
  if (m) {
    const colsSel = m[1].split(/\s*,\s*/).map((s) => s.trim()).filter(Boolean);
    return { name: `Normalize to lowercase in ${colsSel.join(', ')}`, definition: { transforms: [{ name: 'lowercase', columns: colsSel }], checks: [], meta: { category: 'normalization' } } };
  }
  m = t.match(/^(?:normalize|standardize)\s+(?:case|casing)\s+(?:to\s+)?upper(?:\s*case)?\s+in\s+(.+)$/i);
  if (m) {
    const colsSel = m[1].split(/\s*,\s*/).map((s) => s.trim()).filter(Boolean);
    return { name: `Normalize to uppercase in ${colsSel.join(', ')}`, definition: { transforms: [{ name: 'uppercase', columns: colsSel }], checks: [], meta: { category: 'normalization' } } };
  }
  // Dedup by X keep latest/first
  m = t.match(/dedup(?:e|licate)?\s+by\s+([^,]+?)(?:\s+keep\s+(first|latest|last))?$/i);
  if (m) {
    const col = resolveCol(m[1], null) || m[1].trim();
    const keep = (m[2] || 'last').toLowerCase() === 'first' ? 'first' : 'last';
    return { name: `Dedup by ${col} (${keep === 'last' ? 'latest' : 'first'})`, definition: { transforms: [], checks: [], meta: { type: 'dedup', keys: [col], keep } } };
  }
  // Normalize casing
  if (/normalize\s+(?:case|casing).*lower/i.test(t)) {
    return { name: 'Normalize casing to lower', definition: { transforms: [{ name: 'lowercase', columns: ['*'] }], checks: [], meta: { category: 'normalization' } } };
  }
  if (/normalize\s+(?:case|casing).*upper/i.test(t)) {
    return { name: 'Normalize casing to upper', definition: { transforms: [{ name: 'uppercase', columns: ['*'] }], checks: [], meta: { category: 'normalization' } } };
  }
  // Standardize phone numbers
  m = t.match(/standardize\s+phone\s+numbers?(?:\s+in\s+(.+))?/i);
  if (m) {
    const col = resolveCol(m[1], /(phone|mobile|tel)/i) || 'phone';
    return { name: `Standardize phone in ${col}`, definition: { transforms: [{ name: 'standardize_phone', column: col }], checks: [], meta: { category: 'standardization' } } };
  }
  // Split Full Name into First/Last
  m = t.match(/split\s+(.+?)\s+into\s+(.+?)\s*(?:[,/&+]\s*|\s+and\s+)\s*(.+)$/i);
  if (m) {
    const src = resolveCol(m[1], /(name|full)/i) || m[1].trim();
    const a = m[2].trim();
    const b = m[3].trim();
    return { name: `Split ${src} into ${a}/${b}`, definition: { transforms: [{ name: 'split', column: src, delimiter: ' ', targets: [a, b] }], checks: [], meta: { category: 'parsing' } } };
  }
  // Merge A + B into C
  m = t.match(/merge\s+(.+?)\s*\+\s*(.+?)\s+into\s+(.+)/i);
  if (m) {
    const a = resolveCol(m[1], null) || m[1].trim();
    const b = resolveCol(m[2], null) || m[2].trim();
    const target = m[3].trim();
    return { name: `Merge ${a}+${b} into ${target}`, definition: { transforms: [{ name: 'merge', sources: [a, b], target, separator: ' ' }], checks: [], meta: { category: 'merge' } } };
  }
  // Filter out rows where <condition>
  m = t.match(/filter\s+out\s+rows\s+where\s+(.+)/i);
  if (m) {
    const condition = m[1].trim();
    return { name: `Filter: ${condition}`, definition: { transforms: [], checks: [{ name: 'drop_if', condition }], meta: { category: 'filter' } } };
  }

  // Model prompt for anything else (extended supported ops)
  const sys = `You convert short data quality commands into a strict JSON rule.
Rules are executed by an engine that supports:
- transforms: trim, uppercase, lowercase, normalize_whitespace, replace{from,to,columns?}, map{column,mapping{}}, coalesce{column,values[]}, to_number{column}, strip_non_digits{column}, standardize_phone{column,countryCode?}, standardize_date{column,format?}, split{column,delimiter?|pattern?,targets[]}, merge{sources[],target,separator?}
- checks: regex{column,pattern}, drop_if{condition}, drop_if_null{columns[]}, drop_if_zscore_gt{column,threshold}
- meta: for dedup use { type: 'dedup', keys: [..], keep: 'first'|'last' }
Return ONLY JSON with fields { name, definition }.`;
  const guidance = {
    columns: Array.isArray(columns) ? columns.slice(0, 60) : [],
    schema: {
      name: "string: concise rule name",
      category: "dedup | standardization | normalization | parsing | merge | filter | enrichment | cross_field",
      definition: {
        transforms: "array of supported transforms (see list)",
        checks: "array of supported checks (see list)",
        meta: "extra details such as dedup keys",
      },
    },
    examples: [
      {
        command: "dedup by email keep latest",
        output: {
          name: "Dedup by email (latest)",
          category: "dedup",
          definition: {
            transforms: [],
            checks: [],
            meta: { type: "dedup", keys: ["email"], keep: "last" }
          }
        }
      },
      {
        command: "normalize casing to lowercase",
        output: {
          name: "Normalize to lowercase",
          category: "normalization",
          definition: { transforms: [{ name: "lowercase", columns: ["*"] }], checks: [], meta: {} }
        }
      },
      {
        command: "filter out rows where Amount < 0",
        output: {
          name: "Filter: Amount < 0",
          category: "filter",
          definition: { transforms: [], checks: [{ name: "drop_if", condition: "Amount < 0" }], meta: {} }
        }
      }
    ]
  };
  const body = {
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: sys },
      { role: "user", content: `Columns: ${JSON.stringify(guidance.columns)}\nGuidance: ${JSON.stringify(guidance.schema)}\nExamples: ${JSON.stringify(guidance.examples)}\n\nCommand: ${command}\nOutput JSON:` },
    ],
    temperature: 0,
  };
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Rule AI error ${res.status}`);
  const api = await res.json();
  let content = api?.choices?.[0]?.message?.content || '';
  content = String(content).trim();
  // Strip code fences if present
  let clean = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  // If the model returned the whole JSON as string inside JSON, try to extract braces
  if (clean && (clean.indexOf('{') === -1 || clean.indexOf('}') === -1)) {
    const first = content.indexOf('{');
    const last = content.lastIndexOf('}');
    if (first !== -1 && last !== -1 && last > first) clean = content.slice(first, last + 1);
  }
  let json;
  try { json = JSON.parse(clean); } catch (e) {
    // Fallback: create a meta-only rule so it can be saved and edited later
    return {
      name: String(command).slice(0, 120),
      definition: { meta: { note: 'Unparsed AI output', original: content } },
    };
  }
  // Some models might nest under 'rule'
  if (json && !json.name && json.rule) json = json.rule;
  if (!json || !json.definition) {
    return {
      name: String(json?.name || command).slice(0, 120),
      definition: { meta: { note: 'Incomplete AI output', original: content } },
    };
  }
  const def = json.definition || {};
  if (!def.meta) def.meta = {};
  if (json.category && !def.meta.category) def.meta.category = json.category;
  return { name: String(json.name).slice(0, 120), definition: def };
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

function MessageBubble({ msg, rulesets, setRulesets, kind, domain, onApproveRule, onRejectRule }) {
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
        {msg.type === "rule_proposal" && msg.payload && (
          <div>
            <div className="text-sm font-medium mb-2">Save this rule?</div>
            <div className="flex gap-2">
              <button className="px-3 py-1.5 rounded bg-emerald-600 text-white text-xs" onClick={() => onApproveRule?.(msg)}>Approve</button>
              <button className="px-3 py-1.5 rounded bg-neutral-300 text-neutral-800 text-xs" onClick={() => onRejectRule?.(msg)}>Reject</button>
            </div>
          </div>
        )}
        {msg.type === "preview" && msg.payload && (
          <PreviewTable payload={msg.payload} />
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

function PreviewTable({ payload }) {
  const { columns = [], rows = [] } = payload || {};
  const cols = Array.isArray(columns) && columns.length ? columns : Object.keys(rows[0] || {});
  const sample = Array.isArray(rows) ? rows : [];
  return (
    <div className="border rounded overflow-auto max-h-[50vh]">
      <table className="min-w-full text-xs">
        <thead className="bg-neutral-100 sticky top-0">
          <tr>
            {cols.map((c) => (
              <th key={c} className="text-left px-2 py-1 border-b border-neutral-200">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sample.map((row, idx) => (
            <tr key={idx} className="border-b border-neutral-100">
              {cols.map((c) => (
                <td key={c} className="px-2 py-1 whitespace-nowrap">{String(row?.[c] ?? '')}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
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
  const [columns, setColumns] = useState([]);
  const [cmd, setCmd] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    (async () => {
      try {
        const token = (await supabase.auth.getSession()).data?.session?.access_token;
        const res = await fetch(`/api/domains/${domainId}/rules`, { headers: { Authorization: `Bearer ${token}` } });
        const list = res.ok ? await res.json() : [];
        setRules(list || []);
        try {
          const vr = await fetch(`/api/domains/${domainId}/versions`, { headers: { Authorization: `Bearer ${token}` } });
          if (vr.ok) {
            const vs = await vr.json();
            const latest = Array.isArray(vs) && vs.length ? vs[0] : null;
            const cols = latest?.columns || [];
            if (Array.isArray(cols)) setColumns(cols);
          }
        } catch {}
      } finally { setLoading(false); }
    })();
  }, [domainId]);
  const update = async (rid, patch) => {
    const token = (await supabase.auth.getSession()).data?.session?.access_token;
    const res = await fetch(`/api/domains/${domainId}/rules/${rid}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(patch) });
    if (res.ok) setRules((rs) => rs.map((r) => (r.id === rid ? { ...r, ...patch } : r)));
  };
  const generate = async () => {
    if (!cmd.trim()) return;
    setError("");
    try {
      setGenerating(true);
      const token = (await supabase.auth.getSession()).data?.session?.access_token;
      const out = await generateRuleFromText(cmd.trim(), columns, token);
      const res = await fetch(`/api/domains/${domainId}/rules`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ name: out.name, definition: out.definition }) });
      if (!res.ok) throw new Error((await res.json()).error || 'Create failed');
      const created = await res.json();
      setRules((rs) => [created, ...rs]);
      setCmd("");
    } catch (e) {
      setError(e.message || 'Failed to generate');
    } finally {
      setGenerating(false);
    }
  };
  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-end" onClick={onClose}>
      <div className="bg-white h-full w-[420px] border-l flex flex-col overflow-auto" onClick={(e) => e.stopPropagation()}>
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
      <div className="bg-white h-full w-[900px] border-l flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 border-b flex items-center justify-between"><div className="font-medium">Versions</div><div className="flex gap-2"><button className="px-3 py-1 rounded border" onClick={loadPreview}>Preview</button><button className="px-3 py-1 rounded bg-neutral-900 text-white" onClick={doClean}>Clean</button><button onClick={onClose} className="ml-2">✕</button></div></div>
        {loading ? (
          <div className="p-4 text-neutral-500">Loading…</div>
        ) : (
          <div className="flex-1 overflow-auto p-3 space-y-2">
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
  const [slashIndex, setSlashIndex] = useState(0);
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
  const [serverTasks, setServerTasks] = useState([]);
  const [latestStats, setLatestStats] = useState(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  // Persist chat history
  useEffect(() => {
    try { const toSave = messages.filter((m) => m.type !== 'thinking'); localStorage.setItem(storageKey, JSON.stringify(toSave)); } catch {}
  }, [messages, storageKey]);

  const tasksOfKind = useMemo(() => tasks.filter((t) => t.kind === kind), [tasks, kind]);
  const fetchServerTasks = React.useCallback(async () => {
    try {
      if (!domainId) { setServerTasks([]); return; }
      const token = (await supabase.auth.getSession()).data?.session?.access_token;
      if (!token) { setServerTasks([]); return; }
      const url = `/api/tasks?domain_id=${encodeURIComponent(domainId)}&kind=${encodeURIComponent(kind)}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const list = res.ok ? await res.json() : [];
      setServerTasks(Array.isArray(list) ? list : []);
    } catch { setServerTasks([]); }
  }, [domainId, kind]);

  // Load server tasks on domain change
  useEffect(() => { fetchServerTasks(); }, [fetchServerTasks]);

  // Load latest-version stats for the active domain (server mode)
  useEffect(() => { (async () => {
    try {
      if (!domainId) { setLatestStats(null); return; }
      const token = (await supabase.auth.getSession()).data?.session?.access_token;
      if (!token) { setLatestStats(null); return; }
      const res = await fetch(`/api/domains/${domainId}/version/latest/stats`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) { setLatestStats(null); return; }
      const stats = await res.json();
      setLatestStats({ rowCount: Number(stats?.rowCount || 0), totalAmount: Number(stats?.totalAmount || 0) });
    } catch { setLatestStats(null); }
  })(); }, [domainId, serverTasks]);

  const items = useMemo(() => {
    if (domainId) {
      return (serverTasks || []).map((t) => ({
        id: t.id,
        isServer: true,
        params: t.params || {},
        kind: t.kind,
        fileName: t.params?.fileName || 'Task',
        createdAt: t.created_at,
        rowCount: t.params?.rowCount || 0,
        totalAmount: t.params?.totalAmount || 0,
        status: t.status,
        endpoint: t.params?.endpoint || null,
      }));
    }
    return tasksOfKind;
  }, [domainId, serverTasks, tasksOfKind]);

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
    // Add preview table of first rows
    try {
      const cols = (rawColumns && rawColumns.length) ? rawColumns : Object.keys(rows[0] || {});
      const previewRows = (rawRows && rawRows.length ? rawRows : rows).slice(0, Math.min(20, rowCount));
      setMessages((m) => [...m, { role: 'assistant', type: 'preview', content: 'Preview', payload: { columns: cols, rows: previewRows } }]);
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
    if (domainId) {
      try {
        const token = (await supabase.auth.getSession()).data?.session?.access_token;
        if (!token) {
          setMessages((m) => [...m, { role: 'assistant', type: 'text', content: 'You are not signed in. Please sign in to create a server task.' }]);
          return;
        }
        const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
        const body = {
          domain_id: domainId,
          kind,
          status: 'initiated',
          params: {
            fileName: currentBatch.fileName,
            rowCount: currentBatch.rowCount,
            totalAmount: currentBatch.totalAmount,
          },
        };
        const res = await fetch('/api/tasks', { method: 'POST', headers, body: JSON.stringify(body) });
        if (!res.ok) {
          let msg = 'Create task failed';
          try { msg = (await res.json()).error || msg; } catch {}
          setMessages((m) => [...m, { role: 'assistant', type: 'text', content: msg }]);
          return;
        }
        await fetchServerTasks();
        // Trigger server-side clean so enabled rules run and snapshot is created (no chat message)
        try {
          await fetch(`/api/domains/${domainId}/clean`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
        } catch {}
      } catch (e) {
        setMessages((m) => [...m, { role: 'assistant', type: 'text', content: `Create task error: ${e.message || e}` }]);
        return;
      }
    } else {
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
    }
    // no chat message for task initiation
    addToast("Task initiated");
  };

  const ask = async () => {
    if (!currentPrompt.trim()) return;
    let inputText = currentPrompt.trim();
    let forcedMode = null; // 'rule' | 'ask' | null
    if (/^\/rule\b/i.test(inputText)) { forcedMode = 'rule'; inputText = inputText.replace(/^\/rule\b\s*/i, ''); }
    else if (/^\/ask\b/i.test(inputText)) { forcedMode = 'ask'; inputText = inputText.replace(/^\/ask\b\s*/i, ''); }
    const question = inputText;
    setCurrentPrompt("");
    setMessages((m) => [...m, { role: "user", type: "text", content: (forcedMode ? `/${forcedMode} ` : '') + question }]);

    try {
      setBusy(true);
      const thinkId = uid("thinking");
      setPendingId(thinkId);
      setMessages((m) => [...m, { role: 'assistant', type: 'thinking', id: thinkId }]);
      // Try rule command (forced via /rule or auto-detected)
      try {
        const cmd = forcedMode === 'ask' ? null : detectRuleCommand(question);
        if (forcedMode === 'rule' || cmd) {
          const token = (await supabase.auth.getSession()).data?.session?.access_token;
          let cols = currentBatch?.rawColumns || Object.keys((currentBatch?.rows || [])[0] || {});
          if ((!cols || cols.length === 0) && domainId && token) {
            try {
              const vr = await fetch(`/api/domains/${domainId}/versions`, { headers: { Authorization: `Bearer ${token}` } });
              if (vr.ok) {
                const vs = await vr.json();
                cols = (vs?.[0]?.columns) || cols;
              }
            } catch {}
          }
          const out = await generateRuleFromText(question, cols || [], token);
          if (forcedMode !== 'rule' && domainId && token) {
            const res = await fetch(`/api/domains/${domainId}/rules`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ name: out.name, definition: out.definition }) });
            if (!res.ok) throw new Error((await res.json()).error || 'Create rule failed');
            setServerRuleCount((c) => (c == null ? 1 : c + 1));
            setMessages((m) => m.filter((mm) => mm.id !== thinkId));
            setMessages((m) => [...m, { role: 'assistant', type: 'text', content: `Rule "${out.name}" created from your command.` }]);
          } else {
            setMessages((m) => m.filter((mm) => mm.id !== thinkId));
            setMessages((m) => [...m, { role: 'assistant', type: 'text', content: `Previewing rule "${out.name}" (no active domain to save).` }]);
          }
          // Build preview rows from current batch or domain preview
          let previewRowsSrc = currentBatch?.rawRows || currentBatch?.rows || [];
          if ((!previewRowsSrc || previewRowsSrc.length === 0) && domainId && token) {
            try {
              const pr = await fetch(`/api/domains/${domainId}/preview?limit=50`, { headers: { Authorization: `Bearer ${token}` } });
              if (pr.ok) previewRowsSrc = await pr.json();
            } catch {}
          }
          if (previewRowsSrc && previewRowsSrc.length) {
          const desc = cmd || detectRuleCommand(question) || null;
          const pv = desc ? previewForRuleCommand(desc, previewRowsSrc) : { columns: Object.keys(previewRowsSrc[0] || {}), rows: previewRowsSrc.slice(0, 20) };
            setMessages((m) => [...m, { role: 'assistant', type: 'preview', content: 'Preview', payload: pv }]);
          }
          if (forcedMode === 'rule') {
            const proposalId = uid('rule');
            setMessages((m) => [
              ...m,
              { role: 'assistant', type: 'rule_proposal', id: proposalId, payload: { name: out.name, definition: out.definition } },
            ]);
          }
          return;
        }
      } catch {}
      // Skip local QA; build profiling context and route to LLM
      let ctxRows = currentBatch?.rawRows || currentBatch?.rows || [];
      let ctxCols = currentBatch?.rawColumns || Object.keys((currentBatch?.rows || [])[0] || {});
      if ((!ctxRows || ctxRows.length === 0) && domainId) {
        try {
          const token = (await supabase.auth.getSession()).data?.session?.access_token;
          if (token) {
            const pr = await fetch(`/api/domains/${domainId}/preview?limit=200`, { headers: { Authorization: `Bearer ${token}` } });
            if (pr.ok) {
              const arr = await pr.json();
              ctxRows = Array.isArray(arr) ? arr : [];
              ctxCols = Object.keys(ctxRows[0] || {});
            }
          }
        } catch {}
      }
      const profile = buildBatchProfile(ctxRows, ctxCols, { limit: 5000 });
      const ctx = {
        rulesets,
        columns: ctxCols,
        profile,
        sampleRows: ctxRows.slice(0, 20),
        lastBatch: currentBatch
          ? {
              fileName: currentBatch.fileName,
              rowCount: currentBatch.rowCount,
              totalAmount: currentBatch.totalAmount,
              issues: currentBatch.issues,
              ruleResults: currentBatch.ruleResults,
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
    const doLocal = !domainId || !selectedTask?.isServer;
    if (doLocal) {
      setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, endpoint: selectedEndpoint, status: "connecting" } : t)));
      setSelectedTask(null);
      setSelectedEndpoint("");
      setTimeout(() => {
        setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, status: "transferring" } : t)));
      }, 3000);
      setTimeout(() => {
        setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, status: "completed" } : t)));
      }, 6000);
    } else {
      (async () => {
        try {
          const token = (await supabase.auth.getSession()).data?.session?.access_token;
          const headers = { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
          // connecting
          await fetch(`/api/tasks/${id}`, { method: 'PUT', headers, body: JSON.stringify({ status: 'connecting', params: { ...(selectedTask.params || {}), endpoint: selectedEndpoint } }) });
          await fetchServerTasks();
          setSelectedTask(null);
          setSelectedEndpoint("");
          setTimeout(async () => {
            await fetch(`/api/tasks/${id}`, { method: 'PUT', headers, body: JSON.stringify({ status: 'transferring' }) });
            await fetchServerTasks();
          }, 3000);
          setTimeout(async () => {
            await fetch(`/api/tasks/${id}`, { method: 'PUT', headers, body: JSON.stringify({ status: 'completed' }) });
            await fetchServerTasks();
          }, 6000);
        } catch (e) {
          console.error('update server task failed', e);
        }
      })();
    }
  };

  // Rule proposal handlers
  const approveRuleProposal = async (proposalMsg) => {
    try {
      const token = (await supabase.auth.getSession()).data?.session?.access_token;
      if (!domainId || !token) {
        setMessages((m) => [...m, { role: 'assistant', type: 'text', content: 'No active server domain to save this rule.' }]);
        return;
      }
      const body = { name: proposalMsg?.payload?.name, definition: proposalMsg?.payload?.definition };
      const res = await fetch(`/api/domains/${domainId}/rules`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error((await res.json()).error || 'Create rule failed');
      setServerRuleCount((c) => (c == null ? 1 : c + 1));
      setMessages((m) => m.filter((mm) => mm !== proposalMsg));
      setMessages((m) => [...m, { role: 'assistant', type: 'text', content: `Rule "${body.name}" saved.` }]);
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', type: 'text', content: `Save rule failed: ${e.message || e}` }]);
    }
  };
  const rejectRuleProposal = (proposalMsg) => {
    setMessages((m) => m.filter((mm) => mm !== proposalMsg));
    setMessages((m) => [...m, { role: 'assistant', type: 'text', content: 'Rule discarded.' }]);
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
              onApproveRule={approveRuleProposal}
              onRejectRule={rejectRuleProposal}
            />
          ))}
          <div className="text-center text-xs text-neutral-600 pt-6">Drop an Excel/CSV anywhere above to import</div>
        </div>

        {/* Composer */}
        <div className="border-t border-neutral-200 p-3">
          <div className="relative">
            <textarea
              className="w-full bg-neutral-100 border border-neutral-300 rounded-xl text-lg resize-none h-28 px-3 pt-2 pb-14 pr-20 pl-10"
              placeholder="Type /ask to analyze or /rule to create a rule…"
              value={currentPrompt}
              onKeyDown={(e) => {
                const showSlash = /^\/[a-z]*$/i.test(currentPrompt);
                if (showSlash) {
                  // Slash menu navigation
                  const base = [
                    { key: '/ask' },
                    { key: '/rule' },
                  ];
                  const q = currentPrompt.slice(1).toLowerCase();
                  const items = base.filter((it) => it.key.slice(1).startsWith(q));
                  if (e.key === 'ArrowDown') { e.preventDefault(); setSlashIndex((i) => Math.min(i + 1, Math.max(items.length - 1, 0))); return; }
                  if (e.key === 'ArrowUp') { e.preventDefault(); setSlashIndex((i) => Math.max(i - 1, 0)); return; }
                  // Space should accept current token and close suggestions
                  if (e.key === ' ') {
                    // Let space insert; onChange will make pattern not match so suggestions close
                    return;
                  }
                  if (e.key === 'Enter' && !e.shiftKey) {
                    // If only slash or partial, accept selected suggestion; else submit as normal
                    const onlySlash = /^\/(?:a|ask|r|rule)?$/i.test(currentPrompt.trim());
                    if (onlySlash) {
                      e.preventDefault();
                      const pick = items[Math.min(slashIndex, Math.max(items.length - 1, 0))] || items[0] || base[0];
                      setCurrentPrompt(pick.key + ' ');
                      setSlashIndex(0);
                      return;
                    }
                  }
                }
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); }
              }}
              onChange={(e) => { setCurrentPrompt(e.target.value); if (!e.target.value.startsWith('/')) setSlashIndex(0); }}
            />
            {/* Slash suggestions */}
            {/^\/[a-z]*$/i.test(currentPrompt) && (
              <div className="absolute left-3 bottom-[8.25rem] w-64 bg-white border border-neutral-300 rounded-lg shadow z-10">
                {(() => {
                  const base = [
                    { key: '/ask' },
                    { key: '/rule' },
                  ];
                  const q = currentPrompt.slice(1).toLowerCase();
                  const items = base.filter((it) => it.key.slice(1).startsWith(q));
                  const list = items.length ? items : base;
                  return (
                    <ul className="py-1">
                      {list.map((it, idx) => (
                        <li
                          key={it.key}
                          onMouseDown={(e) => { e.preventDefault(); setCurrentPrompt(it.key + ' '); setSlashIndex(0); }}
                          className={`px-3 py-2 text-sm cursor-pointer ${idx === Math.min(slashIndex, list.length - 1) ? 'bg-neutral-100' : ''}`}
                        >
                          <span className="font-mono text-neutral-700">{it.key}</span>
                        </li>
                      ))}
                    </ul>
                  );
                })()}
              </div>
            )}
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
                disabled={!currentBatch}
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
          {items.length === 0 ? (
            <div className="p-4 text-sm text-neutral-500">No tasks yet. Upload a file to start.</div>
          ) : (
            <ul className="p-2 space-y-2">
              {items.map((t) => (
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
                  {domainId && latestStats && (
                    <div className="text-xs text-neutral-500 mt-1">
                      Latest version: {latestStats.rowCount} rows · Total {latestStats.totalAmount.toLocaleString()}
                    </div>
                  )}
                  {t.endpoint && (
                    <div className="text-xs text-neutral-500 mt-1 truncate">API: {t.endpoint}</div>
                  )}
                  {domainId && (
                    <div className="mt-2 flex justify-start">
                      <button
                        className="px-2 py-1 rounded-md bg-neutral-200 border border-neutral-300 text-xs flex items-center gap-1"
                        onClick={async () => {
                          try {
                            const token = (await supabase.auth.getSession()).data?.session?.access_token;
                            const res = await fetch(`/api/domains/${domainId}/version/latest/export.csv`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
                            if (!res.ok) throw new Error('Download failed');
                            const blob = await res.blob();
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            const base = (t.fileName || 'data').replace(/\.[^.]+$/, '');
                            a.href = url;
                            a.download = `${base}_latest.csv`;
                            document.body.appendChild(a);
                            a.click();
                            a.remove();
                            URL.revokeObjectURL(url);
                          } catch (e) {
                            addToast?.(e.message || 'Download failed');
                          }
                        }}
                        title="Download latest version as CSV"
                      >
                        <Download size={14} /> Download CSV
                      </button>
                    </div>
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
