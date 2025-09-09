# Quickstart: Chat Rules → Outputs

1) Upload data
- UI: Drag-and-drop CSV/XLSX in the chat panel.
- Backend stores file (Supabase Storage), creates a domain_version, upserts domain_data and writes domain_history.

2) Create a Rule via chat
- Type a command like: Dedup by Customer Name, Normalize whitespace for Name, Replace '-' with '' in Phone.
- The system creates a Rule attached to the active domain; if parsing fails, a placeholder rule is saved for later editing.

3) Run Task (apply rules)
- Click Task. For server-backed domains, a task is created, the server applies enabled rules (clean), and reports changed rows.

4) Get outputs
- CSV: Download using /api/domains/:id/export.csv?version=<processed_version_id>
- API: Preview JSON using /api/domains/:id/preview or /api/domains/:id/version/latest/preview

5) Audit trail (SCD Type 4)
- Each upload and clean creates a domain_versions row.
- domain_history holds prior/current records for each change.
