# API Contracts (Sketch)

All endpoints require Authorization bearer token (Supabase JWT). Tenant scoping enforced.

- POST `/api/domains/:id/rules`
  - Body: { name: string, definition: object }
  - 200: { id, name, status, definition, ... }

- GET `/api/domains/:id/rules`
  - 200: [ { id, name, status, definition, ... } ]

- POST `/api/domains/:id/clean`
  - 200: { ok: true, changed: number, version: { id, ... } }

- GET `/api/domains/:id/export.csv[?version=latest|<uuid>]`
  - 200: text/csv (UTF-8)

- GET `/api/domains/:id/preview?limit=200&offset=0`
  - 200: [ record ] (latest current data)

- GET `/api/domains/:id/version/latest/preview?limit=200&offset=0`
  - 200: [ record ] (historical rows from the latest version)

- POST `/api/tasks`
  - Body: { domain_id: uuid, kind: string, status?: string, params?: object }
  - 200: { id, ... }

- PUT `/api/tasks/:id`
  - Body: { status?: string, params?: object, result?: object }
  - 200: { ...updated }
