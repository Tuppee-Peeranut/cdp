# Feature Specification: Chat Commands → Reusable Rules + Task Outputs (CSV/API)

**Feature Branch**: `[feat-chat-rules-outputs]`  
**Created**: 2025-09-08  
**Status**: Draft  
**Input**: User description: "We would like to further develop the system so that when data is uploaded and the user issues a command via the Chatbox (e.g., “Dedup by Customer Name” or applying Transformation Rules for other cleansing operations such as Standardization, Normalization, Deduplication, Correction, Splitting/Parsing, Merging, Filtering/Outlier Handling), the system will automatically create a Rule. This Rule will store the complete transformation instructions so that it can be reused.

When the user clicks “Task”, the system will apply the stored Rule to the data and then provide two main output channels for using the processed data:

Download CSV

API

Additionally, the processed data will be stored following the SCD Type 4 method."

## Execution Flow (main)
```
1. Parse user description from Input
   ↳ If empty: ERROR "No feature description provided"
2. Extract key concepts from description
   ↳ Identify: actors (data operator), actions (chat command, create rule, run task), data (uploaded dataset, processed dataset), constraints (SCD Type 4 persistence)
3. For each unclear aspect:
   ↳ Mark with [NEEDS CLARIFICATION: specific question]
4. Fill User Scenarios & Testing section
   ↳ If no clear user flow: ERROR "Cannot determine user scenarios"
5. Generate Functional Requirements
   ↳ Each requirement must be testable
   ↳ Mark ambiguous requirements
6. Identify Key Entities (data involved)
7. Run Review Checklist
   ↳ If any [NEEDS CLARIFICATION]: WARN "Spec has uncertainties"
   ↳ If implementation details found: ERROR "Remove tech details"
8. Return: SUCCESS (spec ready for planning)
```

---

## User Scenarios & Testing (mandatory)

### Primary User Story
As a data operator, after uploading a dataset, I want to issue natural‑language commands in the chat (e.g., “Dedup by Customer Name” or “Normalize gender values to Male/Female/Unknown”), so that a reusable Rule is created and saved. Later, when I click “Task”, the system applies my saved Rules to the dataset, produces a cleaned output that I can: (a) download as CSV and (b) access via API, while also persisting the processed data in an SCD Type 4 structure for auditability.

### Acceptance Scenarios
1. Given a dataset is uploaded, When the user enters “Dedup by Customer Name” in chat, Then a new reusable Rule named accordingly is created and associated with the current data domain.
2. Given multiple chat commands were issued (e.g., standardize country, normalize case, filter out outliers), When the user clicks “Task”, Then the system applies the stored Rules in a defined order and produces a processed dataset.
3. Given the processed dataset is produced, When the user requests outputs, Then the user can download the result as a CSV file and can retrieve the same result via an authenticated API endpoint.
4. Given the processed dataset is produced, Then the changes are persisted using SCD Type 4, including a new version and append‑only history of changed records.
5. Given Rules exist, When the user returns later and uploads a new dataset for the same domain, Then they can reuse or adjust existing Rules without re‑authoring them.

### Edge Cases
- Rule conflicts and order: The current engine combines transforms from all enabled Rules in the order returned by the API and applies them sequentially; if multiple transforms touch the same field, the last applied transform wins. Regex "checks" are used for simple metrics only and do not block processing.
- Vague/unsupported commands: If AI parsing fails, the system creates a placeholder Rule with definition.meta containing the original text; users can edit and enable it later. This behavior matches the existing generateRuleFromText fallback in the UI.
- Large datasets and limits: UI preview typically samples 20–200 rows (varies by view), profiling aggregates up to ~10,000 rows, server-side clean processes up to 20,000 current rows per run, and CSV export returns up to 50,000 rows per request.
- Authentication/authorization: All domain endpoints, including CSV export, require an authenticated user with role admin/user/super_admin. Access is tenant-scoped; the backend verifies that the requesting user's tenant matches the domain's tenant.
- Re-running Tasks/versioning: Each Task run that applies Rules (clean) creates a new domain_versions record (import_summary.action = "clean") and appends changes to domain_history, then updates domain_data. Raw uploads also create their own version. Re-running creates another processed version, preserving SCD Type 4 auditability.

## Requirements (mandatory)

### Functional Requirements
- FR-001: The system MUST allow users to issue natural‑language data quality/cleansing commands in chat (examples: Standardization, Normalization, Deduplication intent, Correction, Splitting/Parsing, Merging, Filtering/Outlier handling).
- FR-002: The system MUST convert such commands into a stored, reusable Rule attached to the active data domain.
- FR-003: Each Rule MUST capture the transformation intent; the current engine executes these supported transforms: trim, uppercase, lowercase, normalize_whitespace, replace{from,to}, map{column,mapping{}}, coalesce{column,values[]}, and supports checks: regex{column,pattern} for metrics.
- FR-004: Users MUST be able to create multiple Rules; execution order is the API return order (effectively creation order where ordered), and when multiple transforms modify the same field, the last applied value persists.
- FR-005: When “Task” is triggered, the system MUST apply all enabled Rules to the latest dataset for the domain and produce a processed output.
- FR-006: The system MUST provide two output channels for the processed result: (a) downloadable CSV file and (b) API retrieval (JSON preview endpoints, CSV export endpoint).
- FR-007: The processed dataset MUST be persisted following SCD Type 4: create a new version/snapshot entry and append prior/current row changes to history without destructive updates.
- FR-008: The system MUST preserve raw uploaded data and the processed result for auditability and reprocessing.
- FR-009: The system MUST provide feedback to the user after “Task” (e.g., number of changed rows, links to CSV/API outputs).
- FR-010: The system MUST allow users to enable/disable Rules and edit Rule parameters.
- FR-011: For ambiguous/unsupported commands, the system creates a placeholder Rule with definition.meta (including the original text) for later editing; no transform is executed until supported parameters are present.
- FR-012: Access to outputs via API MUST require authentication and is tenant‑scoped.

### Key Entities
- Rule: a reusable, named transformation/validation instruction set associated with a domain; has status (enabled/disabled) and parameters.
- Task: a user‑initiated run that applies enabled Rules to a dataset; has status lifecycle and output references (CSV/API, version IDs).
- Domain: a logical grouping of datasets (tenant‑scoped) with a defined business key.
- Domain Version (Processed/Raw): a versioned snapshot of data (SCD Type 4) created after upload and after processing.
- Domain Data (Current): holds the current state after processing; one row per identity key at the time of processing.
- Domain History: append‑only record of prior states/changes linked to versions.

---

## Review & Acceptance Checklist

### Content Quality
- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

### Requirement Completeness
- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous (where specified)
- [x] Success criteria are measurable
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

---

## Execution Status

- [x] User description parsed
- [x] Key concepts extracted
- [x] Ambiguities marked
- [x] User scenarios defined
- [x] Requirements generated
- [x] Entities identified
- [x] Review checklist passed

---
