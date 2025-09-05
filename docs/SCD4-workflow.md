SCD Type 4 Support — Domains, Rules, Tasks
==========================================

This design brings persisted Domains (datasets), AI‑generated Rules, and Task execution to the app using a Type‑4 Slowly Changing Dimension approach (current + history tables).

Database (migrations)
- 008_domains_rules_tasks.sql creates:
  - domains: per‑tenant metadata (name, business_key, current_version)
  - domain_versions: upload/import snapshots
  - domain_data: current records (JSONB)
  - domain_history: append‑only history records (JSONB)
  - rules: AI‑generated definitions per domain
  - rule_runs: executions of rules over versions
  - tasks: generic queue for long‑running jobs

API (server)
- GET /api/domains → list domains for tenant
- POST /api/domains { name, business_key[] } → create domain
- GET /api/domains/:id/rules → list rules for a domain
- POST /api/domains/:id/rules { name, definition } → create rule

Future endpoints (recommended)
- POST /api/domains/:id/upload → returns signed URL to upload CSV/XLSX to storage and kicks off ingestion to domain_versions + domain_data/history
- POST /api/domains/:id/clean → run rules, produce a new version, push Task
- GET /api/domains/:id/versions → summarize past uploads / rule outputs

SCD Type‑4 Flow
1. New domain: create with a business key (one or more columns).
2. Upload CSV/XLSX: parse → map header → detect types → compute key_hash from business key →
   - Upsert to domain_data (current)
   - Write previous values (if any) to domain_history with version timestamp + source version id
3. Ask in chat: profile quality, completeness, duplicates, anomalies.
4. Ask chat to create rules: AI proposes JSON definitions (validations/transforms) bound to domain.
5. Save rules: visible in UI.
6. Run rules: produce cleaned version; allow preview/diff vs previous.
7. Iterate until satisfied.
8. Export or consume current data.

Rule shape (example)
{
  "type": "validation|transform",
  "checks": [
    { "name": "require_columns", "columns": ["email","name"] },
    { "name": "unique", "columns": ["email"] },
    { "name": "regex", "column": "email", "pattern": "^.+@.+$" }
  ],
  "transforms": [
    { "name": "trim", "columns": ["name","email"] },
    { "name": "lowercase", "columns": ["email"] }
  ]
}

UI hooks (high‑level)
- Sidebar Domains → fetch from /api/domains
- Chat file drop → upload, then POST /api/domains/:id/upload
- Chat commands: “create rule to…” → POST /api/domains/:id/rules
- Rules list → run/preview → POST /api/domains/:id/clean (upcoming)

Security & tenancy
- All queries scope by req.user.tenantId from the JWT.
- RLS is recommended long‑term; current server uses service key.

