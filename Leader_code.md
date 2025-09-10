# Leader Code: Data Cleansing + Transform System — Delivery Plan

This document breaks the current ideas into concrete, prioritized tasks with clear milestones, owners, and acceptance criteria. It focuses on performance, reliability, and UX for rule-based transforms, deduplication, profiling, and suggestions.

---

## 0) Guiding Principles
- Prefer set-based SQL over per-row mutations (scale, latency, atomicity)
- Keep user flows predictable (explicit approvals, low chat noise)
- Ship iteratively: Quick Wins → Hardening → Full SQL path
- Add observability (metrics, row counts, version lineage) for trust

---

## 1) Quick Wins (Backend, High ROI)

### 1.1 Set-based Dedup (single SQL)
- Description: Replace per-row dedup deletes with one SQL `DELETE` using window functions.
- Tasks:
  - Add SQL (via Supabase JS) that marks keepers with `row_number()` per business key and deletes others.
  - Parameterize keeper policy (first|last via `updated_at`/`created_at`).
  - Update Clean endpoint to call this SQL path.
- Acceptance:
  - On sample (10 rows → 9 after dedup), `domain_data` ends at 9 quickly.
  - Time-to-clean reduced by >10x for 50k rows compared to row-by-row.

### 1.2 Snapshot in One Statement
- Description: Replace paged inserts into `domain_history` with a single `INSERT … SELECT`.
- Tasks:
  - Implement `INSERT INTO domain_history (…) SELECT … FROM domain_data WHERE domain_id = $1` with version id.
  - Remove page loop; keep error handling.
- Acceptance:
  - Snapshot equals size of `domain_data` (verified) without mismatch.

### 1.3 Bulk Upsert for Transforms
- Description: Batch changed rows and write back in one upsert instead of N `UPDATE`s.
- Tasks:
  - Compute changed `{ domain_id, key_hash, record, updated_at }` in Node.
  - Insert into `domain_data` with `on conflict (domain_id, key_hash) do update`.
- Acceptance:
  - Same results, 5–20x fewer round trips on large datasets.

---

## 2) Hardening & Observability

### 2.1 Metrics + Logs
- Description: Capture clean stats and store in `rule_runs.metrics` and response.
- Tasks:
  - Record counts: rows scanned, changed, deleted (dedup), filtered, per-rule change estimates.
  - Add server logs for timings per phase (dedup, transform, snapshot).
- Acceptance:
  - Clean response includes `{ scanned, changed, deleted, filtered }`.

### 2.2 Strict Version Metadata
- Description: Ensure `domain_versions` carries `file_path`, `columns`, `import_summary` on every version (ingest & clean).
- Tasks:
  - Already inheriting on clean; add fallback to derived columns.
  - Add unit endpoints to verify metadata completeness.
- Acceptance:
  - Latest clean version has full metadata (file_path, columns, rows_count).

---

## 3) Full SQL Clean (RPC) — Phase 2

### 3.1 Stored Procedure for Clean
- Description: Move Clean to a SQL function called via RPC to maximize performance and transactional safety.
- Tasks:
  - Design function signature: `(domain_id uuid, rules jsonb) returns jsonb`.
  - Implement: set-based filter (drop_if, drop_if_null, z-score), dedup via window functions, transforms via jsonb operations, snapshot via `INSERT … SELECT`.
  - Wrap in single transaction; return metrics and new `version_id`.
- Acceptance:
  - Clean runs in 1 round trip, scales to 1M+ rows, passes parity tests with JS implementation.

### 3.2 Staging/Safe Swap (optional)
- Description: Use a staging table for transformed results and swap to `domain_data`.
- Tasks:
  - Create temp/staging table, transform into it, then replace current in one move.
- Acceptance:
  - Atomic swap without partial updates observed by readers.

---

## 4) Frontend UX & AI Assist

### 4.1 Slash Commands & Approval (DONE)
- `/rule` → propose rule with Approve/Reject.
- `/ask` → profiling to LLM.

### 4.2 Rule Suggestions After Upload (Heuristic + LLM Fallback)
- Description: Suggest relevant rules based on data, show as a list with Approve/Reject.
- Tasks:
  - Heuristics: trim/normalize whitespace, coalesce missing, to_number for numeric-like columns, lowercase casing for small-card columns; phone only if phone-like column exists.
  - LLM fallback if heuristics return none.
  - Support “OK” quick-approve.
- Acceptance:
  - On provided sample, suggestions exclude phone; include trim/normalize, missing value replacement, to_number(Amount), possibly normalize casing.

### 4.3 Preview Fidelity
- Description: Preview tables should reflect coalesce, filter, dedup, split/merge, to_number, normalize casing.
- Tasks:
  - Extend `previewForRuleCommand` (coalesce/filter/dedup done; verify to_number/split/merge/phone/normalize all render).
- Acceptance:
  - “Replace missing Age with N/A” shows filled values in preview; similar for other transforms.

### 4.4 Chat Noise Control (DONE)
- Suppress “task initiated” and “processed with rules” messages; keep toasts.

---

## 5) API Enhancements

### 5.1 CSV Export (DONE)
- Latest version export at `/api/domains/:id/version/latest/export.csv`.

### 5.2 Latest Stats (DONE)
- `/api/domains/:id/version/latest/stats` returns `{ rowCount, totalAmount }`.

### 5.3 Profiling Endpoint (Optional)
- Description: Provide server-side profiling to feed LLM precise counts.
- Tasks:
  - Add `/api/domains/:id/profile` that aggregates `nullCounts`, `distinctCounts`, min/max for numeric/date columns.
- Acceptance:
  - LLM answers use exact counts even without upload context.

---

## 6) Data Integrity & Tests

### 6.1 Ingest Integrity (DONE)
- Reset `domain_data`, verify cleared, bulk insert current + snapshot, verify counts.

### 6.2 Clean Integrity (DONE/ONGOING)
- Snapshot equals `domain_data` post-clean; mismatch returns error.

### 6.3 Version Lineage
- Ensure `domains.current_version_id` updated on ingest & clean.
- Keep `import_summary.source_version_id` linking to input version.

### 6.4 Unit/Parity Tests (API-level)
- Ingest → expect rows_count; Clean dedup → expect correct counts; Preview/export/diff work as expected.

---

## 7) Performance Targets & Benchmarks
- ≤ 20k rows: Clean < 3s on Quick Wins.
- 100k rows: Clean < 5–10s on SQL RPC path.
- 1M rows: Clean < 30–60s with RPC + staging.
- Export latest version: Streams within 2–3s for 100k rows.

---

## 8) Rollout Plan
- Phase A (1–2 days): Quick Wins (1.1–1.3), UX polish (4.2–4.4), integrity checks.
- Phase B (2–4 days): SQL RPC Clean (3.1) + benchmarks; optional staging (3.2).
- Phase C (1–2 days): Profiling endpoint (5.3), additional tests (6.4), docs.

---

## 9) Ownership & Risks
- Owners: Backend — Performance (Clean/Ingest); Frontend — UX/AI assist; QA — Parity tests.
- Risks: SQL JSON manipulation complexity; RLS implications for RPC; large-domain snapshots require careful batching/transactions.
- Mitigation: Start with Quick Wins; introduce RPC behind a feature flag; add dry-run mode for clean.

---

## 10) Acceptance (EO Week)
- Quick Wins merged and validated on sample + 100k rows dataset.
- Users see relevant suggestions and can approve them; preview matches effects.
- No chat noise on background operations; CSV export/stats usable in UI.
- Plan agreed to move Clean into RPC in next sprint.

