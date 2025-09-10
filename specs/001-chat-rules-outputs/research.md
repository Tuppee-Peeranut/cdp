# Phase 0 Research: Chat Rules → Outputs

Decisions
- Execution order: API return order (creation order). Last transform wins per field.
- Supported transforms: trim, uppercase, lowercase, normalize_whitespace, replace{from,to}, map{column,mapping{}}, coalesce{column,values[]}.
- Checks: regex{column,pattern} for metrics only; non-blocking.
- Limits: preview ≤200 rows, profiling ≤10k rows, clean ≤20k rows, export ≤50k rows.
- AuthN/AuthZ: Supabase JWT; domain endpoints tenant-scoped; roles admin/user/super_admin.
- SCD Type 4: Uploads and cleans produce domain_versions; domain_history records prior values; domain_data stores current JSONB.

Rationale
- Keep pipeline deterministic and simple; matches current code.
- Transform set reflects implemented engine; safer than overpromising.
- Limits protect UX and server resources.
- Tenant scoping required for multi-tenant safety.

Alternatives Considered
- Rule priority field → future enhancement.
- Full dedup/merge support in engine → future enhancement (requires key semantics and conflict policy).
- Streaming CSV and pagination → future enhancement for large exports.
