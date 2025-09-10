# Data Model: Chat Rules → Outputs

## Entities

### Domain
- id (uuid), tenant_id (uuid), name (text), description (text), business_key (text[]), current_version_id (uuid), created_by (uuid), created_at, updated_at

### Domain Version
- id (uuid), domain_id (uuid), file_path (text), rows_count (int), columns (jsonb), import_summary (jsonb), created_at

### Domain Data (current)
- domain_id (uuid), key_hash (text, PK with domain_id), key_values (jsonb), record (jsonb), updated_at

### Domain History
- id (uuid), domain_id (uuid), key_hash (text), key_values (jsonb), record (jsonb), version_at, source_version_id (uuid)

### Rule
- id (uuid), domain_id (uuid), name (text), status (text: enabled/disabled), definition (jsonb), created_by (uuid), created_at, updated_at
- definition: { transforms?: [ { name: 'trim'|'uppercase'|'lowercase'|'normalize_whitespace'|'replace'|'map'|'coalesce', ... } ], checks?: [ { name:'regex', column, pattern } ], meta?: {} }

### Rule Run
- id (uuid), rule_id (uuid), domain_version_id (uuid), status (text), metrics (jsonb), output_version_id (uuid), started_at, finished_at

### Task
- id (uuid), tenant_id (uuid), domain_id (uuid), kind (text), status (text), params (jsonb), result (jsonb), created_by (uuid), created_at, updated_at

## Notes
- SCD Type 4: domain_versions capture snapshots; domain_history holds prior/current changes with link to a source version; domain_data reflects current state.
- Duplicate key handling on ingest: collisions disambiguated by appending per-row index for that ingest to preserve all input rows.
