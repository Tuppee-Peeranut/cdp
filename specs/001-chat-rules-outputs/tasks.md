# Tasks: Chat Commands → Rules + Outputs (CSV/API)

**Input**: Design documents from `/specs/001-chat-rules-outputs/` and `/specs/chat-rules-and-outputs.md`
**Prerequisites**: plan.md (required), research.md, data-model.md, contracts/

## Execution Flow (main)
```
1. Load plan.md from feature directory
   ✓ Extract tech stack, structure (web: frontend + backend)
2. Load optional design documents
   ✓ data-model.md entities (Rule, Task, Domain*, Version, Data, History)
   ✓ contracts/ endpoints
   ✓ research.md decisions (ordering, limits, transforms)
   ✓ quickstart.md scenarios
3. Generate tasks by category (Setup → Tests → Core → Integration → Polish)
4. Apply rules (tests first; [P] when different files)
5. Number tasks; add dependencies; parallel examples
```

## Phase 3.1: Setup
- [ ] T001 Ensure local env files
  - backend/.env → set `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_JWT_SECRET`, `OPENAI_API_KEY` (optional), super-admin seeds
  - frontend/.env.local → set `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
- [ ] T002 Install deps and run dev servers
  - Commands: `npm install` (repo root), `npm --prefix backend install`, `npm --prefix frontend install`
  - Run: `npm run dev` (root) to start both
- [ ] T003 [P] Seed super admin and login path sanity
  - Use /super-admin/login and seed creds from backend/.env

## Phase 3.2: Tests First (TDD) — MUST FAIL BEFORE 3.3
- [ ] T004 [P] Contract test: GET `/api/domains/:id/export.csv` returns CSV (auth required)
  - File: tests/contract/backend/export_csv.test.js
- [ ] T005 [P] Contract test: POST `/api/domains/:id/clean` applies rules and returns `{changed, version}`
  - File: tests/contract/backend/clean_apply.test.js
- [ ] T006 [P] Contract test: POST `/api/tasks` and PUT `/api/tasks/:id` create/update tasks
  - File: tests/contract/backend/tasks_crud.test.js
- [ ] T007 [P] Integration test: Upload → Ingest → Rule (chat command) → Task → Export CSV
  - File: tests/integration/e2e_upload_rule_task_export.test.md (manual steps acceptable for MVP)

## Phase 3.3: Core Implementation
- [ ] T008 [P] Backend: Add deterministic rule ordering in clean
  - File: `backend/server/domainsRoutes.js`
  - Change rules fetch to `.order('created_at', { ascending: true })` to ensure stable execution order
- [ ] T009 [P] Backend: CSV export endpoint (already added) — verify columns/encoding
  - File: `backend/server/domainsRoutes.js` (`GET /:id/export.csv`)
  - Ensure columns derive from version.columns or current data keys; UTF-8; filename with timestamp
- [ ] T010 Backend: Ingest duplicate-key preservation (completed) — document behavior
  - File: `backend/server/domainsRoutes.js` ingest; keep all rows by disambiguating with `__row_index`
- [ ] T011 [P] Backend: Tasks API mounted (completed) — verify filters by `domain_id` and `kind`
  - Files: `backend/server/tasksRoutes.js`, `backend/server/index.js`
- [ ] T012 Frontend: Data Provider Monitoring uses backend tasks for server-backed domain
  - File: `frontend/src/App.jsx` (TransferChat) — confirm `serverTasks` list and assignment flow via PUT /api/tasks/:id
- [ ] T013 [P] Frontend: Show “Download CSV” button after clean
  - File: `frontend/src/App.jsx` (TransferChat) — render a button that links to `/api/domains/${domainId}/export.csv?version=${processedVersionId}` and opens in new tab
- [ ] T014 Frontend: VersionsPanel “Download CSV” for latest version
  - File: `frontend/src/App.jsx` (VersionsPanel) — add a small button to hit `/api/domains/${domainId}/export.csv?version=latest`
- [ ] T015 [P] Frontend: Rule creation UX from chat (existing) — confirm placeholder rule on parse failure
  - File: `frontend/src/App.jsx` generateRuleFromText; ensure meta placeholder path tested manually

## Phase 3.4: Integration
- [ ] T016 Manual E2E: Login → Create domain → Upload → Ingest → Create rule → Task → Clean → Export CSV
  - Use Supabase auth; verify tenant scoping
- [ ] T017 [P] Verify API auth on export and preview endpoints (401/403 when unauth/foreign tenant)
  - Endpoints: `/api/domains/:id/export.csv`, `/api/domains/:id/preview`
- [ ] T018 [P] Validate limits:
  - Clean caps 20k rows; export caps 50k rows; preview caps in UI reasonable; confirm no timeouts locally
- [ ] T019 Add short README snippet: how to click Task and where to find outputs (CSV/API)
  - File: `README.md` — features section and quickstart note

## Phase 3.5: Polish
- [ ] T020 [P] UX: Toasts for CSV ready and API link copy
  - File: `frontend/src/App.jsx`
- [ ] T021 [P] Logging: Add minimal console logs around clean/export for traceability
  - File: `backend/server/domainsRoutes.js`
- [ ] T022 [P] Docs: Update specs/chat-rules-and-outputs.md to reflect rule ordering and limits
- [ ] T023 Remove any dead code; quick lint pass

## Dependencies
- Tests (T004–T007) before implementation checks (T008–T015)
- T008 affects T015 behavior (ordering semantics)
- T011 unblocks T012
- UI tasks (T013–T015) after endpoints verified (T008–T011)
- Integration (T016–T019) after core

## Parallel Example
```
# Run contract tests in parallel (different files)
Task: "Contract test export CSV in tests/contract/backend/export_csv.test.js"
Task: "Contract test clean apply in tests/contract/backend/clean_apply.test.js"
Task: "Contract test tasks CRUD in tests/contract/backend/tasks_crud.test.js"
```

## Validation Checklist
- [ ] All listed endpoints have a contract test or manual scenario
- [ ] Entities from data-model have coverage in plan
- [ ] Tests ordered before implementation
- [ ] Parallel tasks only when files don’t overlap
- [ ] Each task includes exact file path(s)
- [ ] MVP verifiable locally in the browser
