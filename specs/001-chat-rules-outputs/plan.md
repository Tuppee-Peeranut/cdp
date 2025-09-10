# Implementation Plan: Chat Commands → Rules + Outputs (CSV/API)

**Branch**: `[001-chat-rules-outputs]` | **Date**: 2025-09-08 | **Spec**: /specs/chat-rules-and-outputs.md
**Input**: Feature specification from `/specs/chat-rules-and-outputs.md`

## Execution Flow (/plan command scope)
```
1. Load feature spec from Input path
   ✓ Found and analyzed
2. Fill Technical Context (scan for NEEDS CLARIFICATION)
   ✓ Clarifications resolved in spec based on current code
3. Evaluate Constitution Check section below
   ✓ No blockers (see notes)
4. Execute Phase 0 → research.md
   ✓ Added decisions, limits, ordering, outputs
5. Execute Phase 1 → contracts, data-model.md, quickstart.md
   ✓ Drafted
6. Re-evaluate Constitution Check section
   ✓ OK
7. Plan Phase 2 → Describe task generation approach (no tasks.md yet)
   ✓ Planned
8. STOP - Ready for /tasks command
```

## Summary
This feature turns chat commands (e.g., “Dedup by Customer Name”, normalization, standardization) into reusable Rules tied to a domain. On Task, enabled Rules are applied (clean), producing processed data persisted via SCD Type 4 and available via two output channels: CSV download and API retrieval. The current codebase already supports rule storage, simple transform execution, task triggering, SCD Type 4 (versions/history/current), and now CSV export; this plan formalizes and extends the integration.

## Technical Context
- Language/Version: Node.js (Express), React (Vite), JavaScript/ESM
- Primary Dependencies: express, supabase-js (admin on backend, anon on frontend), xlsx, lucide-react, tailwind
- Storage: Supabase Postgres (tables: domains, domain_versions, domain_data, domain_history, rules, rule_runs, tasks) + Supabase Storage (buckets: domains, avatars)
- Testing: None formalized in repo; manual verification via UI/requests (NEEDS formal tests later)
- Target Platform: Web app (frontend + backend)
- Project Type: web (frontend + backend)
- Performance Goals: UI preview ≤200 rows; profiling ≤10k rows; clean ≤20k current rows per run; CSV export ≤50k rows/request
- Constraints: Tenant-scoped auth; simple sequential transforms; last-write-wins when multiple transforms touch same field
- Scale/Scope: Single-tenant-per-user model (multi-tenant overall); sizes up to tens of thousands of rows per run

## Constitution Check
Simplicity:
- Projects: 2 (frontend, backend) under monorepo
- Using frameworks directly: Yes (Express, React)
- Single data model: JSONB-centric domain_data/history with versions
- Avoiding patterns: Yes (no extra layers)

Architecture:
- Library split: N/A (monorepo apps); acceptable for scope
- CLI per library: N/A
- Docs: Plan and spec included under specs/

Testing (NON-NEGOTIABLE):
- Current repo lacks automated tests; plan calls out adding contract and integration tests in Phase 1 outline for future execution

Observability:
- Basic console logs; can add structured logs in follow-up

Versioning:
- Feature-level docs include phases; app versioning not formalized

## Project Structure

### Documentation (this feature)
```
specs/001-chat-rules-outputs/
├─ plan.md            # This file (/plan output)
├─ research.md        # Phase 0 (/plan)
├─ data-model.md      # Phase 1 (/plan)
├─ quickstart.md      # Phase 1 (/plan)
└─ contracts/         # Phase 1 (/plan)
```

### Source Code (repository root)
```
backend/  # Express API, Supabase integration
frontend/ # Vite + React app
```

**Structure Decision**: Option 2 (Web application)

## Phase 0: Outline & Research
- Decision: Rule execution order = API return order (creation order); last transform wins per field
  - Rationale: Simple, deterministic; matches current code
  - Alternatives: Explicit priority field; deferred
- Decision: Supported transforms = trim, uppercase, lowercase, normalize_whitespace, replace, map, coalesce; checks = regex (metrics only)
  - Rationale: Implemented today
  - Alternatives: Add dedup/enrichment joins; future work
- Decision: Limits = preview 20–200, profile ~10k, clean 20k, export 50k
  - Rationale: Present code caps; avoid heavy CPU in UI/API
  - Alternatives: Pagination/streaming exports
- Decision: Tenant-scoped auth for all domain endpoints
  - Rationale: Security
  - Alternatives: Per-domain ACLs later

## Phase 1: Design & Contracts

### Data Model (summary)
- Rule: id, domain_id, name, status, definition, created_by, timestamps
- Task: id, tenant_id, domain_id, kind, status, params, result, created_by, timestamps
- Domain + Version + Data + History: already defined; SCD Type 4 flow

See data-model.md for details.

### API Contracts (summary)
- POST /api/domains/:id/rules → Create rule {name, definition}
- GET /api/domains/:id/rules → List rules
- POST /api/domains/:id/clean → Apply enabled rules; returns {changed, version}
- GET /api/domains/:id/export.csv[?version=latest|<uuid>] → Download CSV
- GET /api/domains/:id/preview → JSON preview (current)
- GET /api/domains/:id/version/latest/preview → JSON preview (latest version)
- POST /api/tasks → Create task {domain_id, kind, status, params}
- PUT /api/tasks/:id → Update task (status/params/result)

See contracts/ for request/response sketches.

### Quickstart (summary)
- Upload file via UI → backend ingest → domain_versions + domain_data/history
- In chat, issue command (e.g., “Dedup by X”) → rule created (or placeholder)
- Click Task → server creates task, applies clean, responds with links:
  - CSV: /api/domains/:id/export.csv?version=<processed_version>
  - API: /api/domains/:id/preview (current) or version preview

## Phase 2: Task Planning Approach (do not execute)
- Generate tasks from contracts and data model
- Add contract tests (endpoints listed)
- Add integration tests covering upload→rule→task→export flow
- Implementation tasks to extend transform engine when needed (e.g., dedup)

## Complexity Tracking
(None)

## Progress Tracking
- [x] Phase 0: Research complete (/plan command)
- [x] Phase 1: Design complete (/plan command)
- [ ] Phase 2: Task planning complete (/plan command - describe approach only)
- [ ] Phase 3: Tasks generated (/tasks command)
- [ ] Phase 4: Implementation complete
- [ ] Phase 5: Validation passed

**Gate Status**:
- [x] Initial Constitution Check: PASS
- [x] Post-Design Constitution Check: PASS
- [x] All NEEDS CLARIFICATION resolved
- [ ] Complexity deviations documented
